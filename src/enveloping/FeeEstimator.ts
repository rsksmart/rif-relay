// @ts-ignore
import { DataFrame } from 'dataframe-js'
import { configureServer, ServerConfigParams } from '../relayserver/ServerConfigParams'
import { BlockTransactionObject } from 'web3-eth'
import { HttpProvider, IpcProvider, Transaction, WebsocketProvider } from 'web3-core'
import Web3 from 'web3'
import Timeout = NodeJS.Timeout

const BLOCK_TIME = 20

/**
 * These are the minimum needed % of blocks accepting gas prices. For example, a gas price that has been accepted at least on 30% of
 * the recent mined blocks will be considered for safeLow gas price because it will take longer to be included. These values can be modified.
 * @SAFELOW will be mined in < 30m
 * @STANDARD will be mined in < 5m
 * @FAST will be mined in < 2m
 */
const SAFELOW = 30
const STANDARD = 60
const FAST = 90

/**
 * The amount of last mined blocks to take as reference for analysis
 */
const BLOCKS_TO_ANALYZE = 100

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

export interface FeesTable {
  safeLow: number
  standard: number
  fast: number
  fastest: number
  blockTime: number
  blockNum: number
}

/**
 * Monitors the blockchain and estimates the recommended gas prices for different tolerated delays
 */
export class FeeEstimator {
  blockData: DataFrame
  config: ServerConfigParams
  currentBlock: number
  initialized: Boolean
  feesTable?: FeesTable
  readonly web3: Web3
  worker?: Timeout
  workerSemaphore: Boolean

  constructor (config: Partial<ServerConfigParams>, provider: Web3Provider) {
    this.blockData = new DataFrame({})
    this.config = configureServer(config)
    this.currentBlock = 0
    this.initialized = false
    this.web3 = new Web3(provider)
    this.workerSemaphore = false
  }

  /**
   * Analyzes an interval of blocks, and returns a hashPower dataframe with the % of blocks accepting each gas prices
   * @param fromBlock the starting block where to begin the analysis
   * @param toBlock the last block that will be analyzed
   * @return hashPower accepting dataframe based on mingasprice accepted in block
   *
   * Example hashPower dataframe:
   *     | mingasprice | count     | cum_blocks | hashp_pct |
   *     ---------------------------------------------------
   *     | 300         | 1         | 1          | 21.42     |
   *     | 600         | 3         | 4          | 24.48     |
   *     | 610         | 2         | 6          | 26.53     |
   *     | 620         | 1         | 7          | 27.55     |
   *     | 640         | 1         | 8          | 28.57     |
   */
  analyzeBlocks (fromBlock: number, toBlock: number): DataFrame {
    fromBlock = (fromBlock < 0) ? 0 : fromBlock
    const recentBlocks = this.blockData.filter(
      (row: { get: (arg0: string) => number }) => (row.get('block_number') >= fromBlock && (row.get('block_number') <= toBlock))
    ).drop('blockhash').drop('time_mined')
    let hashPower = recentBlocks.groupBy('mingasprice')
      .aggregate((group: { count: () => number }) => group.count())
      .rename('aggregation', 'count')
      .sortBy('mingasprice')
    let cumsum = 0
    hashPower = hashPower.withColumn('cum_blocks', (row: { get: (arg0: string) => number }) => {
      cumsum = cumsum + row.get('count')
      return cumsum
    })
    const totalBlocks = hashPower.stat.sum('count')
    hashPower = hashPower.withColumn('hashp_pct', (row: { get: (arg0: string) => number }) => row.get('cum_blocks') / totalBlocks * 100)
    return hashPower
  }

  /**
   * Converts a BlockTransactionObject into a dataframe for further processing
   * @param blockObj the block object
   * @param timeMined the block timestamp
   * @param blockMinGasPrice the block minimum gas price
   * @return cleanBlockDf dataframe
   */
  cleanBlock (blockObj: BlockTransactionObject, timeMined: number, blockMinGasPrice: number): DataFrame {
    const cleanBlockDf = new DataFrame([
      {
        block_number: blockObj.number,
        blockhash: blockObj.hash.slice(2),
        time_mined: timeMined,
        mingasprice: blockMinGasPrice
      }
    ])
    return cleanBlockDf
  }

  /**
   * Converts a Transaction object into a dataframe for further processing
   * @param txObj the transaction object
   * @return cleanTxDf dataframe
   *
   * Example cleanTxDf dataframe:
   *     | tx_hash   | block_mined | gas_price   | round_gp_10gwei |
   *     ----------------------------------------------------------
   *     | 24d990... | 11641974    | 60000000000 | 600             |
   */
  cleanTx (txObj: Transaction): DataFrame {
    const roundGP10Gwei = this.roundGP10Gwei(txObj.gasPrice)
    const cleanTxDf = new DataFrame([
      {
        tx_hash: txObj.hash.slice(2),
        block_mined: txObj.blockNumber,
        gas_price: txObj.gasPrice,
        round_gp_10gwei: roundGP10Gwei
      }
    ])
    return cleanTxDf
  }

  /**
   * Gets the average standard gas price
   * @param predictTable a dataframe containing a prediction table
   * @return gas price accepted in STANDARD % of recent mined blocks
   */
  getAverage (predictTable: DataFrame): number {
    if (predictTable.count() > 0) {
      const average = predictTable.filter(
        (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') >= STANDARD
      ).stat.min('gasprice')
      return average / 10
    }
    return 0
  }

  /**
   * Gets the fast gas price
   * @param predictTable a dataframe containing a prediction table
   * @return gas price accepted in FAST % of recent mined blocks
   */
  getFast (predictTable: DataFrame): number {
    if (predictTable.count() > 0) {
      const fast = predictTable.filter(
        (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') >= FAST
      ).stat.min('gasprice')
      return fast / 10
    }
    return 0
  }

  /**
   * Gets the fastest gas price
   * @param predictTable a dataframe containing a prediction table
   * @return gas price accepted in the maximum % of blocks
   */
  getFastest (predictTable: DataFrame): number {
    if (predictTable.count() > 0) {
      const hpMax = predictTable.stat.max('hashpower_accepting')
      const fastest = predictTable.filter(
        (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') === hpMax
      ).stat.min('gasprice')
      return fastest / 10
    }
    return 0
  }

  /**
   * Estimates the minimum gas prices for the different delays
   * @param predictTable a dataframe containing a prediction table
   * @return a dataframe containing the estimated gas prices
   */
  getGasPriceRecs (predictTable: DataFrame): DataFrame {
    let gpRecs = new DataFrame({ gasprice: [this.getSafeLow(predictTable)] }, ['safeLow'])
    gpRecs = gpRecs.withColumn('standard', () => this.getAverage(predictTable))
    gpRecs = gpRecs.withColumn('fast', () => this.getFast(predictTable))
    gpRecs = gpRecs.withColumn('fastest', () => this.getFastest(predictTable))
    gpRecs = gpRecs.withColumn('blockTime', () => BLOCK_TIME)
    gpRecs = gpRecs.withColumn('blockNum', () => this.currentBlock)
    return gpRecs
  }

  /**
   * Gets the Hash Power Acceptance % of a provided gas price
   * @param gasPrice the gas price whose acceptance % is being estimated
   * @param hashPower the hashPower dataframe that contains the data
   * @return a number representing the % of blocks that accepted that gas price
   */
  getHPA (gasPrice: number, hashPower: DataFrame): number {
    let hpa = hashPower.filter(
      (row: { get: (arg0: string) => number }) => gasPrice >= row.get('mingasprice')
    ).drop('count').drop('cum_blocks')
    if (gasPrice > hashPower.stat.max('mingasprice')) {
      hpa = 100
    } else if (gasPrice < hashPower.stat.min('mingasprice')) {
      hpa = 0
    } else {
      hpa = hpa.stat.max('hashp_pct')
    }
    return hpa
  }

  /**
   * Gets the lowest gas price
   * @param predictTable a dataframe containing a prediction table
   * @return gas price accepted in minimum SAFELOW % of recent mined blocks
   */
  getSafeLow (predictTable: DataFrame): number {
    if (predictTable.count() > 0) {
      const safelow = predictTable.filter(
        (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') >= SAFELOW
      ).stat.min('gasprice')
      return safelow / 10
    }
    return 0
  }

  /**
   * Reads a hashPower dataframe and creates a gas prediction dataframe, that indicates the
   * acceptance rate of every gas price in the last {@link BLOCKS_TO_ANALYZE} blocks
   * @param hashPower the hashPower dataframe that contains the data to be processed
   * @return a predictTable dataframe
   *
   * Example predictTable dataframe:
   *     | gasprice  | hashpower_accepting |
   *     ----------------------------------
   *     | 600       | 51                  |
   *     | 640       | 56                  |
   *     | 700       | 68                  |
   *     | 720       | 70                  |
   */
  makePredictTable (hashPower: DataFrame): DataFrame {
    const predictTable = new DataFrame({ gasprice: hashPower.toArray('mingasprice') }, ['gasprice'])
      .sortBy('gasprice')
      .withColumn('hashpower_accepting', (row: { get: (arg0: string) => any }) => {
        const gasPrice = row.get('gasprice')
        return this.getHPA(gasPrice, hashPower)
      })
    return predictTable
  }

  /**
   * Reads a block dataframe containing the information of every tx in that block, and a block
   * object retrieved from the node, and prepares a clean block dataframe that includes the
   * information needed for further processing
   * @param blockDf the block dataframe containing the tx data
   * @param blockObj the BlockTransactionObject received from the node
   * @return a cleanBlock dataframe
   *
   * Example cleanBlock dataframe:
   *
   *     | block_number | blockhash | time_mined | mingasprice |
   *     ------------------------------------------------------
   *     | 11641919     | 1d9c64... | 161047...  | 450         |
   *
   */
  processBlockData (blockDf: DataFrame, blockObj: BlockTransactionObject): DataFrame {
    let blockMinGasPrice
    if (blockObj.transactions.length > 0) {
      blockMinGasPrice = blockDf.stat.min('round_gp_10gwei')
    } else {
      blockMinGasPrice = null
    }
    const timeMined = blockDf.stat.min('time_mined')
    return this.cleanBlock(blockObj, timeMined, blockMinGasPrice)
  }

  /**
   * Rounds a gas price expressed in Wei to ten Gwei
   * @param gasPrice a gas price expressed in Wei
   * @return gas price expressed in ten Gwei
   */
  roundGP10Gwei (gasPrice: string): number {
    let gp = parseInt(gasPrice) / 1e8
    if (gp >= 1 && gp < 10) {
      gp = Math.floor(gp)
    } else if (gp >= 10) {
      gp = gp / 10
      gp = Math.floor(gp)
      gp = gp * 10
    }
    return gp
  }

  /**
   * The Fee Estimator requires initialization to start scanning for blocks and processing the data. First
   * it establishes the connection with the node, then updates with the last BLOCKS_TO_ANALYZE blocks and
   * sets up a worker that will run updates every GsnConfig.checkInterval ms
   */
  async start (): Promise<void> {
    if (!this.initialized) {
      try {
        this.initialized = true
        await this.web3.eth.net.isListening()
        this.currentBlock = await this.web3.eth.getBlockNumber()
        const fromBlock = (this.currentBlock < BLOCKS_TO_ANALYZE) ? 0 : this.currentBlock - BLOCKS_TO_ANALYZE
        await this.processBlocks(fromBlock, this.currentBlock)
        this.updateFeesTable()
        this.worker = setInterval(() => this.workerJob(), this.config.checkInterval)
      } catch (error) {
        console.error(error)
        throw new Error('Error initializing Fee Estimator')
      }
    }
  }

  /**
   * If the main component is stopped, the worker is stopped too
   */
  stop (): void {
    if (typeof this.worker !== 'undefined') {
      clearInterval(this.worker)
      this.initialized = false
    }
  }

  /**
   * The main worker job that will update the Fees Table when new blocks are being mined.
   * A worker semaphore (mutex) has been added to ensure that only one process is running at a time.
   */
  workerJob (): void {
    if (!this.workerSemaphore) {
      this.workerSemaphore = true
      this.web3.eth.getBlock('latest').then(async (latestBlock) => {
        if (this.currentBlock < latestBlock.number) {
          await this.processBlocks(this.currentBlock, latestBlock.number)
          this.updateFeesTable()
          this.cleanOlderBlocks()
        }
        this.workerSemaphore = false
      }).catch(e => {
        console.error(e)
        this.workerSemaphore = false
      })
    }
  }

  /**
   * Reads every tx of a given block and returns the processed dataframe
   * @param blockNumber the number of the block to be processed
   * @return an array containing the tx in a blockDf dataframe and the BlockTransactionObject
   *
   * Example blockDf dataframe:
   *     | tx_hash   | block_number | gas_price | round_gp10gwei | time_mined |
   *     ---------------------------------------------------------------------
   *     | cd3336... | 11642023     | 207000... | 2070           | 161047...  |
   *     | 719b8a... | 11642023     | 111000... | 1110           | 161047...  |
   *     | e33db9... | 11642023     | 890000... | 890            | 161047...  |
   *     | 33fd58... | 11642023     | 840000... | 840            | 161047...  |
   */
  async processBlockTx (blockNumber: number): Promise<any[]> {
    let blockDf = new DataFrame({})
    const blockObj = await this.web3.eth.getBlock(blockNumber, true)
    if (blockObj === null) {
      return ([null, null, 'This block doesn\'t exist'])
    }
    for (const transaction of blockObj.transactions) {
      if (transaction.gasPrice !== '0') {
        const cleanTx = this.cleanTx(transaction)
        blockDf = blockDf.union(cleanTx)
      }
    }
    blockDf = blockDf.withColumn('time_mined', () => blockObj.timestamp)
    return ([blockDf, blockObj, null])
  }

  /**
   * The main processing function that reads the given blocks, processes the block data
   * and updates the blockData dataframe with the new information
   * @param fromBlock the block number where to start the processing
   * @param toBlock the block number where to end the processing
   */
  async processBlocks (fromBlock: number, toBlock: number): Promise<void> {
    for (let x = fromBlock; x < toBlock; x++) {
      const [minedBlockDf, blockObj, error] = await this.processBlockTx(x)
      if (error === null) {
        if (minedBlockDf.count() > 0) {
          const blockSumDf = this.processBlockData(minedBlockDf, blockObj)
          this.blockData = blockSumDf.diff(this.blockData, ['block_number', 'blockhash', 'time_mined', 'mingasprice'])
        }
        this.currentBlock = x
      }
    }
  }

  /**
   * Removes the old block data to free memory, cleaning blocks older than BLOCKS_TO_ANALYZE blocks
   */
  cleanOlderBlocks (): void {
    const rowsCount = this.blockData.count()
    if (rowsCount > BLOCKS_TO_ANALYZE) {
      const lastBlock = this.blockData.stat.max('block_number')
      this.blockData = this.blockData.filter((row: { get: (arg0: string) => number }) => row.get('block_number') >= (lastBlock - BLOCKS_TO_ANALYZE))
    }
  }

  /**
   * Updates the Fees Table, first analyzing the last BLOCKS_TO_ANALYZE blocks, generating
   * a new Prediction Table dataframe and estimating the corresponding recommended gas prices
   */
  updateFeesTable (): void {
    const hashPower = this.analyzeBlocks(this.currentBlock - BLOCKS_TO_ANALYZE, this.currentBlock)
    const predictionDf = this.makePredictTable(hashPower)
    const gpRecs = this.getGasPriceRecs(predictionDf).toDict()
    this.feesTable = {
      safeLow: gpRecs.safeLow[0],
      standard: gpRecs.standard[0],
      fast: gpRecs.fast[0],
      fastest: gpRecs.fastest[0],
      blockTime: gpRecs.blockTime[0],
      blockNum: gpRecs.blockNum[0]
    }
  }
}

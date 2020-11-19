// @ts-ignore
import { DataFrame } from 'dataframe-js'
import { EventEmitter } from 'events'
import { configureServer, ServerConfigParams } from '../relayserver/ServerConfigParams'
import { BlockTransactionObject } from 'web3-eth'
import { Transaction } from 'web3-core'
import Web3 from 'web3'
import Timeout = NodeJS.Timeout

const BLOCK_TIME = 20
const SAFELOW = 35
const STANDARD = 60
const FAST = 90

export interface FeesTable {
  safeLow: number
  standard: number
  fast: number
  fastest: number
  blockTime: number
  blockNum: number
}

export class FeeEstimator {
  allTxDf: DataFrame
  blockData: DataFrame
  config: ServerConfigParams
  currentBlock: number
  eventEmitter: EventEmitter
  initialized: Boolean
  newBlockListener?: Timeout
  pendingTx: string[]
  feesTable: FeesTable
  worker?: Timeout
  readonly web3: Web3

  constructor (config: Partial<ServerConfigParams>, web3: Web3) {
    this.allTxDf = new DataFrame({})
    this.blockData = new DataFrame({})
    this.config = configureServer(config)
    this.currentBlock = 0
    this.eventEmitter = new EventEmitter()
    this.initialized = false
    this.feesTable = { safeLow: 0, standard: 0, fast: 0, fastest: 0, blockNum: 0, blockTime: 0 }
    this.pendingTx = []
    this.web3 = web3
  }

  analyzeLast200Blocks=(): DataFrame => {
    const recentBlocks = this.blockData.filter(
      (row: { get: (arg0: string) => number }) => row.get('block_number') > (this.currentBlock - 200)
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

  cleanBlock=(blockObj: BlockTransactionObject, timeMined: number, blockMinGasPrice: number): DataFrame => {
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

  cleanTx=(txObj: Transaction): DataFrame => {
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

  getAverage=(predictTable: DataFrame): number => {
    const average = predictTable.filter(
      (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') >= STANDARD
    ).stat.min('gasprice')
    return average / 10
  }

  getFast=(predictTable: DataFrame): number => {
    const fast = predictTable.filter(
      (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') >= FAST
    ).stat.min('gasprice')
    return fast / 10
  }

  getFastest=(predictTable: DataFrame): number => {
    const hpMax = predictTable.stat.max('hashpower_accepting')
    const fastest = predictTable.filter(
      (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') === hpMax
    ).stat.min('gasprice')
    return fastest / 10
  }

  getGasPriceRecs=(predictTable: DataFrame): DataFrame => {
    let gpRecs = new DataFrame({ gasprice: [this.getSafeLow(predictTable)] }, ['safeLow'])
    gpRecs = gpRecs.withColumn('standard', () => this.getAverage(predictTable))
    gpRecs = gpRecs.withColumn('fast', () => this.getFast(predictTable))
    gpRecs = gpRecs.withColumn('fastest', () => this.getFastest(predictTable))
    gpRecs = gpRecs.withColumn('blockTime', () => BLOCK_TIME)
    gpRecs = gpRecs.withColumn('blockNum', () => this.currentBlock)
    return gpRecs
  }

  getHPA=(gasPrice: number, hashPower: DataFrame): number => {
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

  getSafeLow=(predictTable: DataFrame): number => {
    const safelow = predictTable.filter(
      (row: { get: (arg0: string) => number }) => row.get('hashpower_accepting') >= SAFELOW
    ).stat.min('gasprice')
    return safelow / 10
  }

  makePredictTable=(hashPower: DataFrame): DataFrame => {
    const pTable1 = []
    for (let x = 10; x < 1010; x = x + 10) {
      pTable1.push(x)
    }
    let predictTable = new DataFrame({ gasprice: pTable1 }, ['gasprice'])
    const pTable2 = new DataFrame({ gasprice: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }, ['gasprice'])
    predictTable = predictTable.union(pTable2).sortBy('gasprice')
    predictTable = predictTable.withColumn('hashpower_accepting', (row: { get: (arg0: string) => any }) => {
      const gasPrice = row.get('gasprice')
      return this.getHPA(gasPrice, hashPower)
    })
    return predictTable
  }

  processBlockData=(blockDf: DataFrame, blockObj: BlockTransactionObject): DataFrame => {
    let blockMinGasPrice
    if (blockObj.transactions.length > 0) {
      blockMinGasPrice = blockDf.stat.min('round_gp_10gwei')
    } else {
      blockMinGasPrice = null
    }
    const timeMined = blockDf.stat.min('time_mined')
    const cleanBlock = this.cleanBlock(blockObj, timeMined, blockMinGasPrice)
    return cleanBlock
  }

  roundGP10Gwei=(gasPrice: string): number => {
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

  start=(): void => {
    this.web3.eth.getBlockNumber().then((blockNumber) => {
      this.currentBlock = blockNumber
      this.processPastBlocks().then(async () => {
        this.initialized = true
        this.worker = setInterval(() => {
          this.web3.eth.getBlockNumber().then((block) => {
            if (this.currentBlock < block) {
              this.updateDataframes().then(() => {
                this.currentBlock++
              }).catch(e => { throw e })
            }
          }).catch(e => { throw e })
        }, this.config.checkInterval)
      }).catch(e => { throw e })
    }).catch(e => {
      console.error(e)
    })
  }

  async processBlockTx (blockNumber: number): Promise<any[]> {
    let blockDf = new DataFrame({})
    const blockObj = await this.web3.eth.getBlock(blockNumber, true)
    for (const transaction of blockObj.transactions) {
      if (transaction.gasPrice !== '0') {
        const cleanTx = this.cleanTx(transaction)
        blockDf = blockDf.union(cleanTx)
      }
    }
    blockDf = blockDf.withColumn('time_mined', () => blockObj.timestamp)
    return ([blockDf, blockObj])
  }

  async processPastBlocks (): Promise<void> {
    let pastBlock = (this.currentBlock < 100) ? 0 : this.currentBlock - 100
    for (pastBlock; pastBlock < this.currentBlock; pastBlock++) {
      const [minedBlockDf, blockObj] = await this.processBlockTx(pastBlock)
      if (minedBlockDf.count() > 0) {
        this.allTxDf = this.allTxDf.union(minedBlockDf)
        const blockSumDf = this.processBlockData(minedBlockDf, blockObj)
        this.blockData = this.blockData.union(blockSumDf)
      }
    }
  }

  async updateDataframes (): Promise<void> {
    const [minedBlockDf, blockObj] = await this.processBlockTx(this.currentBlock)
    if (minedBlockDf.count() > 0) {
      this.allTxDf = this.allTxDf.union(minedBlockDf)
      const blockSumDf = this.processBlockData(minedBlockDf, blockObj)
      this.blockData = this.blockData.union(blockSumDf)
    }
    const hashPower = this.analyzeLast200Blocks()
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

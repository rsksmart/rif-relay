import chalk from 'chalk'
import log from 'loglevel'
import ow from 'ow'
import { EventData } from 'web3-eth-contract'
import { EventEmitter } from 'events'
import { PrefixedHexString } from 'ethereumjs-tx'
import { toBN } from 'web3-utils'

import { IRelayVerifierInstance, IRelayHubInstance, IDeployVerifierInstance } from '../../types/truffle-contracts'

import ContractInteractor, { TransactionRejectedByRecipient, TransactionRelayed } from '../common/ContractInteractor'
import { Address } from '../relayclient/types/Aliases'
import { DeployTransactionRequest, DeployTransactionRequestShape, RelayTransactionRequest, RelayTransactionRequestShape } from '../relayclient/types/RelayTransactionRequest'

import PingResponse from '../common/PingResponse'
import VersionsManager from '../common/VersionsManager'
import { AmountRequired } from '../common/AmountRequired'
import {
  address2topic,
  calculateTransactionMaxPossibleGas,
  getLatestEventData,
  randomInRange,
  sleep
} from '../common/Utils'

import { replenishStrategy } from './ReplenishFunction'
import { RegistrationManager } from './RegistrationManager'
import { SendTransactionDetails, SignedTransactionDetails, TransactionManager } from './TransactionManager'
import { ServerAction } from './StoredTransaction'
import { TxStoreManager } from './TxStoreManager'
import { configureServer, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import { constants } from '../common/Constants'
import { DeployRequest, RelayRequest } from '../common/EIP712/RelayRequest'
import TokenResponse from '../common/TokenResponse'
import VerifierResponse from '../common/VerifierResponse'

import Timeout = NodeJS.Timeout

const VERSION = '2.0.1'
const PARAMETERS_COST = 43782

export class RelayServer extends EventEmitter {
  lastScannedBlock = 0
  lastRefreshBlock = 0
  ready = false
  lastSuccessfulRounds = Number.MAX_SAFE_INTEGER
  readonly managerAddress: PrefixedHexString
  readonly workerAddress: PrefixedHexString
  gasPrice: number = 0
  _workerSemaphoreOn = false
  alerted = false
  alertedBlock: number = 0
  private initialized = false
  readonly contractInteractor: ContractInteractor
  private readonly versionManager: VersionsManager
  private workerTask?: Timeout
  config: ServerConfigParams
  transactionManager: TransactionManager
  txStoreManager: TxStoreManager

  lastMinedActiveTransaction?: EventData

  registrationManager!: RegistrationManager
  chainId!: number
  networkId!: number
  relayHubContract!: IRelayHubInstance

  trustedVerifiers: Set<String | undefined> = new Set<String | undefined>()

  workerBalanceRequired: AmountRequired

  private readonly customReplenish: boolean

  constructor (config: Partial<ServerConfigParams>, dependencies: ServerDependencies) {
    super()
    this.versionManager = new VersionsManager(VERSION)
    this.config = configureServer(config)
    this.contractInteractor = dependencies.contractInteractor
    this.txStoreManager = dependencies.txStoreManager
    this.transactionManager = new TransactionManager(dependencies, this.config)
    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.workerAddress = this.transactionManager.workersKeyManager.getAddress(0)
    this.customReplenish = this.config.customReplenish
    this.workerBalanceRequired = new AmountRequired('Worker Balance', toBN(this.config.workerMinBalance))
    this.printServerAddresses()
    log.setLevel(this.config.logLevel)
    log.warn('RelayServer version', VERSION)
    log.info('Using server configuration:\n', this.config)
  }

  printServerAddresses (): void {
    log.info(`Server manager address  | ${this.managerAddress}`)
    log.info(`Server worker  address  | ${this.workerAddress}`)
  }

  getMinGasPrice (): number {
    return this.gasPrice
  }

  isCustomReplenish (): boolean {
    return this.customReplenish
  }

  async pingHandler (verifier?: string): Promise<PingResponse> {
    return {
      relayWorkerAddress: this.workerAddress,
      relayManagerAddress: this.managerAddress,
      relayHubAddress: this.relayHubContract?.address ?? '',
      minGasPrice: this.getMinGasPrice().toString(),
      chainId: this.chainId.toString(),
      networkId: this.networkId.toString(),
      ready: this.isReady() ?? false,
      version: VERSION
    }
  }

  async tokenHandler (verifier: Address): Promise<TokenResponse> {
    let verifiersToQuery: Address[]

    // if a verifier was supplied, check that it is trusted
    if (verifier !== undefined) {
      if (!this.trustedVerifiers.has(verifier.toLowerCase())) {
        throw new Error('supplied verifier is not trusted')
      }
      verifiersToQuery = [verifier]
    } else {
      // if no verifier was supplied, query all tursted verifiers
      verifiersToQuery = Array.from(this.trustedVerifiers) as Address[]
    }

    const res: TokenResponse = {}
    for (const verifier of verifiersToQuery) {
      const tokenHandlerInstance = await this.contractInteractor.createTokenHandler(verifier)
      const acceptedTokens = await tokenHandlerInstance.contract.methods.getAcceptedTokens()
      res[verifier] = acceptedTokens
    };

    return res
  }

  async verifierHandler (): Promise<VerifierResponse> {
    return {
      trustedVerifiers: Array.from(this.trustedVerifiers) as Address[]
    }
  }

  isDeployRequest (req: any): boolean {
    let isDeploy = false
    if (req.relayRequest.request.recoverer !== undefined) {
      isDeploy = true
    }
    return isDeploy
  }

  validateInputTypes (req: RelayTransactionRequest | DeployTransactionRequest): void {
    if (this.isDeployRequest(req)) {
      ow(req, ow.object.exactShape(DeployTransactionRequestShape))
    } else {
      ow(req, ow.object.exactShape(RelayTransactionRequestShape))
    }
  }

  validateInput (req: RelayTransactionRequest | DeployTransactionRequest): void {
    // Check that the relayHub is the correct one
    if (req.metadata.relayHubAddress.toLowerCase() !== this.relayHubContract.address.toLowerCase()) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract.address}, request's hub address: ${req.metadata.relayHubAddress}\n`)
    }

    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    if (req.relayRequest.relayData.relayWorker.toLowerCase() !== this.workerAddress.toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`)
    }

    // Check that the gasPrice is initialized & acceptable
    if (this.gasPrice > parseInt(req.relayRequest.relayData.gasPrice)) {
      throw new Error(
        `Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice} request's gasPrice: ${req.relayRequest.relayData.gasPrice}`)
    }
  }

  validateVerifier (req: RelayTransactionRequest | DeployTransactionRequest): void {
    if (!this.isTrustedVerifier(req.relayRequest.relayData.callVerifier)) {
      throw new Error(`Invalid verifier: ${req.relayRequest.relayData.callVerifier}`)
    }
  }

  async validateMaxNonce (relayMaxNonce: number): Promise<void> {
    // Check that max nonce is valid
    const nonce = await this.transactionManager.pollNonce(this.workerAddress)
    if (nonce > relayMaxNonce) {
      throw new Error(`Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`)
    }
  }

  async validateRequestWithVerifier (verifier: Address, req: RelayTransactionRequest|DeployTransactionRequest): Promise<{maxPossibleGas: number}> {
    if (!this.isTrustedVerifier(verifier)) {
      throw new Error('Invalid verifier')
    }

    let verifierContract: IRelayVerifierInstance | IDeployVerifierInstance
    try {
      if (this.isDeployRequest(req)) {
        verifierContract = await this.contractInteractor._createDeployVerifier(verifier)
      } else {
        verifierContract = await this.contractInteractor._createRelayVerifier(verifier)
      }
    } catch (e) {
      const error = e as Error
      let message = `unknown verifier error: ${error.message}`
      if (error.message.includes('Returned values aren\'t valid, did it run Out of Gas?')) {
        message = `incompatible verifier contract: ${verifier}`
      } else if (error.message.includes('no code at address')) {
        message = `'non-existent verifier contract: ${verifier}`
      }
      throw new Error(message)
    }

    const gasAlreadyUsedBeforeDoingAnythingInRelayCall = PARAMETERS_COST // the hubOverhead needs a cushion, which is the gas used to just receive the parameters
    // TODO , move the cushion to the gasOverhead once it is calculated properly
    const hubOverhead = (await this.relayHubContract.gasOverhead()).toNumber()
    const maxPossibleGas = calculateTransactionMaxPossibleGas(
      hubOverhead,
      req.relayRequest.request.gas,
      gasAlreadyUsedBeforeDoingAnythingInRelayCall
    )

    try {
      if (this.isDeployRequest(req)) {
        await (verifierContract as IDeployVerifierInstance).contract.methods.verifyRelayedCall((req as DeployTransactionRequest).relayRequest, req.metadata.signature).call({ from: this.workerAddress }, 'pending')
      } else {
        await (verifierContract as IRelayVerifierInstance).contract.methods.verifyRelayedCall((req as RelayTransactionRequest).relayRequest, req.metadata.signature).call({ from: this.workerAddress }, 'pending')
      }
    } catch (e) {
      const error = e as Error
      throw new Error(`Verification by verifier failed: ${error.message}`)
    }

    return { maxPossibleGas }
  }

  async validateViewCallSucceeds (method: any, req: RelayTransactionRequest|DeployTransactionRequest, maxPossibleGas: number): Promise<void> {
    // const gasEstimated = await method.estimateGas({from: this.workerAddress,
    // gasPrice:req.relayRequest.relayData.gasPrice})
    try {
      await method.call({
        from: this.workerAddress,
        gasPrice: req.relayRequest.relayData.gasPrice,
        gas: maxPossibleGas
      }, 'pending')
    } catch (e) {
      throw new Error(`relayCall (local call) reverted in server: ${(e as Error).message}`)
    }
  }

  async createRelayTransaction (req: RelayTransactionRequest | DeployTransactionRequest): Promise<PrefixedHexString> {
    log.debug(`dump request params: ${JSON.stringify(req)}`)
    if (!this.isReady()) {
      throw new Error('relay not ready')
    }
    this.validateInputTypes(req)

    if (this.alerted) {
      log.error('Alerted state: slowing down traffic')
      await sleep(randomInRange(this.config.minAlertedDelayMS, this.config.maxAlertedDelayMS))
    }
    this.validateInput(req)
    this.validateVerifier(req)
    await this.validateMaxNonce(req.metadata.relayMaxNonce)

    if (!this.isTrustedVerifier(req.relayRequest.relayData.callVerifier)) {
      throw new Error('Specified Verifier is not Trusted')
    }
    const { maxPossibleGas } = await this.validateRequestWithVerifier(req.relayRequest.relayData.callVerifier, req)

    // Send relayed transaction
    log.debug('maxPossibleGas is', maxPossibleGas)

    const isDeploy = this.isDeployRequest(req)

    const method = isDeploy ? this.relayHubContract.contract.methods.deployCall(
      req.relayRequest as DeployRequest, req.metadata.signature) : this.relayHubContract.contract.methods.relayCall(
      req.relayRequest as RelayRequest, req.metadata.signature)

    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    await this.validateViewCallSucceeds(method, req, maxPossibleGas)
    const currentBlock = await this.contractInteractor.getBlockNumber()
    const details: SendTransactionDetails =
      {
        signer: this.workerAddress,
        serverAction: ServerAction.RELAY_CALL,
        method,
        destination: req.metadata.relayHubAddress,
        gasLimit: maxPossibleGas,
        creationBlockNumber: currentBlock,
        gasPrice: req.relayRequest.relayData.gasPrice
      }
    const { signedTx } = await this.transactionManager.sendTransaction(details)
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(0, currentBlock)
    return signedTx
  }

  async intervalHandler (): Promise<void> {
    const now = Date.now()
    let workerTimeout: Timeout
    if (!this.config.devMode) {
      workerTimeout = setTimeout(() => {
        const timedOut = Date.now() - now
        log.warn(chalk.bgRedBright(`Relay state: Timed-out after ${timedOut}`))

        this.lastSuccessfulRounds = 0
      }, this.config.readyTimeout)
    }

    return this.contractInteractor.getBlock('latest')
      .then(
        block => {
          if (block.number > this.lastScannedBlock) {
            return this._workerSemaphore.bind(this)(block.number)
          }
        })
      .catch((e) => {
        this.emit('error', e)
        const error = e as Error
        log.error(`error in worker: ${error.message} ${error.stack}`)
        this.lastSuccessfulRounds = 0
      })
      .finally(() => {
        clearTimeout(workerTimeout)
      })
  }

  start (): void {
    log.debug(`Started polling for new blocks every ${this.config.checkInterval}ms`)
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.workerTask = setInterval(this.intervalHandler.bind(this), this.config.checkInterval)
  }

  stop (): void {
    if (this.workerTask == null) {
      throw new Error('Server not started')
    }
    clearInterval(this.workerTask)
    log.info('Successfully stopped polling!!')
  }

  async _workerSemaphore (blockNumber: number): Promise<void> {
    if (this._workerSemaphoreOn) {
      log.warn('Different worker is not finished yet, skipping this block')
      return
    }
    this._workerSemaphoreOn = true

    await this._worker(blockNumber)
      .then((transactions) => {
        this.lastSuccessfulRounds++

        if (transactions.length !== 0) {
          log.debug(`Done handling block #${blockNumber}. Created ${transactions.length} transactions.`)
        }
      })
      .finally(() => {
        this._workerSemaphoreOn = false
      })
  }

  fatal (message: string): void {
    log.error('FATAL: ' + message)
    process.exit(1)
  }

  /***
   * initialize data from trusted verifiers.
   * "Trusted" verifiers means that:
   * - we trust verifyRelayedCall to be consistent: off-chain call and on-chain calls should either both succeed
   *    or both revert.
   *
   * @param verifiers list of trusted verifiers addresses
   */
  async _initTrustedVerifiers (verifiers: string[] = []): Promise<void> {
    this.trustedVerifiers.clear()
    for (const verifierAddress of verifiers) {
      this.trustedVerifiers.add(verifierAddress.toLowerCase())
    }
    if (this.config.relayVerifierAddress !== constants.ZERO_ADDRESS && !this.trustedVerifiers.has(this.config.relayVerifierAddress.toLowerCase())) {
      this.trustedVerifiers.add(this.config.relayVerifierAddress.toLowerCase())
    }
    if (this.config.deployVerifierAddress !== constants.ZERO_ADDRESS && !this.trustedVerifiers.has(this.config.deployVerifierAddress.toLowerCase())) {
      this.trustedVerifiers.add(this.config.deployVerifierAddress.toLowerCase())
    }
  }

  async init (): Promise<void> {
    if (this.initialized) {
      throw new Error('_init was already called')
    }

    await this.transactionManager._init()
    await this._initTrustedVerifiers(this.config.trustedVerifiers)
    this.relayHubContract = this.contractInteractor.relayHubInstance

    const relayHubAddress = this.relayHubContract.address
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    }

    this.registrationManager = new RegistrationManager(
      this.contractInteractor,
      this.transactionManager,
      this.txStoreManager,
      this,
      this.config,
      this.managerAddress,
      this.workerAddress
    )
    await this.registrationManager.init()

    this.chainId = this.contractInteractor.getChainId()
    this.networkId = this.contractInteractor.getNetworkId()

    /* TODO CHECK against RSK ChainId
    if (this.config.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      log.error('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    */

    const latestBlock = await this.contractInteractor.getBlock('latest')
    log.info(`Current network info:
chainId                 | ${this.chainId}
networkId               | ${this.networkId}
latestBlock             | ${latestBlock.number}
latestBlock timestamp   | ${latestBlock.timestamp}
`)
    this.initialized = true

    // Assume started server is not registered until _worker figures stuff out
    this.registrationManager.printNotRegisteredMessage()
  }

  /**
   * It withdraws excess balance from the relayHub to the relayManager, and refills the relayWorker with
   * balance if required.
   * @param workerIndex Not used so it can be any number
   * @param currentBlock Where to place the replenish action
   */

  async replenishServer (workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]> {
    return await replenishStrategy(this, workerIndex, currentBlock)
  }

  async _worker (blockNumber: number): Promise<PrefixedHexString[]> {
    if (!this.initialized) {
      await this.init()
    }
    if (blockNumber <= this.lastScannedBlock) {
      throw new Error('Attempt to scan older block, aborting')
    }
    if (!this._shouldRefreshState(blockNumber)) {
      return []
    }
    this.lastRefreshBlock = blockNumber
    await this._refreshGasPrice()
    await this.registrationManager.refreshBalance()
    if (!this.registrationManager.balanceRequired.isSatisfied) {
      this.setReadyState(false)
      return []
    }
    return await this._handleChanges(blockNumber)
  }

  async _refreshGasPrice (): Promise<void> {
    const gasPriceString = await this.contractInteractor.getGasPrice()
    this.gasPrice = Math.floor(parseInt(gasPriceString) * this.config.gasPriceFactor)
    if (this.gasPrice === 0) {
      throw new Error('Could not get gasPrice from node')
    }
  }

  async _handleChanges (currentBlockNumber: number): Promise<PrefixedHexString[]> {
    let transactionHashes: PrefixedHexString[] = []
    const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan()
    await this._updateLatestTxBlockNumber(hubEventsSinceLastScan)
    const shouldRegisterAgain = await this._shouldRegisterAgain(currentBlockNumber, hubEventsSinceLastScan)
    transactionHashes = transactionHashes.concat(await this.registrationManager.handlePastEvents(hubEventsSinceLastScan, this.lastScannedBlock, currentBlockNumber, shouldRegisterAgain))
    await this.transactionManager.removeConfirmedTransactions(currentBlockNumber)
    await this._boostStuckPendingTransactions(currentBlockNumber)
    this.lastScannedBlock = currentBlockNumber
    const isRegistered = await this.registrationManager.isRegistered()
    if (!isRegistered) {
      this.setReadyState(false)
      return transactionHashes
    }
    await this.handlePastHubEvents(currentBlockNumber, hubEventsSinceLastScan)
    const workerIndex = 0
    transactionHashes = transactionHashes.concat(await this.replenishServer(workerIndex, currentBlockNumber))
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (workerBalance.lt(toBN(this.config.workerMinBalance))) {
      this.setReadyState(false)
      return transactionHashes
    }
    this.setReadyState(true)
    if (this.alerted && this.alertedBlock + this.config.alertedBlockDelay < currentBlockNumber) {
      log.warn(`Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${currentBlockNumber}`)
      this.alerted = false
    }
    return transactionHashes
  }

  async getManagerBalance (): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.managerAddress, 'pending'))
  }

  async getWorkerBalance (workerIndex: number): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.workerAddress, 'pending'))
  }

  async _shouldRegisterAgain (currentBlock: number, hubEventsSinceLastScan: EventData[]): Promise<boolean> {
    const isPendingActivityTransaction =
      (await this.txStoreManager.isActionPending(ServerAction.RELAY_CALL)) ||
      (await this.txStoreManager.isActionPending(ServerAction.REGISTER_SERVER))
    if (this.config.registrationBlockRate === 0 || isPendingActivityTransaction) {
      log.debug(`_shouldRegisterAgain returns false isPendingActivityTransaction=${isPendingActivityTransaction} registrationBlockRate=${this.config.registrationBlockRate}`)
      return false
    }
    const latestTxBlockNumber = this._getLatestTxBlockNumber()
    const registrationExpired = currentBlock - latestTxBlockNumber >= this.config.registrationBlockRate
    if (!registrationExpired) {
      log.debug(`_shouldRegisterAgain registrationExpired=${registrationExpired} currentBlock=${currentBlock} latestTxBlockNumber=${latestTxBlockNumber} registrationBlockRate=${this.config.registrationBlockRate}`)
    }
    return registrationExpired
  }

  _shouldRefreshState (currentBlock: number): boolean {
    return currentBlock - this.lastRefreshBlock >= this.config.refreshStateTimeoutBlocks || !this.isReady()
  }

  async handlePastHubEvents (currentBlockNumber: number, hubEventsSinceLastScan: EventData[]): Promise<void> {
    for (const event of hubEventsSinceLastScan) {
      switch (event.event) {
        case TransactionRejectedByRecipient:
          log.debug('handle TransactionRejectedByRecipient event', event)
          await this._handleTransactionRejectedByRecipientEvent(currentBlockNumber)
          break
        case TransactionRelayed:
          log.debug(`handle TransactionRelayed event: ${JSON.stringify(event)}`)
          await this._handleTransactionRelayedEvent(event)
          break
      }
    }
  }

  async getAllHubEventsSinceLastScan (): Promise<EventData[]> {
    const topics = [address2topic(this.managerAddress)]
    const options = {
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest'
    }
    const events = await this.contractInteractor.getPastEventsForHub(topics, options)
    if (events.length !== 0) {
      log.debug(`Found ${events.length} events since last scan`)
    }
    return events
  }

  async _handleTransactionRelayedEvent (event: EventData): Promise<void> {
    // Here put anything that needs to be performed after a Transaction gets relayed
  }

  async _handleTransactionRejectedByRecipientEvent (blockNumber: number): Promise<void> {
    this.alerted = true
    this.alertedBlock = blockNumber
    log.error(`Relay entered alerted state. Block number: ${blockNumber}`)
  }

  _getLatestTxBlockNumber (): number {
    return this.lastMinedActiveTransaction?.blockNumber ?? -1
  }

  async _updateLatestTxBlockNumber (eventsSinceLastScan: EventData[]): Promise<void> {
    const latestTransactionSinceLastScan = getLatestEventData(eventsSinceLastScan)
    if (latestTransactionSinceLastScan != null) {
      this.lastMinedActiveTransaction = latestTransactionSinceLastScan
      log.debug(`found newer block ${this.lastMinedActiveTransaction?.blockNumber}`)
    }
    if (this.lastMinedActiveTransaction == null) {
      this.lastMinedActiveTransaction = await this._queryLatestActiveEvent()
      log.debug(`queried node for last active server event, found in block ${this.lastMinedActiveTransaction?.blockNumber}`)
    }
  }

  async _queryLatestActiveEvent (): Promise<EventData | undefined> {
    const events: EventData[] = await this.contractInteractor.getPastEventsForHub([address2topic(this.managerAddress)], {
      fromBlock: 1
    })
    return getLatestEventData(events)
  }

  /**
   * Resend all outgoing pending transactions with insufficient gas price by all signers (manager, workers)
   * @return the mapping of the previous transaction hash to details of a new boosted transaction
   */
  async _boostStuckPendingTransactions (blockNumber: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    const transactionDetails = new Map<PrefixedHexString, SignedTransactionDetails>()
    // repeat separately for each signer (manager, all workers)
    const managerBoostedTransactions = await this._boostStuckTransactionsForManager(blockNumber)
    for (const [txHash, boostedTxDetails] of managerBoostedTransactions) {
      transactionDetails.set(txHash, boostedTxDetails)
    }
    for (const workerIndex of [0]) {
      const workerBoostedTransactions = await this._boostStuckTransactionsForWorker(blockNumber, workerIndex)
      for (const [txHash, boostedTxDetails] of workerBoostedTransactions) {
        transactionDetails.set(txHash, boostedTxDetails)
      }
    }
    return transactionDetails
  }

  async _boostStuckTransactionsForManager (blockNumber: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(this.managerAddress, blockNumber)
  }

  async _boostStuckTransactionsForWorker (blockNumber: number, workerIndex: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    const signer = this.workerAddress
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(signer, blockNumber)
  }

  isTrustedVerifier (verifier: string): boolean {
    return this.trustedVerifiers.has(verifier.toLowerCase())
  }

  isReady (): boolean {
    if (this.lastSuccessfulRounds < this.config.successfulRoundsForReady) {
      return false
    }
    return this.ready
  }

  setReadyState (isReady: boolean): void {
    if (this.isReady() !== isReady) {
      if (isReady) {
        if (this.lastSuccessfulRounds < this.config.successfulRoundsForReady) {
          const roundsUntilReady = this.config.successfulRoundsForReady - this.lastSuccessfulRounds
          log.warn(chalk.yellow(`Relayer state: almost READY (in ${roundsUntilReady} rounds)`))
        } else {
          log.warn(chalk.greenBright('Relayer state: READY'))
        }
      } else {
        log.warn(chalk.redBright('Relayer state: NOT-READY'))
      }
    }
    this.ready = isReady
  }
}

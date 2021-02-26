import log from 'loglevel'
import { HttpProvider } from 'web3-core'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'

import { constants } from '../common/Constants'

import { DeployRequest, RelayRequest } from '../common/EIP712/RelayRequest'
import { DeployTransactionRequest, RelayMetadata, RelayTransactionRequest } from './types/RelayTransactionRequest'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { Address, AsyncDataCallback, PingFilter } from './types/Aliases'
import HttpClient from './HttpClient'
import ContractInteractor from '../common/ContractInteractor'
import RelaySelectionManager from './RelaySelectionManager'
import { KnownRelaysManager } from './KnownRelaysManager'
import AccountManager from './AccountManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import { configureGSN, getDependencies, GSNConfig, GSNDependencies } from './GSNConfigurator'
import { RelayInfo } from './types/RelayInfo'
import { decodeRevertReason } from '../common/Utils'
import { EventEmitter } from 'events'
import { bufferToHex } from 'ethereumjs-util'

import {
  GsnEvent,
  GsnInitEvent,
  GsnNextRelayEvent,
  GsnDoneRefreshRelaysEvent,
  GsnRefreshRelaysEvent, GsnRelayerResponseEvent, GsnSendToRelayerEvent, GsnSignRequestEvent, GsnValidateRequestEvent
} from './GsnEvents'
import { getDomainSeparatorHash, TypedDeployRequestData, DeployRequestDataType } from '../common/EIP712/TypedRequestData'
import { TypedDataUtils } from 'eth-sig-util'
import { toBN } from 'web3-utils'

// generate "approvalData" and "verifierData" for a request.
// both are bytes arrays. verifierData is part of the client request.
// approvalData is created after request is filled and signed.
export const EmptyDataCallback: AsyncDataCallback = async (): Promise<PrefixedHexString> => {
  return '0x'
}

export const GasPricePingFilter: PingFilter = (pingResponse, gsnTransactionDetails) => {
  if (
    gsnTransactionDetails.gasPrice != null &&
    parseInt(pingResponse.minGasPrice) > parseInt(gsnTransactionDetails.gasPrice)
  ) {
    throw new Error(`Proposed gas price: ${gsnTransactionDetails.gasPrice}; relay's MinGasPrice: ${pingResponse.minGasPrice}`)
  }
}

interface RelayingAttempt {
  transaction?: Transaction
  error?: Error
}

interface EstimateGasParams {
  from: Address
  to: Address
  data: PrefixedHexString
  gasPrice?: PrefixedHexString
}

export interface RelayingResult {
  transaction?: Transaction
  pingErrors: Map<string, Error>
  relayingErrors: Map<string, Error>
}

export class RelayClient {
  readonly emitter = new EventEmitter()
  readonly config: GSNConfig
  private readonly httpClient: HttpClient
  protected contractInteractor: ContractInteractor
  protected knownRelaysManager: KnownRelaysManager
  private readonly asyncApprovalData: AsyncDataCallback
  private readonly transactionValidator: RelayedTransactionValidator
  private readonly pingFilter: PingFilter

  public readonly accountManager: AccountManager
  private initialized = false

  /**
   * create a RelayClient library object, to force contracts to go through a relay.
   */
  constructor (
    provider: HttpProvider,
    configOverride: Partial<GSNConfig>,
    overrideDependencies?: Partial<GSNDependencies>
  ) {
    const config = configureGSN(configOverride)
    const dependencies = getDependencies(config, provider, overrideDependencies)

    this.config = dependencies.config
    this.httpClient = dependencies.httpClient
    this.contractInteractor = dependencies.contractInteractor
    this.knownRelaysManager = dependencies.knownRelaysManager
    this.transactionValidator = dependencies.transactionValidator
    this.accountManager = dependencies.accountManager
    this.pingFilter = dependencies.pingFilter
    this.asyncApprovalData = dependencies.asyncApprovalData
    log.setLevel(this.config.logLevel)
  }

  /**
   * register a listener for GSN events
   * @see GsnEvent and its subclasses for emitted events
   * @param handler callback function to handle events
   */
  registerEventListener (handler: (event: GsnEvent) => void): void {
    this.emitter.on('gsn', handler)
  }

  /**
   * unregister previously registered event listener
   * @param handler callback function to unregister
   */
  unregisterEventListener (handler: (event: GsnEvent) => void): void {
    this.emitter.off('gsn', handler)
  }

  private emit (event: GsnEvent): void {
    this.emitter.emit('gsn', event)
  }

  /**
   * In case Relay Server does not broadcast the signed transaction to the network,
   * client also broadcasts the same transaction. If the transaction fails with nonce
   * error, it indicates Relay may have signed multiple transactions with same nonce,
   * causing a DoS attack.
   *
   * @param {*} transaction - actual Ethereum transaction, signed by a relay
   */
  async _broadcastRawTx (transaction: Transaction): Promise<{ hasReceipt: boolean, broadcastError?: Error, wrongNonce?: boolean }> {
    const rawTx = '0x' + transaction.serialize().toString('hex')
    const txHash = '0x' + transaction.hash(true).toString('hex')
    log.info(`Broadcasting raw transaction signed by relay. TxHash: ${txHash}`)
    try {
      if (await this._isAlreadySubmitted(txHash)) {
        return { hasReceipt: true }
      }

      // can't find the TX in the mempool. broadcast it ourselves.
      await this.contractInteractor.sendSignedTransaction(rawTx)
      return { hasReceipt: true }
    } catch (broadcastError) {
      // don't display error for the known-good cases
      if (broadcastError?.message.match(/the tx doesn't have the correct nonce|known transaction/) != null) {
        return {
          hasReceipt: false,
          wrongNonce: true,
          broadcastError
        }
      }
      return { hasReceipt: false, broadcastError }
    }
  }

  async _isAlreadySubmitted (txHash: string): Promise<boolean> {
    const [txMinedReceipt, pendingTransaction] = await Promise.all([
      this.contractInteractor.web3.eth.getTransactionReceipt(txHash),
      // considering mempool transactions
      this.contractInteractor.web3.eth.getTransaction(txHash)
    ])

    if (txMinedReceipt != null || pendingTransaction != null) {
      return true
    }

    return false
  }

  async _init (): Promise<void> {
    if (this.initialized) { return }
    this.emit(new GsnInitEvent())
    await this.contractInteractor.init()
    this.initialized = true
  }

  async calculateSmartWalletDeployGas (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    const testInfo = await this._prepareFactoryGasEstimationRequest(gsnTransactionDetails)

    const signedData = new TypedDeployRequestData(
      this.accountManager.chainId,
      testInfo.relayRequest.relayData.callForwarder,
      { ...testInfo.relayRequest }
    )

    const suffixData = bufferToHex(TypedDataUtils.encodeData(signedData.primaryType, signedData.message, signedData.types).slice((1 + DeployRequestDataType.length) * 32))
    const domainHash = getDomainSeparatorHash(testInfo.relayRequest.relayData.callForwarder, this.accountManager.chainId)
    const estimatedGas: number = await this.contractInteractor.proxyFactoryDeployEstimageGas(testInfo.relayRequest,
      testInfo.relayRequest.relayData.callForwarder, domainHash, suffixData, testInfo.metadata.signature)
    return estimatedGas
  }

  async estimateTokenTransferGas (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    let gasCost = 0
    const tokenContract = gsnTransactionDetails.tokenContract ?? constants.ZERO_ADDRESS

    if (tokenContract !== constants.ZERO_ADDRESS && toBN(gsnTransactionDetails.tokenAmount ?? '0').toNumber() > 0) {
      let tokenOrigin: string
      const tokenDestination = gsnTransactionDetails.callVerifier ?? constants.ZERO_ADDRESS // the factory

      if (gsnTransactionDetails.isSmartWalletDeploy ?? false) {
        // If it is a deploy and tokenGas was not defined, then the smartwallet address is needed to estimate the token gas
        const smartWalletAddress = gsnTransactionDetails.smartWalletAddress ?? constants.ZERO_ADDRESS

        if (smartWalletAddress === constants.ZERO_ADDRESS) {
          throw Error('In a deploy, if tokenGas is not defined, then the calculated SmartWallet address is needed to estimate the tokenGas value')
        }
        tokenOrigin = smartWalletAddress
      } else {
        tokenOrigin = gsnTransactionDetails.callForwarder ?? constants.ZERO_ADDRESS // the smart wallet
      }

      if (tokenOrigin !== constants.ZERO_ADDRESS) {
        const encodedFunction = this.contractInteractor.web3.eth.abi.encodeFunctionCall({
          name: 'transfer',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'recipient'
            }, {
              type: 'uint256',
              name: 'amount'
            }
          ]
        },
        [tokenDestination,
          gsnTransactionDetails.tokenAmount ?? '0'])

        gasCost = await this.contractInteractor.estimateGas({
          from: tokenOrigin, // token holder is the smart wallet
          to: tokenContract,
          gasPrice: gsnTransactionDetails.gasPrice,
          data: encodedFunction
        })
      }
    }

    return gasCost
  }

  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    await this._init()
    // TODO: should have a better strategy to decide how often to refresh known relays
    this.emit(new GsnRefreshRelaysEvent())
    await this.knownRelaysManager.refresh()
    gsnTransactionDetails.gasPrice = gsnTransactionDetails.forceGasPrice ?? await this._calculateGasPrice()
    if (gsnTransactionDetails.gas === undefined || gsnTransactionDetails.gas == null) {
      if ((gsnTransactionDetails.isSmartWalletDeploy ?? false)) {
        const estimated = await this.calculateSmartWalletDeployGas(gsnTransactionDetails)
        gsnTransactionDetails.gas = `0x${estimated.toString(16)}`
      } else {
        const estimated = await this.contractInteractor.estimateGas(this.getEstimateGasParams(gsnTransactionDetails))
        gsnTransactionDetails.gas = `0x${estimated.toString(16)}`
      }
    }

    // Estimate the gas required to transfer the token
    gsnTransactionDetails.tokenGas = gsnTransactionDetails.tokenGas ?? (await this.estimateTokenTransferGas(gsnTransactionDetails)).toString()

    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, this.knownRelaysManager, this.httpClient, this.pingFilter, this.config).init()
    const count = relaySelectionManager.relaysLeft().length
    this.emit(new GsnDoneRefreshRelaysEvent(count))
    if (count === 0) {
      throw new Error('no registered relayers')
    }
    const relayingErrors = new Map<string, Error>()
    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay !== undefined && activeRelay !== null) {
        this.emit(new GsnNextRelayEvent(activeRelay.relayInfo.relayUrl))
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails)
          .catch(error => ({ error }))
        if (relayingAttempt.transaction === undefined || relayingAttempt.transaction === null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          continue
        }
      }
      return {
        transaction: relayingAttempt?.transaction,
        relayingErrors,
        pingErrors: relaySelectionManager.errors
      }
    }
  }

  async _calculateGasPrice (): Promise<PrefixedHexString> {
    const pct = this.config.gasPriceFactorPercent
    const networkGasPrice = await this.contractInteractor.getGasPrice()
    let gasPrice = Math.round(parseInt(networkGasPrice) * (pct + 100) / 100)
    if (this.config.minGasPrice != null && gasPrice < this.config.minGasPrice) {
      gasPrice = this.config.minGasPrice
    }
    return `0x${gasPrice.toString(16)}`
  }

  async _attemptRelay (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayingAttempt> {
    log.info(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(gsnTransactionDetails)}`)
    let httpRequest: RelayTransactionRequest | DeployTransactionRequest
    let acceptRelayCallResult

    if ((gsnTransactionDetails.isSmartWalletDeploy ?? false)) {
      const deployRequest = await this._prepareDeployHttpRequest(relayInfo, gsnTransactionDetails)
      this.emit(new GsnValidateRequestEvent())
      acceptRelayCallResult = await this.contractInteractor.validateAcceptDeployCall(deployRequest.relayRequest, deployRequest.metadata.signature, deployRequest.metadata.approvalData)
      httpRequest = deployRequest
    } else {
      httpRequest = await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)
      this.emit(new GsnValidateRequestEvent())
      acceptRelayCallResult = await this.contractInteractor.validateAcceptRelayCall(httpRequest.relayRequest, httpRequest.metadata.signature, httpRequest.metadata.approvalData)
    }

    if (acceptRelayCallResult.reverted) {
      const message = 'local view call to \'relayCall()\' reverted'
      return { error: new Error(`${message}: ${decodeRevertReason(acceptRelayCallResult.returnValue)}`) }
    }

    if (!acceptRelayCallResult.verifierAccepted) {
      const message = 'verifier rejected in local view call to \'relayCall()\' '
      return { error: new Error(`${message}: ${decodeRevertReason(acceptRelayCallResult.returnValue)}`) }
    }

    let hexTransaction: PrefixedHexString
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      hexTransaction = await this.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, httpRequest)
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      log.info('relayTransaction: ', JSON.stringify(httpRequest))
      return { error }
    }
    const transaction = new Transaction(hexTransaction, this.contractInteractor.getRawTxOptions())
    if (!this.transactionValidator.validateRelayResponse(httpRequest, hexTransaction)) {
      this.emit(new GsnRelayerResponseEvent(false))
      this.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return { error: new Error('Returned transaction did not pass validation') }
    }
    this.emit(new GsnRelayerResponseEvent(true))
    await this._broadcastRawTx(transaction)
    return {
      transaction
    }
  }

  async _prepareFactoryGasEstimationRequest (
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<DeployTransactionRequest> {
    if (gsnTransactionDetails.isSmartWalletDeploy === undefined || !gsnTransactionDetails.isSmartWalletDeploy) {
      throw new Error('Request type is not for SmartWallet deploy')
    }

    const callForwarder = this.resolveForwarder(gsnTransactionDetails)
    const senderNonce = await this.contractInteractor.getFactoryNonce(callForwarder, gsnTransactionDetails.from)
    const gasLimit = BigInt(gsnTransactionDetails.gas ?? '0x00').toString()
    const gasPrice = BigInt(gsnTransactionDetails.gasPrice ?? '0x00').toString()
    const value = BigInt(gsnTransactionDetails.value ?? '0').toString()
    const tokenAmount = BigInt(gsnTransactionDetails.tokenAmount ?? '0x00').toString()
    const tokenGas = BigInt(gsnTransactionDetails.tokenGas ?? '0x00').toString()

    const relayRequest: DeployRequest = {
      request: {
        relayHub: gsnTransactionDetails.relayHub ?? this.config.relayHubAddress,
        from: gsnTransactionDetails.from, // owner EOA
        to: gsnTransactionDetails.to, // optional LogicAddr
        data: gsnTransactionDetails.data, // optional InitParams for LogicAddr
        value: value,
        nonce: senderNonce,
        gas: gasLimit, // Not used since RelayHub won't be involved
        tokenAmount: tokenAmount,
        tokenGas: tokenGas,
        tokenContract: gsnTransactionDetails.tokenContract ?? constants.ZERO_ADDRESS,
        recoverer: gsnTransactionDetails.recoverer ?? constants.ZERO_ADDRESS,
        index: gsnTransactionDetails.index ?? '0'
      },
      relayData: {
        gasPrice,
        callVerifier: gsnTransactionDetails.callVerifier ?? constants.ZERO_ADDRESS,
        callForwarder: callForwarder,
        domainSeparator: getDomainSeparatorHash(callForwarder, this.accountManager.chainId),
        relayWorker: constants.ZERO_ADDRESS
      }
    }

    const signature = await this.accountManager.sign(relayRequest)

    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature,
      approvalData: '',
      relayMaxNonce: 0
    }
    const httpRequest: DeployTransactionRequest = {
      relayRequest,
      metadata
    }
    return httpRequest
  }

  async _prepareDeployHttpRequest (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<DeployTransactionRequest> {
    const forwarderAddress = this.resolveForwarder(gsnTransactionDetails)

    const senderNonce: string = await this.contractInteractor.getFactoryNonce(forwarderAddress, gsnTransactionDetails.from)
    const callVerifier = gsnTransactionDetails.callVerifier ?? this.config.deployVerifierAddress
    const relayWorker = relayInfo.pingResponse.relayWorkerAddress
    const gasPriceHex = gsnTransactionDetails.gasPrice
    const gasLimitHex = gsnTransactionDetails.gas
    if (gasPriceHex == null || gasLimitHex == null) {
      throw new Error('RelayClient internal exception. Gas price or gas limit still not calculated. Cannot happen.')
    }
    if (gasPriceHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasPrice hex string: ${gasPriceHex}`)
    }
    if (gasLimitHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasLimit hex string: ${gasLimitHex}`)
    }
    const gasLimit = parseInt(gasLimitHex, 16).toString()
    const gasPrice = parseInt(gasPriceHex, 16).toString()
    const value = gsnTransactionDetails.value ?? '0'

    const relayRequest: DeployRequest = {
      request: {
        relayHub: gsnTransactionDetails.relayHub ?? constants.ZERO_ADDRESS,
        to: gsnTransactionDetails.to,
        data: gsnTransactionDetails.data,
        from: gsnTransactionDetails.from,
        value: value,
        nonce: senderNonce,
        gas: gasLimit,
        tokenAmount: gsnTransactionDetails.tokenAmount ?? '0x00',
        tokenGas: gsnTransactionDetails.tokenGas ?? '0x00',
        tokenContract: gsnTransactionDetails.tokenContract ?? constants.ZERO_ADDRESS,
        recoverer: gsnTransactionDetails.recoverer ?? constants.ZERO_ADDRESS,
        index: gsnTransactionDetails.index ?? '0'
      },
      relayData: {
        gasPrice,
        callVerifier,
        domainSeparator: getDomainSeparatorHash(forwarderAddress, this.accountManager.chainId),
        callForwarder: forwarderAddress,
        relayWorker
      }
    }
    // put verifierData into struct before signing
    this.emit(new GsnSignRequestEvent())
    const signature = await this.accountManager.sign(relayRequest)
    const approvalData = await this.asyncApprovalData(relayRequest)
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const transactionCount = await this.contractInteractor.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    // TODO: the server accepts a flat object, and that is why this code looks like shit.
    //  Must teach server to accept correct types
    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature,
      approvalData,
      relayMaxNonce
    }
    const httpRequest: DeployTransactionRequest = {
      relayRequest,
      metadata
    }
    log.info(`Created HTTP deploy request: ${JSON.stringify(httpRequest)}`)

    return httpRequest
  }

  async _prepareRelayHttpRequest (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayTransactionRequest> {
    const forwarderAddress = this.resolveForwarder(gsnTransactionDetails)

    const senderNonce: string = await this.contractInteractor.getSenderNonce(forwarderAddress)

    const callVerifier = gsnTransactionDetails.callVerifier ?? this.config.relayVerifierAddress
    const relayWorker = relayInfo.pingResponse.relayWorkerAddress
    const gasPriceHex = gsnTransactionDetails.gasPrice
    const gasLimitHex = gsnTransactionDetails.gas
    if (gasPriceHex == null || gasLimitHex == null) {
      throw new Error('RelayClient internal exception. Gas price or gas limit still not calculated. Cannot happen.')
    }
    if (gasPriceHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasPrice hex string: ${gasPriceHex}`)
    }
    if (gasLimitHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasLimit hex string: ${gasLimitHex}`)
    }
    const gasLimit = parseInt(gasLimitHex, 16).toString()
    const gasPrice = parseInt(gasPriceHex, 16).toString()
    const value = gsnTransactionDetails.value ?? '0'

    const relayRequest: RelayRequest = {
      request: {
        relayHub: gsnTransactionDetails.relayHub ?? constants.ZERO_ADDRESS,
        to: gsnTransactionDetails.to,
        data: gsnTransactionDetails.data,
        from: gsnTransactionDetails.from,
        value: value,
        nonce: senderNonce,
        gas: gasLimit,
        tokenAmount: gsnTransactionDetails.tokenAmount ?? '0x00',
        tokenGas: gsnTransactionDetails.tokenGas ?? '0x00',
        tokenContract: gsnTransactionDetails.tokenContract ?? constants.ZERO_ADDRESS
      },
      relayData: {
        gasPrice,
        callVerifier,
        domainSeparator: getDomainSeparatorHash(forwarderAddress, this.accountManager.chainId),
        callForwarder: forwarderAddress,
        relayWorker
      }
    }
    // put verifierData into struct before signing
    this.emit(new GsnSignRequestEvent())
    const signature = await this.accountManager.sign(relayRequest)
    const approvalData = await this.asyncApprovalData(relayRequest)
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const transactionCount = await this.contractInteractor.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    // TODO: the server accepts a flat object, and that is why this code looks like shit.
    //  Must teach server to accept correct types
    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature,
      approvalData,
      relayMaxNonce
    }
    const httpRequest: RelayTransactionRequest = {
      relayRequest,
      metadata
    }
    log.info(`Created HTTP relay request: ${JSON.stringify(httpRequest)}`)

    return httpRequest
  }

  resolveForwarder (gsnTransactionDetails: GsnTransactionDetails): Address {
    const forwarderAddress = gsnTransactionDetails.callForwarder ?? constants.ZERO_ADDRESS
    if (forwarderAddress === constants.ZERO_ADDRESS) {
      throw new Error('No callForwarder address configured')
    }
    return forwarderAddress
  }

  getEstimateGasParams (gsnTransactionDetails: GsnTransactionDetails): EstimateGasParams {
    var params: EstimateGasParams
    params = {
      from: gsnTransactionDetails.from,
      to: gsnTransactionDetails.to,
      gasPrice: gsnTransactionDetails.gasPrice,
      data: gsnTransactionDetails.data
    }

    return params
  }
}

export function _dumpRelayingResult (relayingResult: RelayingResult): string {
  let str = ''
  if (relayingResult.pingErrors.size > 0) {
    str += `Ping errors (${relayingResult.pingErrors.size}):`
    Array.from(relayingResult.pingErrors.keys()).forEach(e => {
      const err = relayingResult.pingErrors.get(e)
      const error = err?.message ?? err?.toString() ?? ''
      str += `\n${e} => ${error}\n`
    })
  }
  if (relayingResult.relayingErrors.size > 0) {
    str += `Relaying errors (${relayingResult.relayingErrors.size}):\n`
    Array.from(relayingResult.relayingErrors.keys()).forEach(e => {
      const err = relayingResult.relayingErrors.get(e)
      const error = err?.message ?? err?.toString() ?? ''
      str += `${e} => ${error}`
    })
  }
  return str
}

import { ethers } from 'hardhat'
import { BigNumber, Event, providers } from 'ethers'
import log from 'loglevel'
import { DeployRequest, RelayRequest } from './EIP712/RelayRequest'
import { constants } from './Constants'
import replaceErrors from './ErrorReplacerJSON'
import VersionsManager from './VersionsManager'
import {
  IForwarder,
  IRelayVerifier,
  IRelayHub,
  IDeployVerifier,
  IWalletFactory,
  IRelayVerifier__factory,
  IDeployVerifier__factory,
  IRelayHub__factory,
  IForwarder__factory,
  IWalletFactory__factory,
  ITokenHandler,
  ITokenHandler__factory
} from '../../typechain'

import { Address, IntString, PrefixedHexString } from '../relayclient/types/Aliases'
import { EnvelopingConfig } from '../relayclient/Configurator'
import EnvelopingTransactionDetails from '../relayclient/types/EnvelopingTransactionDetails'
import { event2topic, sleep } from './Utils'
import { LogDescription } from '@ethersproject/abi'
import { DeployTransactionRequest, RelayTransactionRequest } from '../relayclient/types/RelayTransactionRequest'

// require('source-map-support').install({ errorFormatterForce: true })

type EventName = string
export interface EstimateGasParams {
  from: Address
  to: Address
  data: PrefixedHexString
  gasPrice?: PrefixedHexString
}

export interface PastEventOptions {
  fromBlock?: providers.BlockTag
  toBlock?: providers.BlockTag
}

export const RelayServerRegistered: EventName = 'RelayServerRegistered'
export const RelayWorkersAdded: EventName = 'RelayWorkersAdded'
export const TransactionRelayed: EventName = 'TransactionRelayed'
export const TransactionRejectedByRecipient: EventName = 'TransactionRelayedButRevertedByRecipient'

const ActiveManagerEvents = [RelayServerRegistered, RelayWorkersAdded, TransactionRelayed, TransactionRejectedByRecipient]

export const StakeAdded: EventName = 'StakeAdded'
export const StakeUnlocked: EventName = 'StakeUnlocked'
export const StakeWithdrawn: EventName = 'StakeWithdrawn'
export const StakePenalized: EventName = 'StakePenalized'

export type Provider =
  | providers.JsonRpcProvider
  | providers.IpcProvider
  | providers.WebSocketProvider
export default class ContractInteractor {
  private readonly VERSION = '2.0.1'

  private relayVerifierInstance!: IRelayVerifier
  private deployVerifierInstance!: IDeployVerifier

  relayHubInstance!: IRelayHub

  private readonly provider: Provider
  private readonly config: EnvelopingConfig
  private readonly versionManager: VersionsManager

  chainId!: number
  // private networkId?: number
  // private networkType?: string
  private initialized: boolean

  constructor (provider: Provider, config: EnvelopingConfig) {
    this.versionManager = new VersionsManager(this.VERSION)
    this.config = config
    this.provider = provider
    this.chainId = config.chainId
    this.initialized = false
  }

  getProvider (): Provider { return this.provider }

  async init (): Promise<void> {
    log.debug('Contract Interactor - Initializing')
    if (this.isInitialized()) {
      log.debug('Contract Interactor - Initialized succesfully')
      throw new Error('_init has already called')
    }
    await this._initializeContracts()
    log.debug('Contract Interactor - Initialized succesfully')
    await this._validateCompatibility().catch(err => console.log('WARNING: beta ignore version compatibility', err.message))
    this.chainId = (await this.provider.getNetwork()).chainId
    this.initialized = true
    // const chain = await this.provider.getNetwork()
    // this.networkId = await this._networkId()
    // this.networkType = this.provider.network.name
    // chain === 'private' means we're on ganache, and ethereumjs-tx.Transaction doesn't support that chain type
    // log.debug(`Contract Interactor - Using chainId: ${this.chainId}, netowrkId:${this.networkId} , networkType:${this.networkType} `)
    // this.rawTxOptions = getRawTxOptions(this.chainId, this.networkId, chain)
    // this.rawTxOptions = getRawTxOptions(this.chainId, this.networkId, chain)
  }

  isInitialized (): boolean {
    return this.initialized
  }

  async _networkId (): Promise<number> {
    return await this.provider.send(
      'net_version',
      []
    )
  }

  async _validateCompatibility (): Promise<void> {
    if (this.config.relayHubAddress === constants.ZERO_ADDRESS) {
      return
    }
    const hub = this.relayHubInstance
    const version = await hub.versionHub()
    this._validateVersion(version)
  }

  _validateVersion (version: string): void {
    const isNewer = this.versionManager.isMinorSameOrNewer(version)
    if (!isNewer) {
      throw new Error(`Provided Hub version(${version}) is not supported by the current interactor(${this.versionManager.componentVersion})`)
    }
  }

  async _initializeContracts (): Promise<void> {
    if (this.config.relayHubAddress !== constants.ZERO_ADDRESS) {
      this.relayHubInstance = await this._createRelayHub(this.config.relayHubAddress)
      log.debug(`Contract Interactor - Relay Hub initialized: ${this.relayHubInstance.address}`)
    }
    if (this.config.relayVerifierAddress !== constants.ZERO_ADDRESS) {
      this.relayVerifierInstance = await this._createRelayVerifier(this.config.relayVerifierAddress)
      log.debug(`Contract Interactor - Relay Verifier initialized: ${this.relayVerifierInstance.address}`)
    }
    if (this.config.deployVerifierAddress !== constants.ZERO_ADDRESS) {
      this.deployVerifierInstance = await this._createDeployVerifier(this.config.deployVerifierAddress)
      log.debug(`Contract Interactor - Deploy Verifier initialized: ${this.deployVerifierInstance.address}`)
    }

    console.log('Contracts initialized correctly')
  }

  // must use these options when creating Transaction object
  getRawTxOptions (): number {
    if (this.chainId == null) {
      throw new Error('_init not called')
    }
    return this.chainId
  }

  async _createRelayVerifier (address: Address): Promise<IRelayVerifier> {
    return IRelayVerifier__factory.connect(address, this.provider)
  }

  async _createDeployVerifier (address: Address): Promise<IDeployVerifier> {
    return IDeployVerifier__factory.connect(address, this.provider)
  }

  async createTokenHandler (address: Address): Promise<ITokenHandler> {
    return ITokenHandler__factory.connect(address, this.provider)
  }

  async _createRelayHub (address: Address): Promise<IRelayHub> {
    return IRelayHub__factory.connect(address, this.provider)
  }

  async _createForwarder (address: Address): Promise<IForwarder> {
    return IForwarder__factory.connect(address, this.provider)
  }

  async _createFactory (address: Address): Promise<IWalletFactory> {
    return IWalletFactory__factory.connect(address, this.provider)
  }

  async getSenderNonce (sWallet: Address): Promise<IntString> {
    const forwarder = await this._createForwarder(sWallet)
    const nonce = await forwarder.nonce()
    return nonce.toString()
  }

  async getFactoryNonce (factoryAddr: Address, from: Address): Promise<IntString> {
    const factory = await this._createFactory(factoryAddr)
    const nonce = await factory.nonce(from)
    return nonce.toString()
  }

  async validateAcceptRelayCall (
    relayRequest: RelayRequest,
    signature: PrefixedHexString): Promise<{ verifierAccepted: boolean, returnValue: string, reverted: boolean, revertedInDestination: boolean }> {
    const relayHub = this.relayHubInstance
    const externalGasLimit: number = await this.getMaxViewableRelayGasLimit(relayRequest, signature)
    if (externalGasLimit === 0) {
      // The relayWorker does not have enough balance for this transaction
      return {
        verifierAccepted: false,
        reverted: false,
        returnValue: `relayWorker ${relayRequest.relayData.relayWorker} does not have enough balance to cover the maximum possible gas for this transaction`,
        revertedInDestination: false
      }
    }

    // First call the verifier
    try {
      await this.relayVerifierInstance.contract.methods.verifyRelayedCall(relayRequest, signature).call({
        from: relayRequest.relayData.relayWorker
      }, 'pending')
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        verifierAccepted: false,
        reverted: false,
        returnValue: `view call to 'relayCall' reverted in verifier: ${message}`,
        revertedInDestination: false
      }
    }

    // If the verified passed, try relaying the transaction (in local view call)
    try {
      const res = await relayHub.contract.methods.relayCall(
        relayRequest,
        signature
      )
        .call({
          from: relayRequest.relayData.relayWorker,
          gasPrice: relayRequest.relayData.gasPrice,
          gasLimit: ethers.utils.hexlify(externalGasLimit)
        })

      // res is destinationCallSuccess
      return {
        verifierAccepted: true,
        reverted: false,
        returnValue: '',
        revertedInDestination: !(res as boolean)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        verifierAccepted: true,
        reverted: true,
        returnValue: `view call to 'relayCall' reverted in client: ${message}`,
        revertedInDestination: false
      }
    }
  }

  async validateAcceptDeployCall (
    request: DeployTransactionRequest): Promise<{ verifierAccepted: boolean, returnValue: string, reverted: boolean }> {
    const relayHub = this.relayHubInstance
    const externalGasLimit = await this.getMaxViewableDeployGasLimit(request)

    if (externalGasLimit.eq(BigNumber.from(0))) {
      // The relayWorker does not have enough balance for this transaction
      return {
        verifierAccepted: false,
        reverted: false,
        returnValue: `relayWorker ${request.relayRequest.relayData.relayWorker} does not have enough balance to cover the maximum possible gas for this transaction`
      }
    }

    // First call the verifier
    try {
      await this.deployVerifierInstance.contract.methods.verifyRelayedCall(request.relayRequest, request.metadata.signature).call({
        from: request.relayRequest.relayData.relayWorker
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        verifierAccepted: false,
        reverted: false,
        returnValue: `view call to 'deploy call' reverted in verifier: ${message}`
      }
    }

    // If the verified passed, try relaying the transaction (in local view call)
    try {
      const res = await relayHub.contract.methods.deployCall(
        request.relayRequest,
        request.metadata.signature
      )
        .call({
          from: request.relayRequest.relayData.relayWorker,
          gasPrice: request.relayRequest.relayData.gasPrice,
          gas: externalGasLimit
        })

      return {
        verifierAccepted: true,
        reverted: false,
        returnValue: res.returnValue
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        verifierAccepted: true,
        reverted: true,
        returnValue: `view call to 'deployCall' reverted in client: ${message}`
      }
    }
  }

  async getMaxViewableDeployGasLimit (request: DeployTransactionRequest): Promise<BigNumber> {
    const gasPrice = BigNumber.from(request.relayRequest.relayData.gasPrice)
    let gasLimit = BigNumber.from(0)

    if (!gasPrice.eq(BigNumber.from(0))) {
      const maxEstimatedGas = BigNumber.from(await this.walletFactoryEstimateGasOfDeployCall(request))
      const workerBalanceAsUnitsOfGas = BigNumber.from(await this.getBalance(request.relayRequest.relayData.relayWorker)).div(gasPrice)

      if (workerBalanceAsUnitsOfGas.gte(maxEstimatedGas)) {
        gasLimit = maxEstimatedGas
      }
    }

    return gasLimit
  }

  async estimateRelayTransactionMaxPossibleGas (relayRequest: RelayRequest, signature: PrefixedHexString): Promise<number> {
    const maxPossibleGas = await this.estimateGas({
      from: relayRequest.relayData.relayWorker,
      to: relayRequest.request.relayHub,
      data: this.relayHubInstance.contract.methods.relayCall(relayRequest, signature).encodeABI(),
      gasPrice: relayRequest.relayData.gasPrice
    })

    // TODO RIF Team: Once the exactimator is available on the RSK node, then ESTIMATED_GAS_CORRECTION_FACTOR can be removed (in our tests it is 1.0 anyway, so it's not active)
    return Math.ceil(maxPossibleGas * constants.ESTIMATED_GAS_CORRECTION_FACTOR)
  }

  async estimateRelayTransactionMaxPossibleGasWithTransactionRequest (request: RelayTransactionRequest): Promise<number> {
    if (request.metadata.relayHubAddress === undefined || request.metadata.relayHubAddress === null || request.metadata.relayHubAddress === constants.ZERO_ADDRESS) {
      throw new Error('calculateDeployCallGas: RelayHub must be defined')
    }

    const rHub = await this._createRelayHub(request.metadata.relayHubAddress)
    const method = rHub.contract.methods.relayCall(request.relayRequest, request.metadata.signature)

    const maxPossibleGas = await method.estimateGas({
      from: request.relayRequest.relayData.relayWorker,
      gasPrice: request.relayRequest.relayData.gasPrice
    })

    // TODO RIF Team: Once the exactimator is available on the RSK node, then ESTIMATED_GAS_CORRECTION_FACTOR can be removed (in our tests it is 1.0 anyway, so it's not active)
    return Math.ceil(maxPossibleGas * constants.ESTIMATED_GAS_CORRECTION_FACTOR)
  }

  async estimateDestinationContractCallGas (transactionDetails: EstimateGasParams, addCushion: boolean = true): Promise<number> {
    // For relay calls, transactionDetails.gas is only the portion of gas sent to the destination contract, the tokenPayment
    // Part is done before, by the SmartWallet

    const estimated = await this.estimateGas({
      from: transactionDetails.from,
      to: transactionDetails.to,
      gasPrice: transactionDetails.gasPrice,
      data: transactionDetails.data
    })
    let internalCallCost = estimated > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION ? estimated - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION : estimated

    // The INTERNAL_TRANSACTION_ESTIMATE_CORRECTION is substracted because the estimation is done using web3.eth.estimateGas which
    // estimates the call as if it where an external call, and in our case it will be called internally (it's not the same cost).
    // Because of this, the estimated maxPossibleGas in the server (which estimates the whole transaction) might not be enough to successfully pass
    // the following verification made in the SmartWallet:
    // require(gasleft() > req.gas, "Not enough gas left"). This is done right before calling the destination internally

    if (addCushion) {
      internalCallCost = internalCallCost * constants.ESTIMATED_GAS_CORRECTION_FACTOR
    }

    return internalCallCost
  }

  async getMaxViewableRelayGasLimit (relayRequest: RelayRequest, signature: PrefixedHexString): Promise<number> {
    const gasPrice = BigNumber.from(relayRequest.relayData.gasPrice)
    let gasLimit = 0

    if (gasPrice.gt(BigNumber.from(0))) {
      const maxEstimatedGas: number = await this.estimateRelayTransactionMaxPossibleGas(relayRequest, signature)
      const workerBalanceAsUnitsOfGas = BigNumber.from(await this.getBalance(relayRequest.relayData.relayWorker)).div(gasPrice)

      if (workerBalanceAsUnitsOfGas.gte(BigNumber.from(maxEstimatedGas))) {
        gasLimit = maxEstimatedGas
      }
    }

    return gasLimit
  }

  async encodeRelayCallABI (relayRequest: RelayRequest, sig: PrefixedHexString): Promise<PrefixedHexString> {
    // TODO: check this works as expected
    const RelayHub = await ethers.getContractFactory('IRelayHub')
    const relayCall = RelayHub.interface
    return relayCall.encodeFunctionData(relayCall.getFunction('relayCall'), [relayRequest, sig])
  }

  async encodeDeployCallABI (relayRequest: DeployRequest, sig: PrefixedHexString): Promise<PrefixedHexString> {
    // TODO: check this works as expected
    const RelayHub = await ethers.getContractFactory('IRelayHub')
    const relayCall = RelayHub.interface
    return relayCall.encodeFunctionData(relayCall.getFunction('deployCall'), [relayRequest, sig])
  }

  async getPastEventsForHub (extraTopics: string[], options: PastEventOptions, names: EventName[] = ActiveManagerEvents): Promise<Event[]> {
    return await this._getPastEvents(this.relayHubInstance, names, extraTopics, options)
  }

  async getPastEventsForStakeManagement (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<Event[]> {
    return await this._getPastEvents(this.relayHubInstance, names, extraTopics, options)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _getPastEvents (contract: IRelayHub, names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<Event[]> {
    const topics: string[][] = []
    const eventTopic = event2topic(contract, names)

    topics.push(eventTopic)

    if (extraTopics.length > 0) {
      topics.push(extraTopics)
    }

    const address = contract.address
    const filter = {
      address,
      topics
    }

    return await contract.queryFilter(filter, options.fromBlock, options.toBlock)
  }

  decodeEvents (events: Event[]): LogDescription[] {
    return events.map(event => this.relayHubInstance.interface.parseLog(event))
  }

  async getBalance (address: Address, defaultBlock: providers.BlockTag = 'latest'): Promise<BigNumber> {
    return await this.provider.getBalance(address, defaultBlock)
  }

  async getBlockNumber (): Promise<number> {
    return await this.provider.getBlockNumber()
  }

  async sendSignedTransaction (rawTx: string): Promise<providers.TransactionReceipt> {
    const tx = await this.provider.sendTransaction(rawTx)
    return await tx.wait()
  }

  async estimateGas (transactionDetails: EnvelopingTransactionDetails): Promise<number> {
    return (await this.provider.estimateGas(transactionDetails)).toNumber()
  }

  // TODO: cache response for some time to optimize. It doesn't make sense to optimize these requests in calling code.
  async getGasPrice (): Promise<string> {
    return (await this.provider.getGasPrice()).toString()
  }

  async getTransactionCount (address: string, blockTag?: providers.BlockTag): Promise<number> {
    return await this.provider.getTransactionCount(address, blockTag)
  }

  async getTransaction (transactionHash: string): Promise<providers.TransactionResponse> {
    return await this.provider.getTransaction(transactionHash)
  }

  async getBlock (blockTag: providers.BlockTag): Promise<providers.Block> {
    return await this.provider.getBlock(blockTag)
  }

  validateAddress (address: string, errorMessage: string): void {
    try {
      ethers.utils.getAddress(address)
    } catch (error) {
      throw new Error(errorMessage)
    }
  }

  getAsyncChainId (): number {
    return this.provider.network.chainId
  }

  async getCode (address: string): Promise<string> {
    return await this.provider.getCode(address)
  }

  getChainId (): number {
    if (this.chainId == null) {
      throw new Error('_init not called')
    }
    return this.chainId
  }

  // getNetworkId (): number {
  //   if (this.networkId == null) {
  //     throw new Error('_init not called')
  //   }
  //   return this.networkId
  // }

  // getNetworkType (): string {
  //   if (this.networkType == null) {
  //     throw new Error('_init not called')
  //   }
  //   return this.networkType
  // }

  async isContractDeployed (address: Address): Promise<boolean> {
    const code = await this.provider.getCode(address)
    // Check added for RSKJ: when the contract does not exist in RSKJ it replies to the getCode call with 0x00
    return code !== '0x' && code !== '0x00'
  }

  async getStakeInfo (managerAddress: Address): Promise<{
    stake: BigNumber
    unstakeDelay: BigNumber
    withdrawBlock: BigNumber
    owner: string
  }> {
    return await this.relayHubInstance.getStakeInfo(managerAddress)
  }

  async walletFactoryEstimateGasOfDeployCall (request: DeployTransactionRequest): Promise<number> {
    if (request.metadata.relayHubAddress === undefined || request.metadata.relayHubAddress === null || request.metadata.relayHubAddress === constants.ZERO_ADDRESS) {
      throw new Error('calculateDeployCallGas: RelayHub must be defined')
    }
    const rHub = await this._createRelayHub(request.metadata.relayHubAddress)
    const method = rHub.contract.methods.deployCall(request.relayRequest, request.metadata.signature)

    return method.estimateGas({
      from: request.relayRequest.relayData.relayWorker,
      gasPrice: request.relayRequest.relayData.gasPrice
    })
  }

  // TODO: a way to make a relay hub transaction with a specified nonce without exposing the 'method' abstraction
  async getRegisterRelayMethod (url: string): Promise<any> {
    return await this.relayHubInstance.registerRelayServer(url)
  }

  async getAddRelayWorkersMethod (workers: Address[]): Promise<any> {
    return await this.relayHubInstance.addRelayWorkers(workers)
  }

  async getTransactionReceipt (transactionHash: PrefixedHexString,
    retries: number = constants.WAIT_FOR_RECEIPT_RETRIES,
    initialBackoff: number = constants.WAIT_FOR_RECEIPT_INITIAL_BACKOFF): Promise<providers.TransactionReceipt> {
    for (let tryCount = 0, backoff = initialBackoff; tryCount < retries; tryCount++, backoff *= 2) {
      const receipt = await this.provider.getTransactionReceipt(transactionHash)
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (receipt) {
        return receipt
      }
      await sleep(backoff)
    }
    throw new Error(`No receipt found for this transaction ${transactionHash}`)
  }

  /**
   * Web3.js as of 1.2.6 (see web3-core-method::_confirmTransaction) does not allow
   * broadcasting of a transaction without waiting for it to be mined.
   * This method sends the RPC call directly
   * @param signedTransaction - the raw signed transaction to broadcast
   */
  async broadcastTransaction (signedTransaction: PrefixedHexString): Promise<PrefixedHexString> {
    if (this.provider == null) {
      throw new Error('provider is not set')
    }
    return await this.provider.send('eth_sendRawTransaction', [signedTransaction])
  }
}

// /**
//  * Ganache does not seem to enforce EIP-155 signature. Buidler does, though.
//  * This is how {@link Transaction} constructor allows support for custom and private network.
//  * @param chainId
//  * @param networkId
//  * @param chain
//  * @return {{common: Common}}
//  */
// export function getRawTxOptions (chainId: number, networkId: number, chain?: string): Common {
//   if (chain == null || chain === 'main' || chain === 'private') {
//     chain = 'mainnet'
//   }
//   return Common.forCustomChain(
//     chain,
//     {
//       chainId,
//       networkId
//     }, 'istanbul'
//   )
// }

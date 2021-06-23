import Common from 'ethereumjs-common'

import { ethers } from 'hardhat'
import { BigNumber, Event, EventFilter, providers } from 'ethers'
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
  IWalletFactory__factory
} from '../../typechain'

import { Address, IntString, PrefixedHexString } from '../relayclient/types/Aliases'
import { EnvelopingConfig } from '../relayclient/Configurator'
import EnvelopingTransactionDetails from '../relayclient/types/EnvelopingTransactionDetails'

// require('source-map-support').install({ errorFormatterForce: true })

type EventName = string
type BigNumberString = BigNumber|string

export const RelayServerRegistered: EventName = 'RelayServerRegistered'
export const RelayWorkersAdded: EventName = 'RelayWorkersAdded'
export const TransactionRelayed: EventName = 'TransactionRelayed'
export const TransactionRejectedByRecipient: EventName = 'TransactionRelayedButRevertedByRecipient'

const ActiveManagerEvents: EventFilter = { topics: [RelayServerRegistered, RelayWorkersAdded, TransactionRelayed, TransactionRejectedByRecipient] }

export const StakeAdded: EventName = 'StakeAdded'
export const StakeUnlocked: EventName = 'StakeUnlocked'
export const StakeWithdrawn: EventName = 'StakeWithdrawn'
export const StakePenalized: EventName = 'StakePenalized'

// export type Web3Provider =
//   | HttpProvider
//   | IpcProvider
//   | WebsocketProvider
export default class ContractInteractor {
  private readonly VERSION = '2.0.1'

  private relayVerifierInstance!: IRelayVerifier
  private deployVerifierInstance!: IDeployVerifier
  relayHubInstance!: IRelayHub

  private readonly config: EnvelopingConfig
  private readonly versionManager: VersionsManager
  private rawTxOptions?: Common
  chainId!: number
  private networkId?: number
  private networkType?: string
  private readonly provider: providers.JsonRpcProvider

  constructor (provider: providers.JsonRpcProvider, config: EnvelopingConfig) {
    this.versionManager = new VersionsManager(this.VERSION)
    this.config = config
    this.provider = provider
    this.chainId = config.chainId
  }

  getProvider (): providers.JsonRpcProvider { return this.provider }

  async init (): Promise<void> {
    log.debug('Contract Interactor - Initializing')
    if (this.isInitialized()) {
      log.debug('Contract Interactor - Initialized succesfully')
      throw new Error('_init has already called')
    }
    await this._initializeContracts()
    log.debug('Contract Interactor - Initialized succesfully')
    await this._validateCompatibility().catch(err => console.log('WARNING: beta ignore version compatibility', err.message))
    const chain = this.provider.network.name
    this.chainId = (await this.provider.getNetwork()).chainId
    this.networkId = await this._networkId()
    this.networkType = this.provider.network.name
    // chain === 'private' means we're on ganache, and ethereumjs-tx.Transaction doesn't support that chain type
    log.debug(`Contract Interactor - Using chainId: ${this.chainId}, netowrkId:${this.networkId} , networkType:${this.networkType} `)
    this.rawTxOptions = getRawTxOptions(this.chainId, this.networkId, chain)
  }

  isInitialized (): boolean {
    return this.rawTxOptions != null
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
  getRawTxOptions (): Common {
    if (this.rawTxOptions == null) {
      throw new Error('_init not called')
    }
    return this.rawTxOptions
  }

  async _createRelayVerifier (address: Address): Promise<IRelayVerifier> {
    return IRelayVerifier__factory.connect(address, this.provider)
  }

  async _createDeployVerifier (address: Address): Promise<IDeployVerifier> {
    return IDeployVerifier__factory.connect(address, this.provider)
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
    signature: PrefixedHexString): Promise<{ verifierAccepted: boolean, returnValue: BigNumberString, reverted: boolean }> {
    const relayHub = this.relayHubInstance
    const externalGasLimit = await this.getMaxViewableGasLimit(relayRequest)

    // First call the verifier
    try {
      const overrides = {
        blockTag: 'pending',
        from: relayRequest.relayData.relayWorker
      }
      await this.relayVerifierInstance.verifyRelayedCall(relayRequest, signature, overrides)
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        verifierAccepted: false,
        reverted: false,
        returnValue: `view call to 'relayCall' reverted in verifier: ${message}`
      }
    }

    // If the verified passed, try relaying the transaction (in local view call)
    try {
      const override = {
        from: relayRequest.relayData.relayWorker,
        gasPrice: relayRequest.relayData.gasPrice,
        gas: externalGasLimit
      }
      const res = await relayHub.relayCall(
        relayRequest,
        signature,
        override
      )

      return {
        verifierAccepted: true,
        reverted: false,
        returnValue: res.value
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        verifierAccepted: true,
        reverted: true,
        returnValue: `view call to 'relayCall' reverted in client: ${message}`
      }
    }
  }

  async validateAcceptDeployCall (
    relayRequest: DeployRequest,
    signature: PrefixedHexString): Promise<{ verifierAccepted: boolean, returnValue: BigNumberString, reverted: boolean }> {
    const relayHub = this.relayHubInstance
    const externalGasLimit = await this.getMaxViewableGasLimit(relayRequest)

    // First call the verifier
    try {
      await this.deployVerifierInstance.verifyRelayedCall(relayRequest, signature, { from: relayRequest.relayData.relayWorker })
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
      const overrides = {
        from: relayRequest.relayData.relayWorker,
        gasPrice: relayRequest.relayData.gasPrice,
        gas: externalGasLimit
      }
      const res = await relayHub.deployCall(
        relayRequest,
        signature,
        overrides
      )

      return {
        verifierAccepted: true,
        reverted: false,
        returnValue: res.value
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

  async getMaxViewableGasLimit (relayRequest: RelayRequest | DeployRequest): Promise<BigNumber> {
    const blockGasLimit = (await this.provider.getBlock('latest')).gasLimit
    const blockGasWorthOfEther = BigNumber.from(relayRequest.relayData.gasPrice).mul(BigNumber.from(blockGasLimit))
    const workerBalance = BigNumber.from(await this.getBalance(relayRequest.relayData.relayWorker))
    return blockGasWorthOfEther.lt(workerBalance) ? blockGasWorthOfEther : workerBalance
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

  async getPastEventsForHub (events: EventFilter = ActiveManagerEvents, fromBlock?: providers.BlockTag, toBlock?: providers.BlockTag): Promise<Event[]> {
    return await this.relayHubInstance.queryFilter(events, fromBlock, toBlock)
  }

  async getPastEventsForStakeManagement (events: EventFilter = ActiveManagerEvents, fromBlock?: providers.BlockTag, toBlock?: providers.BlockTag): Promise<Event[]> {
    return await this.relayHubInstance.queryFilter(events, fromBlock, toBlock)
  }

  async getBalance (address: Address, defaultBlock: providers.BlockTag = 'latest'): Promise<BigNumber> {
    return await this.provider.getBalance(address, defaultBlock)
  }

  async getBlockNumber (): Promise<number> {
    return await this.provider.getBlockNumber()
  }

  async sendSignedTransaction (rawTx: providers.TransactionRequest): Promise<providers.TransactionResponse> {
    return await this.provider.getSigner().sendTransaction(rawTx)
  }

  async estimateGas (transactionDetails: EnvelopingTransactionDetails): Promise<BigNumber> {
    return await this.provider.estimateGas(transactionDetails)
  }

  // TODO: cache response for some time to optimize. It doesn't make sense to optimize these requests in calling code.
  async getGasPrice (): Promise<BigNumber> {
    return await this.provider.getGasPrice()
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

  async getCode (address: string): Promise<string> {
    return await this.provider.getCode(address)
  }

  getChainId (): number {
    if (this.chainId == null) {
      throw new Error('_init not called')
    }
    return this.chainId
  }

  getNetworkId (): number {
    if (this.networkId == null) {
      throw new Error('_init not called')
    }
    return this.networkId
  }

  getNetworkType (): string {
    if (this.networkType == null) {
      throw new Error('_init not called')
    }
    return this.networkType
  }

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

  async walletFactoryDeployEstimageGas (request: DeployRequest, factory: Address, domainHash: string,
    suffixData: string, signature: string, testCall: boolean = false): Promise<BigNumber> {
    const pFactory = await this._createFactory(factory)

    if (testCall) {
      await pFactory.relayedUserSmartWalletCreation(request.request, domainHash,
        suffixData, signature, { from: request.request.relayHub })
    }
    return await pFactory.estimateGas.relayedUserSmartWalletCreation(request.request, domainHash,
      suffixData, signature, { from: request.request.relayHub })
  }

  // TODO: a way to make a relay hub transaction with a specified nonce without exposing the 'method' abstraction
  async getRegisterRelayMethod (url: string): Promise<any> {
    return await this.relayHubInstance.registerRelayServer(url)
  }

  async getAddRelayWorkersMethod (workers: Address[]): Promise<any> {
    return await this.relayHubInstance.addRelayWorkers(workers)
  }

  // /**
  //  * Web3.js as of 1.2.6 (see web3-core-method::_confirmTransaction) does not allow
  //  * broadcasting of a transaction without waiting for it to be mined.
  //  * This method sends the RPC call directly
  //  * @param signedTransaction - the raw signed transaction to broadcast
  //  */
  // async broadcastTransaction (signedTransaction: PrefixedHexString): Promise<PrefixedHexString> {
  //   if (this.provider == null) {
  //       throw new Error('provider is not set')
  //     }
  //     return await this.provider.send(
  //       'eth_sendRawTransaction',
  //       [
  //         signedTransaction,
  //       ]
  //     )
  // }
}

/**
 * Ganache does not seem to enforce EIP-155 signature. Buidler does, though.
 * This is how {@link Transaction} constructor allows support for custom and private network.
 * @param chainId
 * @param networkId
 * @param chain
 * @return {{common: Common}}
 */
export function getRawTxOptions (chainId: number, networkId: number, chain?: string): Common {
  if (chain == null || chain === 'main' || chain === 'private') {
    chain = 'mainnet'
  }
  return Common.forCustomChain(
    chain,
    {
      chainId,
      networkId
    }, 'istanbul'
  )
}

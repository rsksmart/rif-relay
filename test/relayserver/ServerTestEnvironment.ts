// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import crypto from 'crypto'
import { HttpProvider } from 'web3-core'
import { toHex, toBN, keccak256 } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'
import { Address } from '../../src/relayclient/types/Aliases'
import {
  IForwarderInstance,
  IRelayHubInstance,
  IStakeManagerInstance, TestVerifierEverythingAcceptedInstance, TestRecipientInstance, SmartWalletInstance, TestDeployVerifierEverythingAcceptedInstance
} from '../../types/truffle-contracts'
import {
  assertRelayAdded,
  getTemporaryWorkdirs,
  ServerWorkdirs
} from './ServerTestUtils'
import ContractInteractor from '../../src/common/ContractInteractor'
import EnvelopingTransactionDetails from '../../src/relayclient/types/EnvelopingTransactionDetails'
import PingResponse from '../../src/common/PingResponse'
import { KeyManager } from '../../src/relayserver/KeyManager'
import { PrefixedHexString } from 'ethereumjs-tx'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import { RelayRegisteredEventInfo } from '../../src/relayclient/types/RelayRegisteredEventInfo'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { ServerConfigParams } from '../../src/relayserver/ServerConfigParams'
import { TxStoreManager } from '../../src/relayserver/TxStoreManager'
import { configure, EnvelopingConfig } from '../../src/relayclient/Configurator'
import { constants } from '../../src/common/Constants'
import { deployHub, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount } from '../TestUtils'
import { removeHexPrefix } from '../../src/common/Utils'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import RelayVerifierABI from '../../src/common/interfaces/IVerifier.json'
import DeployVerifierABI from '../../src/common/interfaces/IDeployVerifier.json'

import { defaultEnvironment } from '../../src/common/Environments'

import { RelayHubConfiguration } from '../../src/relayclient/types/RelayHubConfiguration'
import { ServerAction } from '../../src/relayserver/StoredTransaction'
import { SendTransactionDetails } from '../../src/relayserver/TransactionManager'
import { ether } from '@openzeppelin/test-helpers'

const StakeManager = artifacts.require('StakeManager')
const TestRecipient = artifacts.require('TestRecipient')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('TestDeployVerifierEverythingAccepted')

const SmartWallet = artifacts.require('SmartWallet')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(RelayVerifierABI)
abiDecoder.addABI(DeployVerifierABI)

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestVerifierEverythingAccepted.abi)
// @ts-ignore
abiDecoder.addABI(TestDeployVerifierEverythingAccepted.abi)

export const LocalhostOne = 'http://localhost:8090'

export interface PrepareRelayRequestOption {
  to: string
  from: string
  verifier: string // TODO Change to relay and deploy verifiers
  pctRelayFee: number
  baseRelayFee: string
}

export class ServerTestEnvironment {
  stakeManager!: IStakeManagerInstance
  relayHub!: IRelayHubInstance
  forwarder!: IForwarderInstance
  relayVerifier!: TestVerifierEverythingAcceptedInstance
  deployVerifier!: TestDeployVerifierEverythingAcceptedInstance

  recipient!: TestRecipientInstance

  relayOwner!: Address
  gasLess!: Address

  encodedFunction!: PrefixedHexString

  verifierData!: PrefixedHexString
  clientId!: string

  options?: PrepareRelayRequestOption

  /**
   * Note: do not call methods of contract interactor inside Test Environment. It may affect Profiling Test.
   */
  contractInteractor!: ContractInteractor

  relayClient!: RelayClient
  provider: HttpProvider
  web3: Web3
  relayServer!: RelayServer

  constructor (provider: HttpProvider, accounts: Address[]) {
    this.provider = provider
    this.web3 = new Web3(this.provider)
    this.relayOwner = accounts[4]
  }

  /**
   * @param clientConfig
   * @param contractFactory - added for Profiling test, as it requires Test Environment to be using
   * different provider from the contract interactor itself.
   */
  async init (clientConfig: Partial<EnvelopingConfig> = {}, relayHubConfig: Partial<RelayHubConfiguration> = {}, contractFactory?: (clientConfig: Partial<EnvelopingConfig>) => Promise<ContractInteractor>): Promise<void> {
    this.stakeManager = await StakeManager.new(0)
    this.relayHub = await deployHub(this.stakeManager.address, undefined, relayHubConfig)
    this.recipient = await TestRecipient.new()
    this.relayVerifier = await TestVerifierEverythingAccepted.new()
    this.deployVerifier = await TestDeployVerifierEverythingAccepted.new()

    this.encodedFunction = this.recipient.contract.methods.emitMessage('hello world').encodeABI()

    const gaslessAccount = await getGaslessAccount()
    this.gasLess = gaslessAccount.address

    const sWalletTemplate = await SmartWallet.new()
    const factory = await createProxyFactory(sWalletTemplate)
    const chainId = clientConfig.chainId ?? (await getTestingEnvironment()).chainId

    const defaultAccount = web3.defaultAccount ?? (await web3.eth.getAccounts())[0]
    const smartWallet: SmartWalletInstance = await createSmartWallet(defaultAccount ?? constants.ZERO_ADDRESS, this.gasLess, factory, gaslessAccount.privateKey, chainId)
    this.forwarder = smartWallet

    const shared: Partial<EnvelopingConfig> = {
      logLevel: 5,
      relayHubAddress: this.relayHub.address,
      relayVerifierAddress: this.relayVerifier.address,
      deployVerifierAddress: this.deployVerifier.address
    }
    if (contractFactory == null) {
      this.contractInteractor = new ContractInteractor(this.provider, configure(shared))
      await this.contractInteractor.init()
    } else {
      this.contractInteractor = await contractFactory(shared)
    }
    const mergedConfig = Object.assign({}, shared, clientConfig)
    this.relayClient = new RelayClient(this.provider, configure(mergedConfig))

    // Regisgter gasless account to avoid signing with RSKJ
    this.relayClient.accountManager.addAccount(gaslessAccount)
  }

  async newServerInstance (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs): Promise<void> {
    await this.newServerInstanceNoInit(config, serverWorkdirs, undefined, this.defaultReplenishFunction)
    await this.relayServer.init()
    // initialize server - gas price, stake, owner, etc, whatever
    const latestBlock = await this.web3.eth.getBlock('latest')
    const receipts = await this.relayServer._worker(latestBlock.number)
    await assertRelayAdded(receipts, this.relayServer) // sanity check
    await this.relayServer._worker(latestBlock.number + 1)
  }

  _createKeyManager (workdir?: string): KeyManager {
    if (workdir != null) {
      return new KeyManager(1, workdir)
    } else {
      return new KeyManager(1, undefined, crypto.randomBytes(32).toString())
    }
  }

  async newServerInstanceNoInit (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs, unstakeDelay = constants.weekInSec, replenishStrategy?: (relayServer: RelayServer, workerIndex: number, currentBlock: number) => Promise<PrefixedHexString[]>): Promise<void> {
    this.newServerInstanceNoFunding(config, serverWorkdirs, replenishStrategy)
    await web3.eth.sendTransaction({
      to: this.relayServer.managerAddress,
      from: this.relayOwner,
      value: web3.utils.toWei('2', 'ether')
    })

    await this.stakeManager.stakeForAddress(this.relayServer.managerAddress, unstakeDelay, {
      from: this.relayOwner,
      value: ether('1')
    })
    await this.stakeManager.authorizeHubByOwner(this.relayServer.managerAddress, this.relayHub.address, {
      from: this.relayOwner
    })
  }

  newServerInstanceNoFunding (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs, replenishStrategy?: (relayServer: RelayServer, workerIndex: number, currentBlock: number) => Promise<PrefixedHexString[]>): void {
    const managerKeyManager = this._createKeyManager(serverWorkdirs?.managerWorkdir)
    const workersKeyManager = this._createKeyManager(serverWorkdirs?.workersWorkdir)
    const txStoreManager = new TxStoreManager({ workdir: serverWorkdirs?.workdir ?? getTemporaryWorkdirs().workdir })
    const serverDependencies = {
      contractInteractor: this.contractInteractor,
      txStoreManager,
      managerKeyManager,
      workersKeyManager
    }
    const shared: Partial<ServerConfigParams> = {
      relayHubAddress: this.relayHub.address,
      checkInterval: 10,
      logLevel: 5,
      relayVerifierAddress: this.relayVerifier.address,
      deployVerifierAddress: this.deployVerifier.address
    }
    const mergedConfig: Partial<ServerConfigParams> = Object.assign({}, shared, config)

    this.relayServer = new RelayServer(mergedConfig, serverDependencies, replenishStrategy)

    this.relayServer.on('error', (e) => {
      console.log('newServer event', e.message)
    })
    this.relayServer.config.trustedVerifiers.push(this.relayVerifier.address)
    this.relayServer.config.trustedVerifiers.push(this.deployVerifier.address)
  }

  async createRelayHttpRequest (overrideDetails: Partial<EnvelopingTransactionDetails> = {}): Promise<RelayTransactionRequest> {
    const pingResponse = {
      relayHubAddress: this.relayHub.address,
      relayWorkerAddress: this.relayServer.workerAddress
    }
    const eventInfo: RelayRegisteredEventInfo = {
      baseRelayFee: this.relayServer.config.baseRelayFee,
      pctRelayFee: this.relayServer.config.pctRelayFee.toString(),
      relayManager: '',
      relayUrl: ''
    }
    const relayInfo: RelayInfo = {
      pingResponse: pingResponse as PingResponse,
      relayInfo: eventInfo
    }

    const transactionDetails: EnvelopingTransactionDetails = {
      from: this.gasLess,
      to: this.recipient.address,
      data: this.encodedFunction,
      relayHub: this.relayHub.address,
      callVerifier: this.relayVerifier.address,
      callForwarder: this.forwarder.address,
      gas: toHex(1000000),
      gasPrice: toHex(20000000000),
      tokenAmount: toHex(0),
      tokenGas: toHex(0),
      tokenContract: constants.ZERO_ADDRESS,
      isSmartWalletDeploy: false
    }

    return await this.relayClient._prepareRelayHttpRequest(relayInfo, Object.assign({}, transactionDetails, overrideDetails))
  }

  async defaultReplenishFunction (relayServer: RelayServer, workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]> {
    const transactionHashes: PrefixedHexString[] = []

    if (relayServer === undefined || relayServer === null) {
      return transactionHashes
    }

    let managerEthBalance = await relayServer.getManagerBalance()
    relayServer.workerBalanceRequired.currentValue = await relayServer.getWorkerBalance(workerIndex)

    if (managerEthBalance.gte(toBN(relayServer.config.managerTargetBalance.toString())) && relayServer.workerBalanceRequired.isSatisfied) {
      // all filled, nothing to do
      return transactionHashes
    }
    managerEthBalance = await relayServer.getManagerBalance()

    const mustReplenishWorker = !relayServer.workerBalanceRequired.isSatisfied
    const isReplenishPendingForWorker = await relayServer.txStoreManager.isActionPending(ServerAction.VALUE_TRANSFER, relayServer.workerAddress)

    if (mustReplenishWorker && !isReplenishPendingForWorker) {
      const refill = toBN(relayServer.config.workerTargetBalance.toString()).sub(relayServer.workerBalanceRequired.currentValue)
      console.log(
        `== replenishServer: mgr balance=${managerEthBalance.toString()}
          \n${relayServer.workerBalanceRequired.description}\n refill=${refill.toString()}`)

      if (refill.lt(managerEthBalance.sub(toBN(relayServer.config.managerMinBalance)))) {
        console.log('Replenishing worker balance by manager rbtc balance')
        const details: SendTransactionDetails = {
          signer: relayServer.managerAddress,
          serverAction: ServerAction.VALUE_TRANSFER,
          destination: relayServer.workerAddress,
          value: toHex(refill),
          creationBlockNumber: currentBlock,
          gasLimit: defaultEnvironment.mintxgascost
        }
        const { transactionHash } = await relayServer.transactionManager.sendTransaction(details)
        transactionHashes.push(transactionHash)
      } else {
        const message = `== replenishServer: can't replenish: mgr balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`
        relayServer.emit('fundingNeeded', message)
        console.log(message)
      }
    }
    return transactionHashes
  }

  async relayTransaction (assertRelayed = true, overrideDetails: Partial<EnvelopingTransactionDetails> = {}): Promise<{
    signedTx: PrefixedHexString
    txHash: PrefixedHexString
    reqSigHash: PrefixedHexString
  }> {
    const req = await this.createRelayHttpRequest(overrideDetails)
    const signedTx = await this.relayServer.createRelayTransaction(req)
    const txHash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))
    const reqSigHash = ethUtils.bufferToHex(ethUtils.keccak256(req.metadata.signature))
    if (assertRelayed) {
      await this.assertTransactionRelayed(txHash, keccak256(req.metadata.signature))
    }
    return {
      txHash,
      signedTx,
      reqSigHash
    }
  }

  async clearServerStorage (): Promise<void> {
    await this.relayServer.transactionManager.txStoreManager.clearAll()
    assert.deepEqual([], await this.relayServer.transactionManager.txStoreManager.getAll())
  }

  async assertTransactionRelayed (txHash: string, reqSignatureHash: string, overrideDetails: Partial<EnvelopingTransactionDetails> = {}): Promise<void> {
    const receipt = await web3.eth.getTransactionReceipt(txHash)
    if (receipt == null) {
      throw new Error('Transaction Receipt not found')
    }
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(this.relayServer.registrationManager._parseEvent)
    const event1 = decodedLogs.find((e: { name: string }) => e.name === 'SampleRecipientEmitted')
    assert.exists(event1, 'SampleRecipientEmitted not found, maybe transaction was not relayed successfully')
    assert.equal(event1.args.message, 'hello world')
    const event2 = decodedLogs.find((e: { name: string }) => e.name === 'TransactionRelayed')
    assert.exists(event2, 'TransactionRelayed not found, maybe transaction was not relayed successfully')
    assert.equal(event2.name, 'TransactionRelayed')
    /**
     * event TransactionRelayed(
        address indexed relayManager,
        address relayWorker,
        bytes32 relayRequestSigHash);
    */
    assert.equal(event2.args.relayWorker.toLowerCase(), this.relayServer.workerAddress.toLowerCase())
    assert.equal(event2.args.relayManager.toLowerCase(), this.relayServer.managerAddress.toLowerCase())
    assert.equal(event2.args.relayRequestSigHash, reqSignatureHash)
  }
}

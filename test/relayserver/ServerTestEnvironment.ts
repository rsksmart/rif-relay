// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import crypto from 'crypto'
import { HttpProvider } from 'web3-core'
import { toHex } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'
import { Address } from '../../src/relayclient/types/Aliases'
import {
  IForwarderInstance,
  IRelayHubInstance,
  IStakeManagerInstance, TestPaymasterEverythingAcceptedInstance, SmartWalletInstance, TestTokenRecipientInstance
} from '../../types/truffle-contracts'
import {
  assertRelayAdded,
  getTemporaryWorkdirs,
  ServerWorkdirs
} from './ServerTestUtils'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'
import PingResponse from '../../src/common/PingResponse'
import { KeyManager } from '../../src/relayserver/KeyManager'
import { PrefixedHexString } from 'ethereumjs-tx'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import { RelayRegisteredEventInfo } from '../../src/relayclient/types/RelayRegisteredEventInfo'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { configureServer, ServerConfigParams } from '../../src/relayserver/ServerConfigParams'
import { TxStoreManager } from '../../src/relayserver/TxStoreManager'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { constants } from '../../src/common/Constants'
import { deployHub, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount } from '../TestUtils'
import { ether, removeHexPrefix } from '../../src/common/Utils'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import PayMasterABI from '../../src/common/interfaces/IPaymaster.json'
import { RelayHubConfiguration } from '../../src/relayclient/types/RelayHubConfiguration'
import { EnvelopingArbiter } from '../../src/enveloping/EnvelopingArbiter'
import { CommitmentReceipt } from '../../src/enveloping/Commitment'

const StakeManager = artifacts.require('StakeManager')
const TestTokenRecipient = artifacts.require('TestTokenRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const SmartWallet = artifacts.require('SmartWallet')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestTokenRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)
export const LocalhostOne = 'http://localhost:8090'

export interface PrepareRelayRequestOption {
  to: string
  from: string
  paymaster: string
  pctRelayFee: number
  baseRelayFee: string
}

export class ServerTestEnvironment {
  stakeManager!: IStakeManagerInstance
  relayHub!: IRelayHubInstance
  forwarder!: IForwarderInstance
  paymaster!: TestPaymasterEverythingAcceptedInstance
  tokenRecipient!: TestTokenRecipientInstance

  relayOwner!: Address
  gasLess!: Address

  encodedFunction!: PrefixedHexString

  paymasterData!: PrefixedHexString
  clientId!: string

  options?: PrepareRelayRequestOption

  /**
   * Note: do not call methods of contract interactor inside Test Environment. It may affect Profiling Test.
   */
  contractInteractor!: ContractInteractor
  envelopingArbiter!: EnvelopingArbiter

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
  async init (clientConfig: Partial<GSNConfig> = {}, relayHubConfig: Partial<RelayHubConfiguration> = {}, contractFactory?: (clientConfig: Partial<GSNConfig>) => Promise<ContractInteractor>): Promise<void> {
    this.stakeManager = await StakeManager.new()
    this.relayHub = await deployHub(this.stakeManager.address, undefined, relayHubConfig)
    this.tokenRecipient = await TestTokenRecipient.new()
    this.paymaster = await TestPaymasterEverythingAccepted.new()

    // await this.paymaster.setTrustedForwarder(this.forwarder.address)
    await this.paymaster.setRelayHub(this.relayHub.address)
    await this.paymaster.deposit({ value: this.web3.utils.toWei('1', 'ether') })

    const gaslessAccount = await getGaslessAccount()
    this.gasLess = gaslessAccount.address

    // this.encodedFunction = this.recipient.contract.methods.emitMessage('hello world').encodeABI()
    this.encodedFunction = this.tokenRecipient.contract.methods.transfer(gaslessAccount.address, '5').encodeABI()

    const sWalletTemplate = await SmartWallet.new()
    const factory = await createProxyFactory(sWalletTemplate)
    const chainId = clientConfig.chainId ?? (await getTestingEnvironment()).chainId

    const smartWallet: SmartWalletInstance = await createSmartWallet(this.gasLess, factory, gaslessAccount.privateKey, chainId)
    this.forwarder = smartWallet
    await this.tokenRecipient.mint('200', smartWallet.address)

    const shared: Partial<GSNConfig> = {
      logLevel: 5,
      relayHubAddress: this.relayHub.address
    }
    if (contractFactory == null) {
      this.contractInteractor = new ContractInteractor(this.provider, configureGSN(shared))
      await this.contractInteractor.init()
    } else {
      this.contractInteractor = await contractFactory(shared)
    }
    this.envelopingArbiter = new EnvelopingArbiter(configureServer({}), this.web3.givenProvider)
    await this.envelopingArbiter.start()
    const mergedConfig = Object.assign({}, shared, clientConfig)
    this.relayClient = new RelayClient(this.provider, configureGSN(mergedConfig))

    // Register gasless account to avoid signing with RSKJ
    this.relayClient.accountManager.addAccount(gaslessAccount)
  }

  async newServerInstance (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs): Promise<void> {
    await this.newServerInstanceNoInit(config, serverWorkdirs)
    await this.relayServer.init()
    // initialize server - gas price, stake, owner, etc, whatever
    const latestBlock = await this.web3.eth.getBlock('latest')
    const receipts = await this.relayServer._worker(latestBlock.number)
    await assertRelayAdded(receipts, this.relayServer) // sanity check
    await this.relayServer._worker(latestBlock.number + 1)
  }

  _createKeyManager (accounts: number, workdir?: string): KeyManager {
    if (workdir != null) {
      return new KeyManager(accounts, workdir)
    } else {
      return new KeyManager(accounts, undefined, crypto.randomBytes(32).toString())
    }
  }

  async newServerInstanceNoInit (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs, unstakeDelay = constants.weekInSec): Promise<void> {
    this.newServerInstanceNoFunding(config, serverWorkdirs)
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

  newServerInstanceNoFunding (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs): void {
    const managerKeyManager = this._createKeyManager(1, serverWorkdirs?.managerWorkdir)
    const workersKeyManager = this._createKeyManager(4, serverWorkdirs?.workersWorkdir)
    const txStoreManager = new TxStoreManager({ workdir: serverWorkdirs?.workdir ?? getTemporaryWorkdirs().workdir })
    const serverDependencies = {
      contractInteractor: this.contractInteractor,
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      envelopingArbiter: this.envelopingArbiter
    }
    const shared: Partial<ServerConfigParams> = {
      relayHubAddress: this.relayHub.address,
      checkInterval: 10,
      logLevel: 5
    }
    const mergedConfig: Partial<ServerConfigParams> = Object.assign({}, shared, config)
    this.relayServer = new RelayServer(mergedConfig, serverDependencies)
    this.relayServer.on('error', (e) => {
      console.log('newServer event', e.message)
    })
  }

  async createRelayHttpRequest (overrideDetails: Partial<GsnTransactionDetails> = {}, useValidMaxDelay: boolean = true, useValidWorker: boolean = true, workerIndex = 1): Promise<RelayTransactionRequest> {
    const pingResponse = {
      relayHubAddress: this.relayHub.address,
      relayWorkerAddress: this.relayServer.workerAddress[workerIndex]
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

    const gsnTransactionDetails: GsnTransactionDetails = {
      from: this.gasLess,
      to: this.tokenRecipient.address,
      data: this.encodedFunction,
      paymaster: this.paymaster.address,
      forwarder: this.forwarder.address,
      gas: toHex(1000000),
      gasPrice: toHex(20000000000),
      tokenRecipient: constants.ZERO_ADDRESS,
      tokenAmount: toHex(0),
      tokenContract: constants.ZERO_ADDRESS,
      factory: constants.ZERO_ADDRESS
    }

    let maxTime, delay
    if (useValidMaxDelay) {
      if (workerIndex === 0) {
        delay = 320
      } else if (workerIndex === 1) {
        delay = 140
      } else if (workerIndex === 2) {
        delay = 40
      } else {
        delay = 10
      }
      maxTime = Date.now() + (delay * 1000)
    } else {
      maxTime = Date.now()
    }

    if (!useValidWorker) {
      pingResponse.relayWorkerAddress = this.relayServer.workerAddress[3]
    }

    return await this.relayClient._prepareRelayHttpRequest(relayInfo, Object.assign({}, gsnTransactionDetails, overrideDetails), maxTime)
  }

  /**
   * Relays a transaction through the Test Environment
   * @param assertRelayed flag for asserting if the transaction has been relayed successfully
   * @param overrideDetails custom GsnTransactionDetails data
   * @param useValidMaxDelay flag for using a valid maxDelay value or not
   * @param useValidWorker flag for using a valid relayWorkerAddress value or not
   * @param workerIndex force the transaction to be sent using a specific worker
   * @returns the hash of the Tx, the signed Tx and a signed commitment receipt
   */
  async relayTransaction (assertRelayed = true, overrideDetails: Partial<GsnTransactionDetails> = {}, useValidMaxDelay = true, useValidWorker = true, workerIndex = 1): Promise<{
    signedTx: PrefixedHexString
    txHash: PrefixedHexString
    signedReceipt: CommitmentReceipt | undefined
  }> {
    const req = await this.createRelayHttpRequest(overrideDetails, useValidMaxDelay, useValidWorker, workerIndex)
    const { signedTx, signedReceipt } = await this.relayServer.createRelayTransaction(req)
    const txHash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))

    if (assertRelayed) {
      await this.assertTransactionRelayed(txHash)
    }
    return {
      txHash,
      signedTx,
      signedReceipt
    }
  }

  async clearServerStorage (): Promise<void> {
    await this.relayServer.transactionManager.txStoreManager.clearAll()
    assert.deepEqual([], await this.relayServer.transactionManager.txStoreManager.getAll())
  }

  async assertTransactionRelayed (txHash: string, overrideDetails: Partial<GsnTransactionDetails> = {}): Promise<void> {
    const receipt = await web3.eth.getTransactionReceipt(txHash)
    if (receipt == null) {
      throw new Error('Transaction Receipt not found')
    }
    const sender = overrideDetails.from ?? this.gasLess
    const tokenPayer = overrideDetails.forwarder ?? this.forwarder.address
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(this.relayServer.registrationManager._parseEvent)
    const event1 = decodedLogs.find((e: { name: string }) => e.name === 'Transfer')
    assert.exists(event1, 'Transfer not found, maybe transaction was not relayed successfully')
    assert.equal(event1.args.value, '5')
    assert.equal(event1.args.from.toLowerCase(), tokenPayer.toLowerCase())
    assert.equal(event1.args.to.toLowerCase(), this.gasLess.toLowerCase())

    const event2 = decodedLogs.find((e: { name: string }) => e.name === 'TransactionRelayed')
    const workerIndex = this.relayServer.getWorkerIndex(event2.args.relayWorker)
    assert.exists(event2, 'TransactionRelayed not found, maybe transaction was not relayed successfully')
    assert.equal(event2.name, 'TransactionRelayed')
    assert.equal(event2.args.relayWorker.toLowerCase(), this.relayServer.workerAddress[workerIndex].toLowerCase())
    assert.equal(event2.args.from.toLowerCase(), sender.toLowerCase())
    assert.equal(event2.args.to.toLowerCase(), this.tokenRecipient.address.toLowerCase())
    assert.equal(event2.args.paymaster.toLowerCase(), this.paymaster.address.toLowerCase())
  }
}

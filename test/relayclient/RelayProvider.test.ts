import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { HttpProvider, WebsocketProvider } from 'web3-core'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import proxyFactoryAbi from '../../src/common/interfaces/ISmartWalletFactory.json'

import chaiAsPromised from 'chai-as-promised'
import Web3 from 'web3'
import { toBN, toChecksumAddress } from 'web3-utils'

// @ts-ignore
import abiDecoder from 'abi-decoder'

import { BaseTransactionReceipt, RelayProvider } from '../../src/relayclient/RelayProvider'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import {
  RelayHubInstance,
  StakeManagerInstance,
  TestVerifierConfigurableMisbehaviorInstance,
  TestDeployVerifierConfigurableMisbehaviorInstance,
  TestRecipientContract,
  TestRecipientInstance,
  ProxyFactoryInstance,
  SmartWalletInstance,
  TestTokenInstance
} from '../../types/truffle-contracts'
import { isRsk } from '../../src/common/Environments'
import { deployHub, startRelay, stopRelay, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount, prepareTransaction } from '../TestUtils'
import BadRelayClient from '../dummies/BadRelayClient'

// @ts-ignore
import { constants } from '../../src/common/Constants'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'
import { AccountKeypair } from '../../src/relayclient/AccountManager'

const { expect, assert } = require('chai').use(chaiAsPromised)

const StakeManager = artifacts.require('StakeManager')
const SmartWallet = artifacts.require('SmartWallet')
const TestToken = artifacts.require('TestToken')
const TestVerifierConfigurableMisbehavior = artifacts.require('TestVerifierConfigurableMisbehavior')
const TestDeployVerifierConfigurableMisbehavior = artifacts.require('TestDeployVerifierConfigurableMisbehavior')

const underlyingProvider = web3.currentProvider as HttpProvider
const revertReasonEnabled = false // Enable when the RSK node supports revert reason codes
abiDecoder.addABI(proxyFactoryAbi)

contract('RelayProvider', function (accounts) {
  let web3: Web3
  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let verifierInstance: TestVerifierConfigurableMisbehaviorInstance
  let deployVerifierInstance: TestDeployVerifierConfigurableMisbehaviorInstance
  let relayProcess: ChildProcessWithoutNullStreams
  let relayProvider: RelayProvider
  let factory: ProxyFactoryInstance
  let sWalletTemplate: SmartWalletInstance
  let smartWallet: SmartWalletInstance
  let sender: string
  let token: TestTokenInstance
  let gaslessAccount: AccountKeypair

  before(async function () {
    sender = accounts[0]
    gaslessAccount = await getGaslessAccount()
    web3 = new Web3(underlyingProvider)
    stakeManager = await StakeManager.new()
    relayHub = await deployHub(stakeManager.address, constants.ZERO_ADDRESS)

    sWalletTemplate = await SmartWallet.new()
    const env = (await getTestingEnvironment())
    factory = await createProxyFactory(sWalletTemplate)
    smartWallet = await createSmartWallet(accounts[0], gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)
    token = await TestToken.new()
    await token.mint('1000', smartWallet.address)

    verifierInstance = await TestVerifierConfigurableMisbehavior.new()
    deployVerifierInstance = await TestDeployVerifierConfigurableMisbehavior.new()

    relayProcess = await startRelay(relayHub.address, stakeManager, {
      relaylog: process.env.relaylog,
      stake: 1e18,
      url: 'asd',
      relayOwner: accounts[1],
      ethereumNodeUrl: underlyingProvider.host,
      deployVerifierAddress: deployVerifierInstance.address,
      relayVerifierAddress: verifierInstance.address
    })
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  describe('Use Provider to relay transparently', () => {
    let testRecipient: TestRecipientInstance
    let testRecipient2: TestRecipientInstance
    before(async () => {
      const env = await getTestingEnvironment()
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new()
      testRecipient2 = await TestRecipient.new()
      const gsnConfig = configureGSN({
        logLevel: 5,
        relayHubAddress: relayHub.address,
        chainId: env.chainId,
        forwarderAddress: smartWallet.address,
        relayVerifierAddress: verifierInstance.address,
        deployVerifierAddress: deployVerifierInstance.address
      })

      let websocketProvider: WebsocketProvider

      if (isRsk(await getTestingEnvironment())) {
        websocketProvider = new Web3.providers.WebsocketProvider('ws://localhost:4445/websocket')
      } else {
        websocketProvider = new Web3.providers.WebsocketProvider(underlyingProvider.host)
      }

      relayProvider = new RelayProvider(websocketProvider as any, gsnConfig)

      // NOTE: in real application its enough to set the provider in web3.
      // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
      // so changing the global one is not enough.
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
      relayProvider.addAccount(gaslessAccount)
    })
    it('should relay transparently', async function () {
      const res = await testRecipient.emitMessage('hello world', {
        from: gaslessAccount.address,
        forceGasPrice: '0x51f4d5c00',
        value: '0',
        // TODO: for some reason estimated values are crazy high!
        gas: '100000',
        callVerifier: verifierInstance.address
      })

      expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
        message: 'hello world',
        msgValue: '0',
        balance: '0'
      })
    })

    it('should relay transparently with value', async function () {
      const value = 1e18.toString()
      // note: this test only validates we process the "value" parameter of the request properly.
      // a real use-case should have a verifier to transfer the value into the forwarder,
      // probably by swapping user's tokens into eth.

      await web3.eth.sendTransaction({
        from: sender,
        to: smartWallet.address,
        value
      })

      const res = await testRecipient.emitMessage('hello world', {
        from: gaslessAccount.address,
        forceGasPrice: '0x51f4d5c00',
        value,
        gas: '100000',
        callVerifier: verifierInstance.address
      })

      expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
        message: 'hello world',
        msgValue: value,
        balance: value
      })
    })

    it('should revert if the sender is not the owner of the smart wallet', async function () {
      try {
        const differentSender = await getGaslessAccount()
        relayProvider.addAccount(differentSender)
        await testRecipient.emitMessage('hello world', {
          from: differentSender.address, // different sender
          forceGasPrice: '0x51f4d5c00',
          value: '0',
          gas: '100000',
          callVerifier: verifierInstance.address
        })
      } catch (error) {
        const expectedText = 'relayCall (local call) reverted in server'
        const err: string = String(error)
        assert.isTrue(err.includes(expectedText))
        return
      }
      assert.fail('It should have thrown an exception')
    })

    it('should calculate the correct smart wallet address', async function () {
      assert.isTrue(relayProvider != null)
      const env = await getTestingEnvironment()
      const gsnConfig = configureGSN({
        relayHubAddress: relayHub.address, logLevel: 5, chainId: env.chainId
      })
      gsnConfig.forwarderAddress = constants.ZERO_ADDRESS
      const recoverer = constants.ZERO_ADDRESS
      const customLogic = constants.ZERO_ADDRESS
      const walletIndex: number = 0
      const bytecodeHash = web3.utils.keccak256(await factory.getCreationBytecode())

      const rProvider = new RelayProvider(underlyingProvider, gsnConfig)
      const swAddress = rProvider.calculateSmartWalletAddress(factory.address, gaslessAccount.address, recoverer, customLogic, walletIndex, bytecodeHash)

      const expectedAddress = await factory.getSmartWalletAddress(gaslessAccount.address, recoverer, customLogic, constants.SHA3_NULL_S, walletIndex)

      assert.equal(swAddress, expectedAddress)
    }
    )

    it('should fail to deploy the smart wallet due to insufficient token balance', async function () {
      const ownerEOA = await getGaslessAccount()
      const recoverer = constants.ZERO_ADDRESS
      const customLogic = constants.ZERO_ADDRESS
      const logicData = '0x'
      const walletIndex = 0
      const env = await getTestingEnvironment()
      const gsnConfig = configureGSN({ relayHubAddress: relayHub.address, logLevel: 5, chainId: env.chainId, relayVerifierAddress: verifierInstance.address, deployVerifierAddress: deployVerifierInstance.address })
      assert.isTrue(relayProvider != null)
      gsnConfig.forwarderAddress = constants.ZERO_ADDRESS
      const rProvider = new RelayProvider(underlyingProvider, gsnConfig)
      rProvider.addAccount(ownerEOA)
      const bytecodeHash = web3.utils.keccak256(await factory.getCreationBytecode())
      const swAddress = rProvider.calculateSmartWalletAddress(factory.address, ownerEOA.address, recoverer, customLogic, walletIndex, bytecodeHash)

      assert.isTrue((await token.balanceOf(swAddress)).toNumber() < 10, 'Account must have insufficient funds')

      const expectedCode = await web3.eth.getCode(swAddress)
      assert.equal('0x00', expectedCode)

      const trxData: GsnTransactionDetails = {
        from: ownerEOA.address,
        to: customLogic,
        data: logicData,
        tokenContract: token.address,
        tokenAmount: '10',
        recoverer: recoverer,
        callForwarder: factory.address,
        index: walletIndex.toString(),
        isSmartWalletDeploy: true,
        callVerifier: deployVerifierInstance.address
      }

      try {
        await rProvider.deploySmartWallet(trxData)
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'relayCall (local call) reverted in server')
      }
    })

    it('should correclty deploy the smart wallet', async function () {
      const ownerEOA = await getGaslessAccount()
      const recoverer = constants.ZERO_ADDRESS
      const customLogic = constants.ZERO_ADDRESS
      const logicData = '0x'
      const walletIndex = 0
      const env = await getTestingEnvironment()
      const gsnConfig = configureGSN({ relayHubAddress: relayHub.address, logLevel: 5, chainId: env.chainId, deployVerifierAddress: deployVerifierInstance.address, relayVerifierAddress: verifierInstance.address })
      assert.isTrue(relayProvider != null)
      gsnConfig.forwarderAddress = constants.ZERO_ADDRESS
      const rProvider = new RelayProvider(underlyingProvider, gsnConfig)
      rProvider.addAccount(ownerEOA)
      const bytecodeHash = web3.utils.keccak256(await factory.getCreationBytecode())
      const swAddress = rProvider.calculateSmartWalletAddress(factory.address, ownerEOA.address, recoverer, customLogic, walletIndex, bytecodeHash)
      await token.mint('10000', swAddress)

      let expectedCode = await web3.eth.getCode(swAddress)
      assert.equal('0x00', expectedCode)

      const trxData: GsnTransactionDetails = {
        from: ownerEOA.address,
        to: customLogic,
        data: logicData,
        // gas: toHex('400000'),
        tokenContract: token.address,
        tokenAmount: '10',
        recoverer: recoverer,
        index: walletIndex.toString(),
        callVerifier: deployVerifierInstance.address,
        callForwarder: factory.address,
        isSmartWalletDeploy: true
      }

      const txHash = await rProvider.deploySmartWallet(trxData)
      const trx = await web3.eth.getTransactionReceipt(txHash)

      const logs = abiDecoder.decodeLogs(trx.logs)
      const deployedEvent = logs.find((e: any) => e != null && e.name === 'Deployed')
      const event = deployedEvent.events[0]
      assert.equal(event.name, 'addr')
      const generatedSWAddress = toChecksumAddress(event.value, env.chainId)

      assert.equal(generatedSWAddress, swAddress)
      const deployedCode = await web3.eth.getCode(generatedSWAddress)
      expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)
      assert.equal(deployedCode, expectedCode)
    }
    )

    it('should subscribe to events', async () => {
      const block = await web3.eth.getBlockNumber()

      const eventPromise = new Promise((resolve, reject) => {
        // @ts-ignore
        testRecipient2.contract.once('SampleRecipientEmitted', { fromBlock: block }, (err, ev) => {
          if (err !== null) {
            reject(err)
          } else {
            resolve(ev)
          }
        })
      })

      await testRecipient2.emitMessage('hello again', {
        from: gaslessAccount.address,
        gas: '100000',
        callVerifier: verifierInstance.address
      })
      const log: any = await eventPromise

      assert.equal(log.returnValues.message, 'hello again')
    })

    // note that the revert reason here was discovered via some truffle/ganache magic (see truffle/reason.js)
    // this is not the way the revert reason is being reported by GSN solidity contracts
    it('should fail if transaction failed', async () => {
      await expectRevert.unspecified(testRecipient.testRevert({
        from: gaslessAccount.address,
        callVerifier: verifierInstance.address
      }), 'always fail')
    })
  })

  describe('_ethSendTransaction', function () {
    const id = 777
    let testRecipient: TestRecipientInstance
    let gsnConfig: GSNConfig
    let jsonRpcPayload: JsonRpcPayload

    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new()

      const env = await getTestingEnvironment()
      gsnConfig = configureGSN({ relayHubAddress: relayHub.address, logLevel: 5, chainId: env.chainId })
      gsnConfig.forwarderAddress = smartWallet.address

      // call to emitMessage('hello world')
      jsonRpcPayload = {
        jsonrpc: '2.0',
        id,
        method: 'eth_sendTransaction',
        params: [
          {
            from: gaslessAccount.address,
            gas: '0x186a0',
            gasPrice: '0x4a817c800',
            forceGasPrice: '0x51f4d5c00',
            callVerifier: verifierInstance.address,
            to: testRecipient.address,
            data: testRecipient.contract.methods.emitMessage('hello world').encodeABI()
          }
        ]
      }
    })

    it('should call callback with error if relayTransaction throws', async function () {
      const badRelayClient = new BadRelayClient(true, false, underlyingProvider, gsnConfig)
      const relayProvider = new RelayProvider(underlyingProvider, gsnConfig, {}, badRelayClient)
      const promisified = new Promise((resolve, reject) => relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null): void => {
        reject(error)
      }))
      await expect(promisified).to.be.eventually.rejectedWith(`Rejected relayTransaction call - Reason: ${BadRelayClient.message}`)
    })

    it('should call callback with error containing relaying results dump if relayTransaction does not return a transaction object', async function () {
      const badRelayClient = new BadRelayClient(false, true, underlyingProvider, gsnConfig)
      const relayProvider = new RelayProvider(underlyingProvider, gsnConfig, {}, badRelayClient)
      const promisified = new Promise((resolve, reject) => relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null): void => {
        reject(error)
      }))
      await expect(promisified).to.be.eventually.rejectedWith('Failed to relay call. Results:')
    })

    it('should convert a returned transaction to a compatible rpc transaction hash response', async function () {
      const env = await getTestingEnvironment()
      const gsnConfig = configureGSN({
        logLevel: 5,
        relayHubAddress: relayHub.address,
        chainId: env.chainId,
        relayVerifierAddress: verifierInstance.address,
        deployVerifierAddress: deployVerifierInstance.address
      })
      gsnConfig.forwarderAddress = smartWallet.address

      const relayProvider = new RelayProvider(underlyingProvider, gsnConfig)
      relayProvider.addAccount(gaslessAccount)
      const response: JsonRpcResponse = await new Promise((resolve, reject) => relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null, result?: JsonRpcResponse): void => {
        if (error != null) {
          reject(error)
        } else {
          if (result !== undefined) {
            resolve(result)
          } else throw new Error('Result is undefined')
        }
      }))
      assert.equal(id, response.id)
      assert.equal('2.0', response.jsonrpc)
      // I don't want to hard-code tx hash, so for now just checking it is there
      assert.equal(66, response.result.length)
    })
  })

  // TODO: most of this code is copy-pasted from the RelayHub.test.ts. Maybe extract better utils?
  describe('_getTranslatedGsnResponseResult', function () {
    let relayProvider: RelayProvider
    let testRecipient: TestRecipientInstance
    let innerTxSucceedReceipt: BaseTransactionReceipt
    let notRelayedTxReceipt: BaseTransactionReceipt
    const gas = toBN(3e6).toString()

    // It is not strictly necessary to make this test against actual tx receipt, but I prefer to do it anyway
    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new()
      const env = await getTestingEnvironment()
      const gsnConfig = configureGSN({ relayHubAddress: relayHub.address, logLevel: 5, chainId: env.chainId, relayVerifierAddress: verifierInstance.address, deployVerifierAddress: verifierInstance.address, forwarderAddress: smartWallet.address })

      // @ts-ignore
      Object.keys(TestRecipient.events).forEach(function (topic) {
        // @ts-ignore
        relayHub.constructor.network.events[topic] = TestRecipient.events[topic]
      })
      relayProvider = new RelayProvider(underlyingProvider, gsnConfig)
      relayProvider.addAccount(gaslessAccount)
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
      // add accounts[0], accounts[1] and accounts[2] as worker, manager and owner
      await stakeManager.stakeForAddress(accounts[1], 1000, {
        value: ether('1'),
        from: accounts[2]
      })
      await stakeManager.authorizeHubByOwner(accounts[1], relayHub.address, { from: accounts[2] })
      await relayHub.addRelayWorkers([accounts[0]], {
        from: accounts[1]
      })

      // create desired transactions
      const nonceToUse = await smartWallet.nonce()
      const { relayRequest, signature } = await prepareTransaction(relayHub.address, testRecipient, gaslessAccount, accounts[0], verifierInstance.address, nonceToUse.toString(), smartWallet.address, token.address, '1')

      await verifierInstance.setReturnInvalidErrorCode(false)
      await verifierInstance.setRevertPreRelayCall(false)
      await verifierInstance.setOverspendAcceptGas(false)

      const innerTxSuccessReceiptTruffle = await relayHub.relayCall(relayRequest, signature, {
        from: accounts[0],
        gas,
        gasPrice: '1'
      })

      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'TransactionRelayed')
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'SampleRecipientEmitted')
      innerTxSucceedReceipt = await web3.eth.getTransactionReceipt(innerTxSuccessReceiptTruffle.tx)

      const notRelayedTxReceiptTruffle = await testRecipient.emitMessage('hello world with gas', {
        from: gaslessAccount.address,
        gas: '100000',
        gasPrice: '1',
        callVerifier: verifierInstance.address
      })
      assert.equal(notRelayedTxReceiptTruffle.logs.length, 1)
      expectEvent.inLogs(notRelayedTxReceiptTruffle.logs, 'SampleRecipientEmitted')
      notRelayedTxReceipt = await web3.eth.getTransactionReceipt(notRelayedTxReceiptTruffle.tx)
    })

    it('should fail to send transaction if verifier reverts in local execution', async function () {
      await verifierInstance.setReturnInvalidErrorCode(false)
      await verifierInstance.setRevertPreRelayCall(true)
      await verifierInstance.setOverspendAcceptGas(false)

      try {
        await testRecipient.emitMessage('hello again', {
          from: gaslessAccount.address,
          gas: '100000',
          gasPrice: '1',
          callVerifier: verifierInstance.address
        })
      } catch (error) {
        const err: string = String(error)
        if (revertReasonEnabled) {
          assert.isTrue(err.includes("verifier rejected in local view call to 'relayCall()' : view call to 'relayCall' reverted in verifier"))
          assert.isTrue(err.includes('revertPreRelayCall: Reverting'))
        }
        return
      }

      assert.fail('It should have thrown an exception')
    })

    it('should fail to send transaction if verifier fails in local execution', async function () {
      await verifierInstance.setReturnInvalidErrorCode(true)
      await verifierInstance.setRevertPreRelayCall(false)
      await verifierInstance.setOverspendAcceptGas(false)

      try {
        await testRecipient.emitMessage('hello again', {
          from: gaslessAccount.address,
          gas: '100000',
          gasPrice: '1',
          callVerifier: verifierInstance.address
        })
      } catch (error) {
        const err: string = String(error)
        if (revertReasonEnabled) {
          assert.isTrue(err.includes("verifier rejected in local view call to 'relayCall()' : view call to 'relayCall' reverted in verifier"))
          assert.isTrue(err.includes('invalid code'))
        }
        return
      }

      assert.fail('It should have thrown an exception')
    })

    it('should not modify relayed transactions receipt with successful internal transaction', function () {
      assert.equal(innerTxSucceedReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(innerTxSucceedReceipt)
      assert.equal(modifiedReceipt.status, true)
    })

    it('should not modify receipts for all other transactions ', function () {
      assert.equal(notRelayedTxReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(notRelayedTxReceipt)
      assert.equal(modifiedReceipt.status, true)
    })
  })

  describe('_getAccounts', function () {
    it('should append ephemeral accounts to the ones from the underlying provider', async function () {
      const relayProvider = new RelayProvider(underlyingProvider, { logLevel: 5 })
      const web3 = new Web3(relayProvider)
      const accountsBefore = await web3.eth.getAccounts()
      const newAccount = relayProvider.newAccount()
      const address = '0x982a8cbe734cb8c29a6a7e02a3b0e4512148f6f9'
      relayProvider.addAccount({
        privateKey: Buffer.from('d353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c', 'hex'),
        address
      })
      const accountsAfter = await web3.eth.getAccounts()
      const newAccounts = accountsAfter.filter(value => !accountsBefore.includes(value)).map(it => it.toLowerCase())
      assert.equal(newAccounts.length, 2)
      assert.include(newAccounts, address)
      assert.include(newAccounts, newAccount.address)
    })
  })

  describe('new contract deployment', function () {
    let TestRecipient: TestRecipientContract
    before(async function () {
      TestRecipient = artifacts.require('TestRecipient')

      const gsnConfig = configureGSN({
        logLevel: 5,
        relayHubAddress: relayHub.address,
        chainId: (await getTestingEnvironment()).chainId
      })
      gsnConfig.forwarderAddress = smartWallet.address

      let websocketProvider: WebsocketProvider

      if (isRsk(await getTestingEnvironment())) {
        websocketProvider = new Web3.providers.WebsocketProvider('ws://localhost:4445/websocket')
      } else {
        websocketProvider = new Web3.providers.WebsocketProvider(underlyingProvider.host)
      }

      relayProvider = new RelayProvider(websocketProvider as any, gsnConfig)
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
    })

    it('should throw on calling .new without useGSN: false', async function () {
      await expect(TestRecipient.new()).to.be.eventually.rejectedWith('GSN cannot relay contract deployment transactions. Add {from: accountWithEther, useGSN: false}.')
    })

    it('should deploy a contract without GSN on calling .new with useGSN: false', async function () {
      const testRecipient = await TestRecipient.new({
        from: accounts[0],
        useGSN: false
      })
      const receipt = await web3.eth.getTransactionReceipt(testRecipient.transactionHash)
      assert.equal(receipt.from.toLowerCase(), accounts[0].toLowerCase())
    })
  })
})

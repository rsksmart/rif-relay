import { TestEnvironment, TestEnvironmentInfo } from '../src/relayclient/TestEnvironment'
import { HttpProvider } from 'web3-core'
import { expectEvent } from '@openzeppelin/test-helpers'
import { TestRecipientInstance, ProxyFactoryInstance, TestTokenInstance } from '../types/truffle-contracts'
import { getTestingEnvironment, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'
import { toHex } from 'web3-utils'

const TestRecipient = artifacts.require('TestRecipient')
const ProxyFactory = artifacts.require('ProxyFactory')
const DeployVerifier = artifacts.require('DeployVerifier')
const RelayVerifier = artifacts.require('RelayVerifier')
const TestToken = artifacts.require('TestToken')

contract('TestEnvironment', function (accounts) {
  describe('#start()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await TestEnvironment.start(host, 0.6e18, await getTestingEnvironment())
      assert.equal(testEnv.deploymentResult.relayHubAddress.length, 42)
    })

    after(async function () {
      await TestEnvironment.stop()
    })
  })

  describe('using RelayClient', () => {
    let testEnvironment: TestEnvironmentInfo
    let tToken: TestTokenInstance
    before(async () => {
      const host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
      tToken = await TestToken.new()
      testEnvironment = await TestEnvironment.start(host, 0.6e18, await getTestingEnvironment())
      const dVerifier = await DeployVerifier.at(testEnvironment.deploymentResult.deployVerifierAddress)
      await dVerifier.acceptToken(tToken.address, { from: accounts[0] })
      const rVerifier = await RelayVerifier.at(testEnvironment.deploymentResult.relayVerifierAddress)
      await rVerifier.acceptToken(tToken.address, { from: accounts[0] })
    })

    after(async () => {
      await TestEnvironment.stop()
    })

    it('should relay using relayTransaction', async () => {
      const sender = await getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      const sr: TestRecipientInstance = await TestRecipient.new()

      testEnvironment.relayProvider.relayClient.accountManager.addAccount(sender)

      await testEnvironment.relayProvider.deploySmartWallet({
        from: sender.address,
        to: constants.ZERO_ADDRESS,
        value: '0',
        gas: toHex('400000'),
        data: '0x',
        tokenContract: tToken.address,
        tokenAmount: '0',
        tokenGas: '0',
        recoverer: constants.ZERO_ADDRESS,
        index: '0',
        callForwarder: testEnvironment.deploymentResult.factoryAddress,
        callVerifier: testEnvironment.deploymentResult.deployVerifierAddress,
        clientId: '1'
      })

      const wallet = await proxyFactory.getSmartWalletAddress(sender.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.SHA3_NULL_S, '0')
      const ret = await testEnvironment.relayProvider.relayClient.relayTransaction({
        from: sender.address,
        to: sr.address,
        callForwarder: wallet,
        callVerifier: testEnvironment.deploymentResult.relayVerifierAddress,
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI(),
        tokenAmount: '0x00',
        tokenGas: '0',
        tokenContract: tToken.address,
        isSmartWalletDeploy: false,
        clientId: '1',
        relayHub: testEnvironment.deploymentResult.relayHubAddress
      })

      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.msgSender.toLowerCase(), wallet.toLowerCase())
    })
  })

  describe('using RelayProvider', () => {
    let testEnvironment: TestEnvironmentInfo
    let tToken: TestTokenInstance
    before(async function () {
      const host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
      testEnvironment = await TestEnvironment.start(host, 0.6e18, await getTestingEnvironment())
      tToken = await TestToken.new()
      const dVerifier = await DeployVerifier.at(testEnvironment.deploymentResult.deployVerifierAddress)
      await dVerifier.acceptToken(tToken.address, { from: accounts[0] })
      const rVerifier = await RelayVerifier.at(testEnvironment.deploymentResult.relayVerifierAddress)
      await rVerifier.acceptToken(tToken.address, { from: accounts[0] })
    })

    after(async () => {
      await TestEnvironment.stop()
    })

    it('should send relayed transaction through RelayProvider', async () => {
      const sender = await getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      testEnvironment.relayProvider.addAccount(sender)

      const sr: TestRecipientInstance = await TestRecipient.new()
      await testEnvironment.relayProvider.deploySmartWallet({
        from: sender.address,
        to: constants.ZERO_ADDRESS,
        value: '0',
        gas: toHex('400000'),
        data: '0x',
        tokenContract: tToken.address,
        tokenAmount: '0',
        tokenGas: '0',
        recoverer: constants.ZERO_ADDRESS,
        index: '0',
        callForwarder: proxyFactory.address,
        callVerifier: testEnvironment.deploymentResult.deployVerifierAddress,
        clientId: '1'
      })

      const wallet = await proxyFactory.getSmartWalletAddress(sender.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.SHA3_NULL_S, '0')

      // @ts-ignore
      TestRecipient.web3.setProvider(testEnvironment.relayProvider)

      const txDetails = {
        from: sender.address,
        callVerifier: testEnvironment.deploymentResult.relayVerifierAddress,
        callForwarder: wallet,
        tokenContract: tToken.address
      }
      const ret = await sr.emitMessage('hello', txDetails)
      expectEvent(ret, 'SampleRecipientEmitted', { msgSender: wallet })
    })
  })
})

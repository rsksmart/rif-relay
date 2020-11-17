import { GsnTestEnvironment, TestEnvironment } from '../src/relayclient/GsnTestEnvironment'
import { HttpProvider } from 'web3-core'
import { expectEvent } from '@openzeppelin/test-helpers'
import { TestRecipientInstance, ProxyFactoryInstance } from '../types/truffle-contracts'
import { getTestingEnvironment, createSmartWallet, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'

const TestRecipient = artifacts.require('TestRecipient')
const ProxyFactory = artifacts.require('ProxyFactory')

contract('GsnTestEnvironment', function () {
  describe('#startGsn()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await GsnTestEnvironment.startGsn(host, await getTestingEnvironment())
      assert.equal(testEnv.deploymentResult.relayHubAddress.length, 42)
    })

    after(async function () {
      await GsnTestEnvironment.stopGsn()
    })
  })

  describe('using RelayClient', () => {
    let testEnvironment: TestEnvironment

    before(async () => {
      const host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
      testEnvironment = await GsnTestEnvironment.startGsn(host, await getTestingEnvironment())
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should relay using relayTransaction', async () => {
      const sender = getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      const sr: TestRecipientInstance = await TestRecipient.new()

      const wallet = await createSmartWallet(sender.address, proxyFactory, sender.privateKey, (await getTestingEnvironment()).chainId)
      testEnvironment.relayProvider.relayClient.accountManager.addAccount(sender)

      const ret = await testEnvironment.relayProvider.relayClient.relayTransaction({
        from: sender.address,
        to: sr.address,
        forwarder: wallet.address,
        paymaster: testEnvironment.deploymentResult.naivePaymasterAddress,
        paymasterData: '0x',
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI(),
        tokenRecipient: constants.ZERO_ADDRESS,
        tokenAmount: '0x00',
        tokenContract: constants.ZERO_ADDRESS,
        factory: constants.ZERO_ADDRESS,
        clientId: '1'
      })

      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.msgSender.toLocaleLowerCase(), wallet.address.toLocaleLowerCase())
    })
  })

  describe('using RelayProvider', () => {
    let testEnvironment: TestEnvironment

    before(async function () {
      const host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
      testEnvironment = await GsnTestEnvironment.startGsn(host, await getTestingEnvironment())
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should send relayed transaction through RelayProvider', async () => {
      const sender = getGaslessAccount()
      const proxyFactory: ProxyFactoryInstance = await ProxyFactory.at(testEnvironment.deploymentResult.factoryAddress)
      const sr: TestRecipientInstance = await TestRecipient.new()

      const wallet = await createSmartWallet(sender.address, proxyFactory, sender.privateKey, (await getTestingEnvironment()).chainId)
      testEnvironment.relayProvider.addAccount(sender)

      // @ts-ignore
      TestRecipient.web3.setProvider(testEnvironment.relayProvider)

      const txDetails = {
        from: sender.address,
        paymaster: testEnvironment.deploymentResult.naivePaymasterAddress,
        forwarder: wallet.address
      }
      const ret = await sr.emitMessage('hello', txDetails)
      expectEvent(ret, 'SampleRecipientEmitted', { msgSender: wallet.address })
    })
  })
})

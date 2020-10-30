import { GsnTestEnvironment, TestEnvironment } from '../src/relayclient/GsnTestEnvironment'
import { HttpProvider } from 'web3-core'
import { RelayClient } from '../src/relayclient/RelayClient'
import { expectEvent } from '@openzeppelin/test-helpers'
import { TestRecipientInstance, SmartWalletInstance, ProxyFactoryInstance, IForwarderInstance } from '../types/truffle-contracts'
import { getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount } from './TestUtils'
import { Environment } from '../src/common/Environments'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'

const TestRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')

contract('GsnTestEnvironment', function () {
  let host: string
  let forwarder: IForwarderInstance
  let env: Environment
  let sender: AccountKeypair

  before(async function () {
    host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
    const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
    sender = await getGaslessAccount()

    env = await getTestingEnvironment()
    forwarder = await createSmartWallet(sender.address, factory, env.chainId)
  })

  describe('#startGsn()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await GsnTestEnvironment.startGsn(host, env)
      assert.equal(testEnv.deploymentResult.relayHubAddress.length, 42)
    })

    after(async function () {
      await GsnTestEnvironment.stopGsn()
    })
  })

  context('using RelayClient', () => {
    let sr: TestRecipientInstance
    let testEnvironment: TestEnvironment
    let relayClient: RelayClient
    before(async () => {
      testEnvironment = await GsnTestEnvironment.startGsn(host, env)
      relayClient = testEnvironment.relayProvider.relayClient
      relayClient.accountManager.addAccount(sender)

      sr = await TestRecipient.new()
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should relay using relayTransaction', async () => {
      const ret = await relayClient.relayTransaction({
        from: sender.address,
        to: sr.address,
        forwarder: forwarder.address,
        paymaster: testEnvironment.deploymentResult.naivePaymasterAddress,
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI(),
        tokenRecipient: constants.ZERO_ADDRESS,
        tokenAmount: '0x00',
        tokenContract: constants.ZERO_ADDRESS,
        factory: constants.ZERO_ADDRESS
      })
      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.msgSender.toLocaleLowerCase(), forwarder.address.toLocaleLowerCase())
    })
  })

  context('using RelayProvider', () => {
    let sr: TestRecipientInstance
    let testEnvironment: TestEnvironment
    before(async function () {
      testEnvironment = await GsnTestEnvironment.startGsn(host, env)
      sr = await TestRecipient.new()

      // @ts-ignore
      TestRecipient.web3.setProvider(testEnvironment.relayProvider)
      testEnvironment.relayProvider.addAccount(sender)
    })
    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should send relayed transaction through RelayProvider', async () => {
      const txDetails = {
        from: sender.address,
        paymaster: testEnvironment.deploymentResult.naivePaymasterAddress,
        forwarder: forwarder.address
      }
      const ret = await sr.emitMessage('hello', txDetails)

      expectEvent(ret, 'SampleRecipientEmitted', { msgSender: forwarder.address })
    })
  })
})

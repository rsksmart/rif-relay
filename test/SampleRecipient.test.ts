import {
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance,
  SmartWalletInstance,
  ProxyFactoryInstance
} from '../types/truffle-contracts'
import BN from 'bn.js'
import { deployHub, createProxyFactory, createSmartWallet, getTestingEnvironment } from './TestUtils'

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const SmartWallet = artifacts.require('SmartWallet')

contract('SampleRecipient', function (accounts) {
  const expectedRealSender = accounts[0]
  const message = 'hello world'
  let sample: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance

  before(async function () {
    const env = await getTestingEnvironment()
    const chainId = env.chainId
    const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
    await createSmartWallet(expectedRealSender, factory, chainId)

    sample = await TestRecipient.new()
    paymaster = await TestPaymasterEverythingAccepted.new()
  })

  it('should emit message with msgSender and Origin', async function () {
    const result = await sample.emitMessage(message)
    const log = result.logs[0]
    const args = log.args
    assert.equal('SampleRecipientEmitted', log.event)
    assert.equal(args.message, message)
    assert.equal(expectedRealSender, args.msgSender, 'In this test, msgSender is the caller, since there is no relay involved')
    assert.equal(expectedRealSender, args.origin, 'tx.origin must be also the caller, since the test is not using a relayer')
  })

  // TODO: this test is in a wrong file
  it('should allow owner to withdraw balance from RelayHub', async function () {
    const deposit = new BN('100000000000000000')
    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    const rhub = await deployHub(stakeManager.address, penalizer.address)
    await paymaster.setRelayHub(rhub.address)

    // transfer eth into paymaster (using the normal "transfer" helper, which internally
    // uses hub.depositFor)
    await web3.eth.sendTransaction({
      from: expectedRealSender,
      to: paymaster.address,
      value: deposit
    })

    let depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal(deposit.toString(), depositActual.toString())
    const a0BalanceBefore = await web3.eth.getBalance(expectedRealSender)
    const gasPrice = 1
    const owner = await paymaster.owner()
    const res = await paymaster.withdrawRelayHubDepositTo(depositActual, owner, {
      from: owner,
      gasPrice: gasPrice
    })
    const a0BalanceAfter = await web3.eth.getBalance(expectedRealSender)
    const expectedBalanceAfter = new BN(a0BalanceBefore).add(deposit).subn(res.receipt.gasUsed * gasPrice)
    assert.equal(expectedBalanceAfter.toString(), a0BalanceAfter.toString())
    depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal('0', depositActual.toString())
  })
})

import {
  TestRecipientInstance,
  SmartWalletInstance,
  SmartWalletFactoryInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts'
import { createSmartWalletFactory, createSmartWallet, getTestingEnvironment, getGaslessAccount } from './TestUtils'
import { AccountKeypair } from '@rsksmart/rif-relay-client'

const TestRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')

contract('SampleRecipient', function (accounts) {
  const expectedRealSender = accounts[0]
  const message = 'hello world'
  let sample: TestRecipientInstance
  let gaslessAccount: AccountKeypair

  before(async function () {
    gaslessAccount = await getGaslessAccount()
    const env = await getTestingEnvironment()
    const chainId = env.chainId
    const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const factory: SmartWalletFactoryInstance = await createSmartWalletFactory(sWalletTemplate)
    await createSmartWallet(accounts[0], gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)

    sample = await TestRecipient.new()
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
})

import { ether, expectRevert } from '@openzeppelin/test-helpers'

import {
  PenalizerInstance,
  RelayHubInstance,
  SmartWalletInstance,
  TestRecipientInstance,
  TestTokenInstance
} from '../../types/truffle-contracts'

import { createSmartWallet, createSmartWalletFactory, deployHub, getGaslessAccount, getTestingEnvironment } from '../TestUtils'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { zeroAddress } from 'ethereumjs-util'
import { createRawTx, fundAccount, RelayHelper } from './Utils'
import { fail } from 'assert'
import { toBN } from 'web3-utils'
import { TransactionReceipt } from 'web3-core'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'

const Penalizer = artifacts.require('Penalizer')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const testToken = artifacts.require('TestToken')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')

contract('Penalizer', function ([relayOwner, relayWorker, relayManager, otherAccount, fundedAccount]) {
  // contracts
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let forwarder: SmartWalletInstance
  let token: TestTokenInstance

  let sender: AccountKeypair // wallet owner and relay request origin

  let relayHelper: RelayHelper

  const gasPrice = '1'
  const txGas = 4e6
  let chainId: number

  before(async function () {
    const env = await getTestingEnvironment()
    chainId = env.chainId

    // set up contracts
    penalizer = await Penalizer.new()
    relayHub = await deployHub(penalizer.address)
    recipient = await TestRecipient.new()
    const verifier = await TestVerifierEverythingAccepted.new()
    const smartWalletTemplate = await SmartWallet.new()
    token = await testToken.new()

    sender = await getGaslessAccount() // sender should be able to relay without funds

    // smart wallet
    const factory = await createSmartWalletFactory(smartWalletTemplate)
    forwarder = await createSmartWallet(relayOwner, sender.address, factory, sender.privateKey, env.chainId)

    // relay helper class
    relayHelper = new RelayHelper(relayHub, relayOwner, relayWorker, relayManager, forwarder, verifier, token, env.chainId)
    await relayHelper.init()
  })

  describe('should be able to have its hub set', function () {
    it('starting out with an unset address', async function () {
      assert.equal(await penalizer.getHub(), zeroAddress(), 'penalizer hub does not match zero address')
    })

    it('successfully from its owner address', async function () {
      await penalizer.setHub(relayHub.address, { from: await penalizer.owner() })

      assert.equal(await penalizer.getHub(), relayHub.address, 'penalizer hub does not match relay hub')
    })

    it('unsuccessfully from another address', async function () {
      await expectRevert(
        penalizer.setHub(otherAccount, { from: otherAccount }),
        'caller is not the owner'
      )

      // hub should remain set with its previous value
      assert.equal(await penalizer.getHub(), relayHub.address, 'penalizer hub did not keep its relay hub value')
    })
  })

  describe('should fulfill transactions', function () {
    it('unsuccessfully if qos is disabled', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef01', enableQos: false })

      await relayHub.relayCall(rr, sig, {
        from: relayWorker,
        gas: txGas,
        gasPrice: gasPrice
      })

      assert.isFalse(await penalizer.fulfilled(sig), 'tx relayed without qos is fulfilled')
    })

    it('successfully if qos is enabled', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef02', enableQos: true })

      await relayHub.relayCall(rr, sig, {
        from: relayWorker,
        gas: txGas,
        gasPrice: gasPrice
      })

      assert.isTrue(await penalizer.fulfilled(sig), 'tx relayed with qos is not fulfilled')
    })
  })

  describe('should reject claims', function () {
    it('due to hub not being set', async function () {
      const hublessPenalizer = await Penalizer.new()

      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef03' })
      const receipt = relayHelper.createReceipt(rr, sig)

      await expectRevert(
        hublessPenalizer.claim(receipt),
        'relay hub not set'
      )
    })

    it('due to receiving a commitment with qos disabled', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef04', enableQos: false })
      const receipt = relayHelper.createReceipt(rr, sig)

      await expectRevert(
        penalizer.claim(receipt),
        'commitment without QoS'
      )
    })

    it('due to missing signature', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef05', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)

      await expectRevert(
        penalizer.claim(receipt),
        'worker signature mismatch'
      )
    })

    it('due to forged signature', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef06', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)
      receipt.workerSignature = web3.utils.randomHex(130)

      await expectRevert(
        penalizer.claim(receipt),
        'worker signature mismatch'
      )
    })

    it('due to worker address mismatch', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef07', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)
      receipt.commitment.relayWorker = otherAccount // tamper with receipt worker
      await relayHelper.signReceipt(receipt)

      await expectRevert(
        penalizer.claim(receipt),
        'worker address does not match'
      )
    })

    it('due to relay hub mismatch', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef07', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)
      receipt.commitment.relayHubAddress = otherAccount // tamper with receipt hub
      await relayHelper.signReceipt(receipt)

      await expectRevert(
        penalizer.claim(receipt),
        'relay hub does not match'
      )
    })

    it('due to claim not being made by commitment receiver', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef08', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)
      await relayHelper.signReceipt(receipt)

      await expectRevert(
        penalizer.claim(receipt, { from: otherAccount }),
        'receiver must claim commitment'
      )
    })
  })

  describe('should receive claims', function () {
    before(async function () {
      // sender will need to be funded to complete claim calls
      await fundAccount(fundedAccount, sender.address, '10')
    })

    // from this point onwards txs must be put together manually since the sender account is locked

    it('and reject them if tx is fulfilled', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef09', enableQos: true })

      // if tx is successfully relayed, it will be marked as fulfilled
      await relayHub.relayCall(rr, sig, {
        from: relayWorker,
        gas: txGas,
        gasPrice: gasPrice
      })

      const receipt = relayHelper.createReceipt(rr, sig)
      await relayHelper.signReceipt(receipt)

      const rawTx = await createRawTx(
        sender,
        penalizer.address,
        penalizer.contract.methods.claim(receipt).encodeABI(),
        txGas.toString(),
        gasPrice,
        chainId
      )

      try {
        await web3.eth.sendSignedTransaction(rawTx)
        fail("expected claim to fail, but it didn't")
      } catch (err) {
        assert.isTrue(err.message.includes("can't penalize fulfilled tx"), 'unexpected revert reason')
      }
    })

    it('and accept them if tx is unfulfilled and unpenalized', async function () {
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef10', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)
      await relayHelper.signReceipt(receipt)

      // in this case, the worker signed a commitment without relaying the corresponding tx first
      // this means a claim would be valid, and penalization should take place
      const rawTx = await createRawTx(
        sender,
        penalizer.address,
        penalizer.contract.methods.claim(receipt).encodeABI(),
        txGas.toString(),
        gasPrice,
        chainId
      )

      await assertClaimIsSuccessful(relayHub, relayManager, sender, rawTx)
    })

    it('and reject them if tx is unfulfilled but penalized', async function () {
      // same as previous test case
      const [rr, sig] = await createRelayRequestAndSignature({ relayData: '0xdeadbeef10', enableQos: true })
      const receipt = relayHelper.createReceipt(rr, sig)
      await relayHelper.signReceipt(receipt)

      // attempt to repeat previously successful claim
      // a claim would be invalid here since tx has already been penalized
      const rawTx = await createRawTx(
        sender,
        penalizer.address,
        penalizer.contract.methods.claim(receipt).encodeABI(),
        txGas.toString(),
        gasPrice,
        chainId
      )

      try {
        await web3.eth.sendSignedTransaction(rawTx)
        fail("expected claim to fail, but it didn't")
      } catch (err) {
        assert.isTrue(err.message.includes('tx already penalized'), 'unexpected revert reason')
      }
    })
  })

  describe('should receive/reject claims according with the commitment time', function () {
    before(async function () {
      await penalizer.setHub(relayHub.address, { from: await penalizer.owner() })
    })
    beforeEach(async () => {
      await token.mint('1000', forwarder.address)

      await relayHub.stakeForAddress(relayManager, 1000, {
        from: relayOwner,
        value: ether('1'),
        gasPrice: gasPrice
      })
      await fundAccount(fundedAccount, sender.address, '10')
    })

    // successful claims
    const acceptableCommitmentTimes = [
      // due to security implications, we accept a up to 15 secs of delay
      // but we cannot set exactly this time in tests
      10,
      0,
      // set a past commitment time
      -100,
      -150
    ]
    acceptableCommitmentTimes.forEach((timeDiff, index) => {
      it(`accept them if commit time is ${Math.abs(timeDiff)} seconds in ${timeDiff < 0 ? 'past' : 'future'}`, async function () {
        const [rr, sig] = await createRelayRequestAndSignature({ relayData: `0xdeadbeff1${index}`, enableQos: true })
        const now = getSecondsSinceUnixEpoch()
        const receiptTime = now + timeDiff
        const receipt = relayHelper.createReceipt(rr, sig, receiptTime)
        await relayHelper.signReceipt(receipt)

        const rawTx = await createRawTx(
          sender,
          penalizer.address,
          penalizer.contract.methods.claim(receipt).encodeABI(),
          txGas.toString(),
          gasPrice,
          chainId
        )
        await assertClaimIsSuccessful(relayHub, relayManager, sender, rawTx)
      })
    })

    // commitment time not yet expired, unsuccessful claims
    const futureReceiptTime = [
      50,
      150,
      250,
      350
    ]
    futureReceiptTime.forEach((timeDiff, index) => {
      it(`reject them if commit time is  ${timeDiff} seconds in future`, async function () {
        const [rr, sig] = await createRelayRequestAndSignature({ relayData: `0xdeadbfef1${index}`, enableQos: true })
        const now = getSecondsSinceUnixEpoch()
        const receipt = relayHelper.createReceipt(rr, sig, now + timeDiff)
        await relayHelper.signReceipt(receipt)

        const rawTx = await createRawTx(
          sender,
          penalizer.address,
          penalizer.contract.methods.claim(receipt).encodeABI(),
          txGas.toString(),
          gasPrice,
          chainId
        )

        await assertTransactionFails(rawTx, 'too early to claim')
      })
    })
  })

  interface RelayRequestParams{
    relayData: string
    enableQos?: boolean
  }

  async function createRelayRequestAndSignature (params: RelayRequestParams): Promise<[RelayRequest, string]> {
    const rr = await relayHelper.createRelayRequest({
      from: sender.address,
      to: recipient.address,
      relayData: params.relayData,
      enableQos: params.enableQos ?? false
    })
    const sig = relayHelper.getRelayRequestSignature(rr, sender)

    return [rr, sig]
  }
})


function getSecondsSinceUnixEpoch (): number {
  return Math.floor(Date.now() / 1000)
}

async function assertTransactionFails (rawTx: string, reason: string): Promise<void> {
  try {
    await web3.eth.sendSignedTransaction(rawTx)
    fail("expected claim to fail, but it didn't")
  } catch (err) {
    assert.isTrue(err.message.includes(reason), `unexpected revert reason: ${err.message}`)
  }
}

async function assertClaimIsSuccessful (relayHub: RelayHubInstance, relayManager: string, sender: AccountKeypair, rawTx: string): Promise<void> {
  let stakeInfo = await relayHub.getStakeInfo(relayManager)
  let stake = toBN(stakeInfo.stake)
  const balanceBefore = toBN(await web3.eth.getBalance(sender.address))
  const toBurn = stake.div(toBN(2))
  const reward = stake.sub(toBurn)

  let txReceipt: TransactionReceipt
  try {
    txReceipt = await web3.eth.sendSignedTransaction(rawTx)
  } catch (err) {
    fail(err)
  }

  stakeInfo = await relayHub.getStakeInfo(relayManager)
  stake = toBN(stakeInfo.stake)

  const balanceAfter = toBN(await web3.eth.getBalance(sender.address))
  const gasUsed = toBN(txReceipt.gasUsed)

  assert.isTrue(stake.eq(toBN(0)), 'stake was not burned')
  assert.isTrue(balanceAfter.eq(balanceBefore.add(reward).sub(gasUsed)), 'unexpected beneficiary balance after claim')
}

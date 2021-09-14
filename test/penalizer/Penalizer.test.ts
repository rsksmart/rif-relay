import { expectRevert } from '@openzeppelin/test-helpers'

import {
  PenalizerInstance,
  RelayHubInstance,
  TestRecipientInstance
} from '../../types/truffle-contracts'

import { createSmartWallet, createSmartWalletFactory, deployHub, getGaslessAccount, getTestingEnvironment } from '../TestUtils'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { zeroAddress } from 'ethereumjs-util'
import { RelayHelper } from './Utils'

const Penalizer = artifacts.require('Penalizer')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const testToken = artifacts.require('TestToken')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')

contract('Penalizer', function ([relayOwner, relayWorker, relayManager, other]) {
  // contracts
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance

  // sender and receiver
  let gaslessAccount: AccountKeypair
  let target: string

  let relayHelper: RelayHelper

  const gasPrice = '1'
  const relayGas = 4e6

  before(async function () {
    const env = await getTestingEnvironment()

    // set up contracts
    penalizer = await Penalizer.new()
    relayHub = await deployHub(penalizer.address)
    recipient = await TestRecipient.new()

    const verifier = await TestVerifierEverythingAccepted.new()
    const smartWalletTemplate = await SmartWallet.new()
    const token = await testToken.new()

    // accounts
    gaslessAccount = await getGaslessAccount()
    target = recipient.address

    // smart wallet
    const factory = await createSmartWalletFactory(smartWalletTemplate)
    const forwarder = await createSmartWallet(relayOwner, gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)

    // relay helper class
    relayHelper = new RelayHelper(relayHub, relayOwner, relayWorker, relayManager, forwarder, verifier, token, env.chainId)
    await relayHelper.init()
  })

  describe('should be able to have its hub set', function () {
    it('starting out with an unset address', async function () {
      assert.equal(await penalizer.getHub(), zeroAddress())
    })

    it('successfully from its owner address', async function () {
      await penalizer.setHub(relayHub.address, { from: await penalizer.owner() })

      assert.equal(await penalizer.getHub(), relayHub.address)
    })

    it('unsuccessfully from another address', async function () {
      await expectRevert(
        penalizer.setHub(other, { from: other }),
        'caller is not the owner'
      )

      // hub should remain set with its previous value
      assert.equal(await penalizer.getHub(), relayHub.address)
    })
  })

  describe('should fulfill transactions', function () {
    it('unsuccessfully if qos is disabled', async function () {
      const relayRequest = await relayHelper.createRelayRequest(gaslessAccount.address, target, '0xdeadbeef01')
      const signature = relayHelper.getRelayRequestSignature(relayRequest, gaslessAccount)

      await relayHub.relayCall(relayRequest, signature, {
        from: relayWorker,
        gas: relayGas,
        gasPrice: gasPrice
      })

      assert.isFalse(await penalizer.fulfilled(signature))
    })

    it('successfully if qos is enabled', async function () {
      const relayRequest = await relayHelper.createRelayRequest(gaslessAccount.address, target, '0xdeadbeef02')
      relayRequest.request.enableQos = true
      const signature = relayHelper.getRelayRequestSignature(relayRequest, gaslessAccount)

      await relayHub.relayCall(relayRequest, signature, {
        from: relayWorker,
        gas: relayGas,
        gasPrice: gasPrice
      })

      assert.isTrue(await penalizer.fulfilled(signature))
    })
  })

  describe('should be able to reject claims', function () {
    it('due to hub not being set', async function () {
      const hublessPenalizer = await Penalizer.new()
      const receipt = relayHelper.createCommitmentReceipt()
      await expectRevert(
        hublessPenalizer.claim(receipt),
        'relay hub not set'
      )
    })

    it('due to receiving a commitment with qos disabled', async function () {
      const receipt = relayHelper.createCommitmentReceipt()
      await expectRevert(
        penalizer.claim(receipt),
        'commitment without QoS'
      )
    })

    it.skip('wip', async function () {
      const receipt = relayHelper.createCommitmentReceipt()
      receipt.commitment.enableQos = true
      await penalizer.claim(receipt)
    })
  })
})

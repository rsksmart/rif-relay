import { expectRevert } from '@openzeppelin/test-helpers'

import {
  PenalizerInstance,
  RelayHubInstance,
  TestRecipientInstance
} from '../../types/truffle-contracts'

import { createSmartWallet, createSmartWalletFactory, deployHub, getGaslessAccount, getTestingEnvironment } from '../TestUtils'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { zeroAddress } from 'ethereumjs-util'
import { createRawTx, fundAccount, RelayHelper } from './Utils'
import { fail } from 'assert'
// import ContractInteractor from '../../src/common/ContractInteractor'
// import { configure } from '../../src/relayclient/Configurator'
// import { HttpProvider } from 'web3-core'
// import { ProfilingProvider } from '../../src/common/dev/ProfilingProvider'

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

  let sender: AccountKeypair // wallet owner and relay request origin

  let relayHelper: RelayHelper

  const gasPrice = '1'
  const txGas = 4e6

  before(async function () {
    const env = await getTestingEnvironment()

    // set up contracts
    penalizer = await Penalizer.new()
    relayHub = await deployHub(penalizer.address)
    recipient = await TestRecipient.new()
    const verifier = await TestVerifierEverythingAccepted.new()
    const smartWalletTemplate = await SmartWallet.new()
    const token = await testToken.new()

    sender = await getGaslessAccount() // relay request origin should have no funds

    // smart wallet
    const factory = await createSmartWalletFactory(smartWalletTemplate)
    const forwarder = await createSmartWallet(relayOwner, sender.address, factory, sender.privateKey, env.chainId)

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
        penalizer.setHub(otherAccount, { from: otherAccount }),
        'caller is not the owner'
      )

      // hub should remain set with its previous value
      assert.equal(await penalizer.getHub(), relayHub.address)
    })
  })

  describe('should fulfill transactions', function () {
    it('unsuccessfully if qos is disabled', async function () {
      const relayRequest = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef01', enableQos: false })
      const signature = relayHelper.getRelayRequestSignature(relayRequest, sender)

      await relayHub.relayCall(relayRequest, signature, {
        from: relayWorker,
        gas: txGas,
        gasPrice: gasPrice
      })

      assert.isFalse(await penalizer.fulfilled(signature))
    })

    it('successfully if qos is enabled', async function () {
      const relayRequest = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef02', enableQos: true })
      const signature = relayHelper.getRelayRequestSignature(relayRequest, sender)

      await relayHub.relayCall(relayRequest, signature, {
        from: relayWorker,
        gas: txGas,
        gasPrice: gasPrice
      })

      assert.isTrue(await penalizer.fulfilled(signature))
    })
  })

  describe('should be able to reject claims', function () {
    it('due to hub not being set', async function () {
      const hublessPenalizer = await Penalizer.new()

      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef03' })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })

      await expectRevert(
        hublessPenalizer.claim(receipt),
        'relay hub not set'
      )
    })

    it('due to receiving a commitment with qos disabled', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef04', enableQos: false })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })

      await expectRevert(
        penalizer.claim(receipt),
        'commitment without QoS'
      )
    })

    it('due to missing signature', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef05', enableQos: true })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })

      await expectRevert(
        penalizer.claim(receipt),
        'worker signature mismatch'
      )
    })

    it('due to forged signature', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef06', enableQos: true })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })

      receipt.workerSignature = web3.utils.randomHex(130)

      await expectRevert(
        penalizer.claim(receipt),
        'worker signature mismatch'
      )
    })

    it('due to worker address mismatch', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef07', enableQos: true })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })

      receipt.commitment.relayWorker = otherAccount

      await relayHelper.signReceipt(receipt)

      await expectRevert(
        penalizer.claim(receipt),
        'worker address does not match'
      )
    })

    it('due to relay hub mismatch', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef07', enableQos: true })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })

      receipt.commitment.relayHubAddress = otherAccount

      await relayHelper.signReceipt(receipt)

      await expectRevert(
        penalizer.claim(receipt),
        'relay hub does not match'
      )
    })

    it('due to claim not being made by commitment receiver', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeef08', enableQos: true })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })
      await relayHelper.signReceipt(receipt)

      await expectRevert(
        penalizer.claim(receipt, { from: otherAccount }),
        'receiver must claim commitment'
      )
    })
  })

  describe('should be able to accept claims', function () {
    it('for unfulfilled, unpenalized transactions', async function () {
      const rr = await relayHelper.createRelayRequest({ from: sender.address, to: recipient.address, relayData: '0xdeadbeefff', enableQos: true })
      const receipt = relayHelper.createReceipt({ relayRequest: rr })
      await relayHelper.signReceipt(receipt)

      // sender will need to be funded to complete successful claim call
      await fundAccount(fundedAccount, sender.address, '10')

      // tx must be put together manually because sender account is locked
      const rawTx = createRawTx(sender, recipient.address, penalizer.contract.methods.claim(receipt).encodeABI(), txGas.toString(), gasPrice)

      try {
        // option 1:
        // const receipt = await web3.eth.sendSignedTransaction(rawTx)

        // option 2:
        // const provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
        // const contractInteractor = new ContractInteractor(provider, configure({}))
        // const receipt = await contractInteractor.broadcastTransaction(rawTx)

        // both result in: transaction wasn't mined
      } catch (err) {
        fail(err)
      }
    })
  })
})

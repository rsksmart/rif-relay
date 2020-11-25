import { balance, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'
import chai from 'chai'

import { decodeRevertReason, getLocalEip712Signature, removeHexPrefix } from '../src/common/Utils'
import RelayRequest, { cloneRelayRequest } from '../src/common/EIP712/RelayRequest'
import { isRsk, Environment } from '../src/common/Environments'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'

import {
  RelayHubInstance,
  PenalizerInstance,
  StakeManagerInstance,
  TestRecipientInstance,
  IForwarderInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  SmartWalletInstance,
  ProxyFactoryInstance,
  TestTokenRecipientInstance
} from '../types/truffle-contracts'
import { deployHub, encodeRevertReason, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount } from './TestUtils'

import chaiAsPromised from 'chai-as-promised'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { keccak } from 'ethereumjs-util'
const { expect, assert } = chai.use(chaiAsPromised)
const StakeManager = artifacts.require('StakeManager')
const SmartWallet = artifacts.require('SmartWallet')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')
const TestTokenRecipient = artifacts.require('TestTokenRecipient')
const TestPaymasterStoreContext = artifacts.require('TestPaymasterStoreContext')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

contract('RelayHub', function ([_, relayOwner, relayManager, relayWorker, senderAddress, other, dest, incorrectWorker]) { // eslint-disable-line no-unused-vars
  const RelayCallStatusCodes = {
    OK: new BN('0'),
    RelayedCallFailed: new BN('1'),
    RejectedByPreRelayed: new BN('2'),
    RejectedByForwarder: new BN('3'),
    RejectedByRecipientRevert: new BN('4'),
    PostRelayedFailed: new BN('5'),
    PaymasterBalanceChanged: new BN('6')
  }

  let chainId: number
  let relayHub: string
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let relayHubInstance: RelayHubInstance
  let recipientContract: TestRecipientInstance
  let testTokenRecipient: TestTokenRecipientInstance
  let paymasterContract: TestPaymasterEverythingAcceptedInstance
  let forwarderInstance: IForwarderInstance
  let target: string
  let paymaster: string
  let forwarder: string
  let gaslessAccount: AccountKeypair

  let env: Environment

  beforeEach(async function () {
    env = await getTestingEnvironment()
    chainId = env.chainId

    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    relayHubInstance = await deployHub(stakeManager.address, penalizer.address)
    paymasterContract = await TestPaymasterEverythingAccepted.new()

    gaslessAccount = await getGaslessAccount()

    const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
    forwarderInstance = await createSmartWallet(gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
    forwarder = forwarderInstance.address
    recipientContract = await TestRecipient.new()
    testTokenRecipient = await TestTokenRecipient.new()

    target = recipientContract.address
    paymaster = paymasterContract.address
    relayHub = relayHubInstance.address
    await paymasterContract.setRelayHub(relayHub)
  })

  it('should retrieve version number', async function () {
    const version = await relayHubInstance.versionHub()
    assert.match(version, /2\.\d*\.\d*-?.*\+opengsn\.hub\.irelayhub/)
  })
  describe('balances', function () {
    async function testDeposit (sender: string, paymaster: string, amount: BN): Promise<void> {
      const senderBalanceTracker = await balance.tracker(sender)
      const relayHubBalanceTracker = await balance.tracker(relayHub)

      // TODO review gas price for RSK
      const { logs } = await relayHubInstance.depositFor(paymaster, {
        from: sender,
        value: amount,
        gasPrice: 1
      })
      expectEvent.inLogs(logs, 'Deposited', {
        paymaster,
        from: sender,
        amount
      })

      expect(await relayHubInstance.balanceOf(paymaster)).to.be.bignumber.equal(amount)

      if (isRsk(env)) {
        expect(await senderBalanceTracker.delta()).to.be.bignumber.closeTo(amount.neg(), new BN(50_000))
      } else {
        expect(await senderBalanceTracker.delta()).to.be.bignumber.equal(amount.neg())
      }

      expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equal(amount)
    }

    it('can deposit for self', async function () {
      await testDeposit(other, other, ether('1'))
    })

    it('can deposit for others', async function () {
      await testDeposit(other, target, ether('1'))
    })

    // TODO review gasPrice for RSK
    it('cannot deposit amounts larger than the limit', async function () {
      await expectRevert.unspecified(
        relayHubInstance.depositFor(target, {
          from: other,
          value: ether('3'),
          gasPrice: 1
        }),
        'deposit too big'
      )
    })

    // TODO review gasPrice for RSK
    it('can deposit multiple times and have a total deposit larger than the limit', async function () {
      await relayHubInstance.depositFor(target, {
        from: other,
        value: ether('1'),
        gasPrice: 1
      })
      await relayHubInstance.depositFor(target, {
        from: other,
        value: ether('1'),
        gasPrice: 1
      })
      await relayHubInstance.depositFor(target, {
        from: other,
        value: ether('1'),
        gasPrice: 1
      })

      expect(await relayHubInstance.balanceOf(target)).to.be.bignumber.equals(ether('3'))
    })

    it('accounts with deposits can withdraw partially', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHubInstance.withdraw(amount.divn(2), dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', {
        account: other,
        dest,
        amount: amount.divn(2)
      })
    })

    it('accounts with deposits can withdraw all their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHubInstance.withdraw(amount, dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', {
        account: other,
        dest,
        amount
      })
    })

    it('accounts cannot withdraw more than their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      await expectRevert.unspecified(relayHubInstance.withdraw(amount.addn(1), dest, { from: other }), 'insufficient funds')
    })
  })

  describe('relayCall', function () {
    const baseRelayFee = '10000'
    const pctRelayFee = '10'
    const gasPrice = '10'
    const gasLimit = '1000000'
    const senderNonce = '0'
    let sharedRelayRequestData: RelayRequest
    const paymasterData = '0x'
    const clientId = '1'

    beforeEach(function () {
      sharedRelayRequestData = {
        request: {
          to: target,
          data: '',
          from: gaslessAccount.address,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          tokenRecipient: constants.ZERO_ADDRESS,
          tokenContract: constants.ZERO_ADDRESS,
          tokenAmount: '0',
          factory: constants.ZERO_ADDRESS, // only set if this is a deploy request
          recoverer: constants.ZERO_ADDRESS,
          index: '0'
        },
        relayData: {
          pctRelayFee,
          baseRelayFee,
          gasPrice,
          relayWorker,
          forwarder,
          paymaster,
          paymasterData,
          clientId
        }
      }
    })

    // TODO review gasPrice for RSK
    context('with unknown worker', function () {
      const signature = '0xdeadbeef'
      const approvalData = '0x'
      const gas = 4e6
      let relayRequest: RelayRequest
      beforeEach(async function () {
        relayRequest = cloneRelayRequest(sharedRelayRequestData)
        relayRequest.request.data = '0xdeadbeef'
        await relayHubInstance.depositFor(paymaster, {
          from: other,
          value: ether('1'),
          gasPrice: 1
        })
      })

      it('should not accept a relay call', async function () {
        await expectRevert.unspecified(
          relayHubInstance.relayCall(10e6, relayRequest, signature, approvalData, gas, {
            from: relayWorker,
            gas
          }),
          'Unknown relay worker')
      })

      context('with manager stake unlocked', function () {
        beforeEach(async function () {
          await stakeManager.stakeForAddress(relayManager, 1000, {
            value: ether('1'),
            from: relayOwner
          })
          await stakeManager.authorizeHubByOwner(relayManager, relayHub, { from: relayOwner })
          await relayHubInstance.addRelayWorkers([relayWorker], {
            from: relayManager
          })
          await stakeManager.unauthorizeHubByOwner(relayManager, relayHub, { from: relayOwner })
        })
        it('should not accept a relay call', async function () {
          await expectRevert.unspecified(
            relayHubInstance.relayCall(10e6, relayRequest, signature, approvalData, gas, {
              from: relayWorker,
              gas
            }),
            'relay manager not staked')
        })
      })
    })

    context('with staked and registered relay', function () {
      const url = 'http://relay.com'
      const message = 'GSN RelayHub'
      const messageWithNoParams = 'Method with no parameters'

      let relayRequest: RelayRequest
      let encodedFunction: string
      let signatureWithPermissivePaymaster: string

      beforeEach(async function () {
        await stakeManager.stakeForAddress(relayManager, 1000, {
          value: ether('2'),
          from: relayOwner
        })
        await stakeManager.authorizeHubByOwner(relayManager, relayHub, { from: relayOwner })

        // truffle-contract doesn't let us create method data from the class, we need an actual instance
        encodedFunction = recipientContract.contract.methods.emitMessage(message).encodeABI()

        await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
        await relayHubInstance.registerRelayServer(baseRelayFee, pctRelayFee, url, { from: relayManager })
        relayRequest = cloneRelayRequest(sharedRelayRequestData)
        relayRequest.request.data = encodedFunction
        const dataToSign = new TypedRequestData(
          chainId,
          forwarder,
          relayRequest
        )
        signatureWithPermissivePaymaster = getLocalEip712Signature(
          dataToSign,
          gaslessAccount.privateKey
        )

        await relayHubInstance.depositFor(paymaster, {
          value: ether('1'),
          from: other
        })
      })

      context('with relay worker that is not externally-owned account', function () {
        it('should not accept relay requests', async function () {
          const signature = '0xdeadbeef'
          const gas = 4e6
          const TestRelayWorkerContract = artifacts.require('TestRelayWorkerContract')
          const testRelayWorkerContract = await TestRelayWorkerContract.new()
          await relayHubInstance.addRelayWorkers([testRelayWorkerContract.address], {
            from: relayManager
          })
          await expectRevert.unspecified(
            testRelayWorkerContract.relayCall(
              relayHubInstance.address,
              10e6,
              relayRequest,
              signature,
              gas,
              {
                gas
              }),
            'RelayWorker cannot be a contract')
        })
      })
      context('with view functions only', function () {
        let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
        let relayRequestMisbehavingPaymaster: RelayRequest

        beforeEach(async function () {
          misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
          // await misbehavingPaymaster.setTrustedForwarder(forwarder)
          await misbehavingPaymaster.setRelayHub(relayHub)
          await relayHubInstance.depositFor(misbehavingPaymaster.address, {
            value: ether('1'),
            from: other
          })
          relayRequestMisbehavingPaymaster = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingPaymaster.relayData.paymaster = misbehavingPaymaster.address
        })

        // TODO re-enable
        it.skip('should get \'paymasterAccepted = true\' and no revert reason as view call result of \'relayCall\' for a valid transaction', async function () {
          const relayCallView = await relayHubInstance.contract.methods.relayCall(
            10e6,
            relayRequest,
            signatureWithPermissivePaymaster, '0x', 7e6)
            .call({
              from: relayWorker,
              gas: 7e6
            })
          assert.equal(relayCallView.returnValue, null)
          assert.equal(relayCallView.paymasterAccepted, true)
        })

        // TODO re-enable
        it.skip('should get Paymaster\'s reject reason from view call result of \'relayCall\' for a transaction with a wrong signature', async function () {
          await misbehavingPaymaster.setReturnInvalidErrorCode(true)
          const relayCallView =
            await relayHubInstance.contract.methods
              .relayCall(10e6, relayRequestMisbehavingPaymaster, '0x', '0x', 7e6)
              .call({ from: relayWorker })

          assert.equal(relayCallView.paymasterAccepted, false)

          assert.equal(relayCallView.returnValue, encodeRevertReason('invalid code'))
          assert.equal(decodeRevertReason(relayCallView.returnValue), 'invalid code')
        })
      })

      context('with funded paymaster', function () {
        let signature

        let paymasterWithContext
        let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance

        let relayRequestPaymasterWithContext: RelayRequest
        let signatureWithContextPaymaster: string

        let signatureWithMisbehavingPaymaster: string
        let relayRequestMisbehavingPaymaster: RelayRequest
        const gas = 4e6
        const tokenReceiverAddress = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'

        beforeEach(async function () {
          paymasterWithContext = await TestPaymasterStoreContext.new()
          misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
          // await paymasterWithContext.setTrustedForwarder(forwarder)
          // await misbehavingPaymaster.setTrustedForwarder(forwarder)
          await paymasterWithContext.setRelayHub(relayHub)
          await misbehavingPaymaster.setRelayHub(relayHub)
          await relayHubInstance.depositFor(paymasterWithContext.address, {
            value: ether('1'),
            from: other
          })
          await relayHubInstance.depositFor(misbehavingPaymaster.address, {
            value: ether('1'),
            from: other
          })
          let dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          )

          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          relayRequestMisbehavingPaymaster = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingPaymaster.relayData.paymaster = misbehavingPaymaster.address

          dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestMisbehavingPaymaster
          )
          signatureWithMisbehavingPaymaster = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          relayRequestPaymasterWithContext = cloneRelayRequest(relayRequest)
          relayRequestPaymasterWithContext.relayData.paymaster = paymasterWithContext.address
          dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestPaymasterWithContext
          )
          signatureWithContextPaymaster = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
        })

        it('gas estimation tests', async function () {
          const nonceBefore = await forwarderInstance.nonce()
          const TestToken = artifacts.require('TestToken')
          const tokenInstance = await TestToken.new()
          await tokenInstance.mint('1000000', forwarder)

          const completeReq = {
            request: {
              ...relayRequest.request,
              data: recipientContract.contract.methods.emitMessage2(message).encodeABI(),
              nonce: nonceBefore.toString(),
              tokenRecipient: senderAddress,
              tokenContract: tokenInstance.address,
              tokenAmount: '1'
            },
            relayData: {
              ...relayRequest.relayData
            }
          }

          const reqToSign = new TypedRequestData(
            chainId,
            forwarder,
            completeReq
          )

          const sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey
          )

          const { tx, logs } = await relayHubInstance.relayCall(10e6, completeReq, sig, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })
          const nonceAfter = await forwarderInstance.nonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber())

          const eventHash = keccak('GasUsed(uint256,uint256)')
          const txReceipt = await web3.eth.getTransactionReceipt(tx)
          console.log('---------------------------------------')

          console.log(`Gas Used: ${txReceipt.gasUsed}`)
          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`)

          let previousGas: BigInt = BigInt(0)
          let previousStep = null
          for (var i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i]
            if (('0x' + eventHash.toString('hex')) === log.topics[0]) {
              const step = log.data.substring(0, 66)
              const gasUsed: BigInt = BigInt('0x' + log.data.substring(67, log.data.length))
              console.log('---------------------------------------')
              console.log('step :', BigInt(step).toString())
              console.log('gasLeft :', gasUsed.toString())

              if (previousStep != null) {
                console.log(`Steps substraction ${BigInt(step).toString()} and ${BigInt(previousStep).toString()}`)
                console.log((previousGas.valueOf() - gasUsed.valueOf()).toString())
              }
              console.log('---------------------------------------')

              previousGas = BigInt(gasUsed)
              previousStep = step
            }
          }

          // const trxRespo = await recipientContract.emitMessage2.sendTransaction(message, {
          // from: relayWorker,
          // gas,
          // gasPrice
          // })

          // console.log("ORIGINAL CALL")
          // console.log(trxRespo)
          // const txReceipt2 = await web3.eth.getTransactionReceipt(trxRespo)

          // console.log(txReceipt2)

          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message,
            msgSender: forwarder,
            origin: relayWorker
          })

          const expectedReturnValue = web3.eth.abi.encodeParameter('string', 'emitMessage return value')
          expectEvent.inLogs(logs, 'TransactionResult', {
            status: RelayCallStatusCodes.OK,
            returnValue: expectedReturnValue
          })
          expectEvent.inLogs(logs, 'TransactionRelayed', {
            status: RelayCallStatusCodes.OK
          })
        })

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await forwarderInstance.nonce()

          const { tx, logs } = await relayHubInstance.relayCall(10e6, relayRequest, signatureWithPermissivePaymaster, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })
          const nonceAfter = await forwarderInstance.nonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber())

          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message,
            msgSender: forwarder,
            origin: relayWorker
          })

          const expectedReturnValue = web3.eth.abi.encodeParameter('string', 'emitMessage return value')
          expectEvent.inLogs(logs, 'TransactionResult', {
            status: RelayCallStatusCodes.OK,
            returnValue: expectedReturnValue
          })
          expectEvent.inLogs(logs, 'TransactionRelayed', {
            status: RelayCallStatusCodes.OK
          })
        })

        it('relayCall executes the transaction with an ERC20 recipient and increments sender nonce on hub', async function () {
          await testTokenRecipient.mint('200', forwarder)

          const nonceBefore = await forwarderInstance.getNonce()
          const encodedFunction = await testTokenRecipient.contract.methods.transfer(tokenReceiverAddress, '5').encodeABI()
          const relayRequestTokenTransferData = cloneRelayRequest(relayRequest)
          relayRequestTokenTransferData.request.data = encodedFunction
          relayRequestTokenTransferData.request.to = testTokenRecipient.address
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestTokenTransferData
          )
          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          const { tx, logs } = await relayHubInstance.relayCall(10e6, relayRequestTokenTransferData, signature, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })
          const nonceAfter = await forwarderInstance.getNonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber())
          const balance = await testTokenRecipient.balanceOf(tokenReceiverAddress)
          chai.expect('5').to.be.bignumber.equal(balance)

          await expectEvent.inTransaction(tx, TestTokenRecipient, 'Transfer')
          expectEvent.inLogs(logs, 'TransactionRelayed', {
            status: RelayCallStatusCodes.OK
          })
        })

        it('relayCall should refuse to re-send transaction with same nonce', async function () {
          const { tx } = await relayHubInstance.relayCall(10e6, relayRequest, signatureWithPermissivePaymaster, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })
          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted')

          const ret = await relayHubInstance.relayCall(10e6, relayRequest, signatureWithPermissivePaymaster, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })

          await expectEvent(ret, 'TransactionRejectedByPaymaster', { reason: encodeRevertReason('nonce mismatch') })
        })
        // This test is added due to a regression that almost slipped to production.
        it('relayCall executes the transaction with no parameters', async function () {
          const encodedFunction = recipientContract.contract.methods.emitMessageNoParams().encodeABI()
          const relayRequestNoCallData = cloneRelayRequest(relayRequest)
          relayRequestNoCallData.request.data = encodedFunction
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestNoCallData
          )
          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          const { tx } = await relayHubInstance.relayCall(10e6, relayRequestNoCallData, signature, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })
          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message: messageWithNoParams,
            msgSender: forwarder,
            origin: relayWorker
          })
        })

        it('relayCall executes a transaction even if recipient call reverts', async function () {
          const encodedFunction = recipientContract.contract.methods.testRevert().encodeABI()
          const relayRequestRevert = cloneRelayRequest(relayRequest)
          relayRequestRevert.request.data = encodedFunction
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestRevert
          )
          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          const { logs } = await relayHubInstance.relayCall(10e6, relayRequestRevert, signature, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const expectedReturnValue = '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', 'always fail'))
          expectEvent.inLogs(logs, 'TransactionResult', {
            status: RelayCallStatusCodes.RelayedCallFailed,
            returnValue: expectedReturnValue
          })
          expectEvent.inLogs(logs, 'TransactionRelayed', {
            status: RelayCallStatusCodes.RelayedCallFailed
          })
        })

        it('relayCall executes a transaction even if token recipient call reverts', async function () {
          const encodedFunction = await testTokenRecipient.contract.methods.transfer(tokenReceiverAddress, '5').encodeABI()
          const relayRequestTokenTransferData = cloneRelayRequest(relayRequest)
          relayRequestTokenTransferData.request.data = encodedFunction
          relayRequestTokenTransferData.request.to = testTokenRecipient.address
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestTokenTransferData
          )
          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          const { logs } = await relayHubInstance.relayCall(10e6, relayRequestTokenTransferData, signature, '0x', gas, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const expectedReturnValue = '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', 'ERC20: transfer amount exceeds balance'))
          expectEvent.inLogs(logs, 'TransactionResult', {
            status: RelayCallStatusCodes.RelayedCallFailed,
            returnValue: expectedReturnValue
          })
          expectEvent.inLogs(logs, 'TransactionRelayed', {
            status: RelayCallStatusCodes.RelayedCallFailed
          })

          const balance = await testTokenRecipient.balanceOf(tokenReceiverAddress)
          chai.expect('0').to.be.bignumber.equal(balance)
        })

        it('postRelayedCall receives values returned in preRelayedCall', async function () {
          const { tx } = await relayHubInstance.relayCall(10e6, relayRequestPaymasterWithContext,
            signatureWithContextPaymaster, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice
            })

          await expectEvent.inTransaction(tx, TestPaymasterStoreContext, 'SampleRecipientPostCallWithValues', {
            context: 'context passed from preRelayedCall to postRelayedCall'
          })
        })

        it('relaying is aborted if the paymaster reverts the preRelayedCall', async function () {
          await misbehavingPaymaster.setReturnInvalidErrorCode(true)
          const { logs } = await relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster,
            signatureWithMisbehavingPaymaster, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice
            })

          expectEvent.inLogs(logs, 'TransactionRejectedByPaymaster', { reason: encodeRevertReason('invalid code') })
        })

        it('should not accept relay requests if gas limit is too low for a relayed transaction', async function () {
          // Adding gasReserve is not enough by a few wei as some gas is spent before gasleft().
          const gasReserve = 99999
          const gas = parseInt(gasLimit) + gasReserve
          await expectRevert.unspecified(
            relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', gas, {
              from: relayWorker,
              gasPrice,
              gas
            }),
            'Not enough gas left')
        })

        it('should not accept relay requests with gas price lower then user specified', async function () {
          await expectRevert.unspecified(
            relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice: parseInt(gasPrice) - 1
            }),
            'Invalid gas price')
        })

        it('should not accept relay requests with gas limit higher then block gas limit', async function () {
          await expectRevert.unspecified(
            relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', 100000001, {
              from: relayWorker,
              gasPrice,
              gas
            }),
            'Impossible gas limit')
        })

        it('should not accept relay requests with incorrect relay worker', async function () {
          await relayHubInstance.addRelayWorkers([incorrectWorker], { from: relayManager })
          await expectRevert.unspecified(
            relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', gas, {
              from: incorrectWorker,
              gasPrice,
              gas
            }),
            'Not a right worker')
        })

        it('should not accept relay requests if destination recipient doesn\'t have a balance to pay for it',
          async function () {
            const paymaster2 = await TestPaymasterEverythingAccepted.new()
            // await paymaster2.setTrustedForwarder(forwarder)
            await paymaster2.setRelayHub(relayHub)
            const maxPossibleCharge = (await relayHubInstance.calculateCharge(gasLimit, {
              gasPrice,
              pctRelayFee,
              baseRelayFee,
              relayWorker,
              forwarder,
              paymaster: paymaster2.address,
              paymasterData: '0x',
              clientId: '1'
            })).toNumber()
            await paymaster2.deposit({ value: (maxPossibleCharge - 1).toString() }) // TODO: replace with correct margin calculation

            const relayRequestPaymaster2 = cloneRelayRequest(relayRequest)
            relayRequestPaymaster2.relayData.paymaster = paymaster2.address

            await expectRevert.unspecified(
              relayHubInstance.relayCall(10e6, relayRequestPaymaster2, signatureWithMisbehavingPaymaster, '0x', gas, {
                from: relayWorker,
                gas,
                gasPrice
              }),
              'Paymaster balance too low')
          })

        it('should not execute the \'relayedCall\' if \'preRelayedCall\' reverts', async function () {
          await misbehavingPaymaster.setRevertPreRelayCall(true)
          // @ts-ignore (there is a problem with web3 types annotations that must be solved)
          const startBlock = await web3.eth.getBlockNumber()

          const { logs } = await relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster,
            signatureWithMisbehavingPaymaster, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice: gasPrice
            })

          // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
          const logsMessages = await recipientContract.contract.getPastEvents('SampleRecipientEmitted', {
            fromBlock: startBlock,
            toBlock: 'latest'
          })
          assert.equal(0, logsMessages.length)
          // const expectedReturnValue = '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', 'revertPreRelayCall: Reverting'))
          expectEvent.inLogs(logs, 'TransactionRejectedByPaymaster', {
            reason: encodeRevertReason('revertPreRelayCall: Reverting')
          })
        })

        it('should fail a transaction if paymaster.getGasLimits is too expensive', async function () {
          await misbehavingPaymaster.setExpensiveGasLimits(true)
          // Set the number of iterations in TestPaymasterConfigurableMisbehavior for getGasLimits() to spend ~50000 gas units
          await misbehavingPaymaster.setExpensiveGasLimitsIterations(isRsk(env) ? 190 : 85)

          await expectRevert.unspecified(relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster,
            signatureWithMisbehavingPaymaster, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice: gasPrice
            }), 'revert')
        })

        it('should revert the \'relayedCall\' if \'postRelayedCall\' reverts', async function () {
          await misbehavingPaymaster.setRevertPostRelayCall(true)
          const { logs } = await relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster,
            signatureWithMisbehavingPaymaster, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice: gasPrice
            })

          // @ts-ignore (there is a problem with web3 types annotations that must be solved)
          const startBlock = await web3.eth.getBlockNumber()
          // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
          const logsMessages = await recipientContract.contract.getPastEvents('SampleRecipientEmitted', {
            fromBlock: startBlock,
            toBlock: 'latest'
          })
          assert.equal(0, logsMessages.length)
          expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.PostRelayedFailed })
        })

        describe('recipient balance withdrawal ban', function () {
          let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
          let relayRequestMisbehavingPaymaster: RelayRequest
          let signature: string
          beforeEach(async function () {
            misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
            // await misbehavingPaymaster.setTrustedForwarder(forwarder)
            await misbehavingPaymaster.setRelayHub(relayHub)
            await relayHubInstance.depositFor(misbehavingPaymaster.address, {
              value: ether('1'),
              from: other
            })

            relayRequestMisbehavingPaymaster = cloneRelayRequest(relayRequest)
            relayRequestMisbehavingPaymaster.relayData.paymaster = misbehavingPaymaster.address
            const dataToSign = new TypedRequestData(
              chainId,
              forwarder,
              relayRequestMisbehavingPaymaster
            )
            signature = getLocalEip712Signature(
              dataToSign,
              gaslessAccount.privateKey
            )
          })

          it('reverts relayed call if recipient withdraws balance during preRelayedCall', async function () {
            await misbehavingPaymaster.setWithdrawDuringPreRelayedCall(true)
            await assertRevertWithPaymasterBalanceChanged()
          })

          it('reverts relayed call if recipient withdraws balance during the relayed call', async function () {
            await recipientContract.setWithdrawDuringRelayedCall(misbehavingPaymaster.address)
            await assertRevertWithPaymasterBalanceChanged()
          })

          it('reverts relayed call if recipient withdraws balance during postRelayedCall', async function () {
            await misbehavingPaymaster.setWithdrawDuringPostRelayedCall(true)
            await assertRevertWithPaymasterBalanceChanged()
          })

          async function assertRevertWithPaymasterBalanceChanged (): Promise<void> {
            const { logs } = await relayHubInstance.relayCall(10e6, relayRequestMisbehavingPaymaster, signature, '0x', gas, {
              from: relayWorker,
              gas,
              gasPrice
            })
            expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.PaymasterBalanceChanged })
          }
        })
      })
    })
  })
})

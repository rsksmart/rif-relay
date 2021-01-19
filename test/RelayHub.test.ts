import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import chai from 'chai'

import { decodeRevertReason, getLocalEip712Signature, removeHexPrefix } from '../src/common/Utils'
import { RelayRequest, cloneRelayRequest } from '../src/common/EIP712/RelayRequest'
import { Environment } from '../src/common/Environments'
import TypedRequestData, { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'

import {
  RelayHubInstance,
  PenalizerInstance,
  StakeManagerInstance,
  TestRecipientInstance,
  IForwarderInstance,
  TestVerifierEverythingAcceptedInstance,
  TestVerifierConfigurableMisbehaviorInstance,
  SmartWalletInstance,
  ProxyFactoryInstance,
  SimpleSmartWalletInstance,
  SimpleProxyFactoryInstance,
  TestTokenInstance
} from '../types/truffle-contracts'
import { deployHub, encodeRevertReason, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount, createSimpleProxyFactory, createSimpleSmartWallet } from './TestUtils'

import chaiAsPromised from 'chai-as-promised'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { keccak } from 'ethereumjs-util'
const { assert } = chai.use(chaiAsPromised)
const StakeManager = artifacts.require('StakeManager')
const SmartWallet = artifacts.require('SmartWallet')
const Penalizer = artifacts.require('Penalizer')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')
const TestVerifierConfigurableMisbehavior = artifacts.require('TestVerifierConfigurableMisbehavior')

contract('RelayHub', function ([_, relayOwner, relayManager, relayWorker, incorrectWorker]) {
  let chainId: number
  let relayHub: string
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let relayHubInstance: RelayHubInstance
  let recipientContract: TestRecipientInstance
  let verifierContract: TestVerifierEverythingAcceptedInstance
  let forwarderInstance: IForwarderInstance
  let target: string
  let verifier: string
  let forwarder: string
  let gaslessAccount: AccountKeypair
  const gasLimit = '1000000'
  const gasPrice = '1'
  let sharedRelayRequestData: RelayRequest
  let env: Environment
  let token: TestTokenInstance

  beforeEach(async function () {
    env = await getTestingEnvironment()
    chainId = env.chainId

    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    relayHubInstance = await deployHub(stakeManager.address, penalizer.address)
    verifierContract = await TestVerifierEverythingAccepted.new()

    gaslessAccount = await getGaslessAccount()

    const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
    forwarderInstance = await createSmartWallet(gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
    forwarder = forwarderInstance.address
    recipientContract = await TestRecipient.new()
    const testToken = artifacts.require('TestToken')
    token = await testToken.new()
    await token.mint('1000', forwarder)

    target = recipientContract.address
    verifier = verifierContract.address
    relayHub = relayHubInstance.address

    sharedRelayRequestData = {
      request: {
        to: target,
        data: '',
        from: gaslessAccount.address,
        nonce: (await forwarderInstance.nonce()).toString(),
        value: '0',
        gas: gasLimit,
        tokenContract: token.address,
        tokenAmount: '1'
      },
      relayData: {
        gasPrice,
        relayWorker,
        callForwarder: forwarder,
        callVerifier: verifier,
        domainSeparator: getDomainSeparatorHash(forwarder, chainId)
      }
    }
  })

  it('should retrieve version number', async function () {
    const version = await relayHubInstance.versionHub()
    assert.match(version, /2\.\d*\.\d*-?.*\+opengsn\.hub\.irelayhub/)
  })

  describe('relayCall', function () {
    const baseRelayFee = '10000'
    const pctRelayFee = '10'

    // TODO review gasPrice for RSK
    context('with unknown worker', function () {
      const signature = '0xdeadbeef'
      const gas = 4e6
      let relayRequest: RelayRequest
      beforeEach(async function () {
        relayRequest = cloneRelayRequest(sharedRelayRequestData)
        relayRequest.request.data = '0xdeadbeef'
      })

      it('should not accept a relay call', async function () {
        await expectRevert.unspecified(
          relayHubInstance.relayCall(relayRequest, signature, {
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
            relayHubInstance.relayCall(relayRequest, signature, {
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
      let signatureWithPermissiveVerifier: string

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
        signatureWithPermissiveVerifier = getLocalEip712Signature(
          dataToSign,
          gaslessAccount.privateKey
        )
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
              relayRequest,
              signature,
              {
                gas
              }),
            'RelayWorker cannot be a contract')
        })
      })
      context('with view functions only', function () {
        let misbehavingVerifier: TestVerifierConfigurableMisbehaviorInstance
        let relayRequestMisbehavingVerifier: RelayRequest

        beforeEach(async function () {
          misbehavingVerifier = await TestVerifierConfigurableMisbehavior.new()
          relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
        })

        // TODO re-enable
        it.skip('should get \'verifierAccepted = true\' and no revert reason as view call result of \'relayCall\' for a valid transaction', async function () {
          const relayCallView = await relayHubInstance.contract.methods.relayCall(
            relayRequest,
            signatureWithPermissiveVerifier)
            .call({
              from: relayWorker,
              gas: 7e6
            })
          assert.equal(relayCallView.returnValue, null)
          assert.equal(relayCallView.verifierAccepted, true)
        })

        // TODO re-enable
        it.skip('should get Verifier\'s reject reason from view call result of \'relayCall\' for a transaction with a wrong signature', async function () {
          await misbehavingVerifier.setReturnInvalidErrorCode(true)
          const relayCallView =
            await relayHubInstance.contract.methods
              .relayCall(relayRequestMisbehavingVerifier, '0x')
              .call({ from: relayWorker })

          assert.equal(relayCallView.verifierAccepted, false)

          assert.equal(relayCallView.returnValue, encodeRevertReason('invalid code'))
          assert.equal(decodeRevertReason(relayCallView.returnValue), 'invalid code')
        })
      })

      context('with funded verifier', function () {
        let signature

        let misbehavingVerifier: TestVerifierConfigurableMisbehaviorInstance

        let signatureWithMisbehavingVerifier: string
        let relayRequestMisbehavingVerifier: RelayRequest
        const gas = 4e6

        beforeEach(async function () {
          misbehavingVerifier = await TestVerifierConfigurableMisbehavior.new()

          let dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          )

          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address

          dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestMisbehavingVerifier
          )
          signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
        })

        it.only('gas estimation tests for Simple Smart Wallet', async function () {
          const SimpleSmartWallet = artifacts.require('SimpleSmartWallet')
          const simpleSWalletTemplate: SimpleSmartWalletInstance = await SimpleSmartWallet.new()
          const simpleFactory: SimpleProxyFactoryInstance = await createSimpleProxyFactory(simpleSWalletTemplate)
          const sWalletInstance = await createSimpleSmartWallet(gaslessAccount.address, simpleFactory, gaslessAccount.privateKey, chainId)

          const nonceBefore = await sWalletInstance.nonce()
          await token.mint('10000', sWalletInstance.address)

          const completeReq: RelayRequest = cloneRelayRequest(sharedRelayRequestData)
          completeReq.request.data = recipientContract.contract.methods.emitMessage2(message).encodeABI()
          completeReq.request.nonce = nonceBefore.toString()
          completeReq.relayData.callForwarder = sWalletInstance.address
          completeReq.relayData.domainSeparator = getDomainSeparatorHash(sWalletInstance.address, chainId)

          const reqToSign = new TypedRequestData(
            chainId,
            sWalletInstance.address,
            completeReq
          )

          const sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey
          )

          const { tx, logs } = await relayHubInstance.relayCall(completeReq, sig, {
            from: relayWorker,
            gas,
            gasPrice
          })
          const nonceAfter = await sWalletInstance.nonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber(), 'Incorrect nonce after execution')

          const eventHash = keccak('GasUsed(uint256,uint256)')
          const txReceipt = await web3.eth.getTransactionReceipt(tx)
          console.log('---------------Simple SmartWallet: RelayCall metrics------------------------')
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

          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message,
            msgSender: sWalletInstance.address,
            origin: relayWorker
          })

          web3.eth.abi.encodeParameter('string', 'emitMessage return value')

          expectEvent.inLogs(logs, 'TransactionRelayed2')
          const callWithoutRelay = await recipientContract.emitMessage2(message)
          const gasUsed: number = callWithoutRelay.receipt.cumulativeGasUsed
          // const txReceiptWithoutRelay = await web3.eth.getTransactionReceipt(callWithoutRelay)
          console.log('--------------- Destination Call Without enveloping------------------------')
          console.log(`Cummulative Gas Used: ${gasUsed}`)
          console.log('---------------------------------------')
          console.log('--------------- Enveloping Overhead ------------------------')
          console.log(`Overhead Gas: ${txReceipt.cumulativeGasUsed - gasUsed}`)
          console.log('---------------------------------------')
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

          const { tx, logs } = await relayHubInstance.relayCall(completeReq, sig, {
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

          web3.eth.abi.encodeParameter('string', 'emitMessage return value')

          expectEvent.inLogs(logs, 'TransactionRelayed')
        })

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await forwarderInstance.nonce()

          const { tx, logs } = await relayHubInstance.relayCall(relayRequest, signatureWithPermissiveVerifier, {
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

          web3.eth.abi.encodeParameter('string', 'emitMessage return value')

          expectEvent.inLogs(logs, 'TransactionRelayed')
        })

        it('relayCall should refuse to re-send transaction with same nonce', async function () {
          const { tx } = await relayHubInstance.relayCall(relayRequest, signatureWithPermissiveVerifier, {
            from: relayWorker,
            gas,
            gasPrice
          })
          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted')

          await expectRevert.unspecified(
            relayHubInstance.relayCall(relayRequest, signatureWithPermissiveVerifier, {
              from: relayWorker,
              gas,
              gasPrice
            }),
            'nonce mismatch')
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
          const { tx } = await relayHubInstance.relayCall(relayRequestNoCallData, signature, {
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
          const { logs } = await relayHubInstance.relayCall(relayRequestRevert, signature, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const expectedReturnValue = '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', 'always fail'))

          expectEvent.inLogs(logs, 'TransactionRelayedButRevertedByRecipient', {
            relayWorker: relayWorker,
            reason: expectedReturnValue
          })
        })

        it('should not accept relay requests if passed gas is too low for a relayed transaction', async function () {
          const gasOverhead = (await relayHubInstance.gasOverhead()).toNumber()
          const gasAlreadyUsedBeforeDoingAnythingInRelayCall = BigInt(43782)// Just by calling and sending the parameters
          const gasToSend = gasAlreadyUsedBeforeDoingAnythingInRelayCall + BigInt(gasOverhead) + BigInt(relayRequestMisbehavingVerifier.request.gas)
          await expectRevert.unspecified(
            relayHubInstance.relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gasPrice,
              gas: (gasToSend - BigInt(1000)).toString()
            }),
            'Not enough gas left')
        })

        it('should not accept relay requests with gas price lower than user specified', async function () {
          const relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
          relayRequestMisbehavingVerifier.relayData.gasPrice = (BigInt(gasPrice) + BigInt(1)).toString()

          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestMisbehavingVerifier
          )
          const signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          await expectRevert.unspecified(
            relayHubInstance.relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gas,
              gasPrice: gasPrice
            }),
            'Invalid gas price')
        })

        it('should not accept relay requests with incorrect relay worker', async function () {
          await relayHubInstance.addRelayWorkers([incorrectWorker], { from: relayManager })
          await expectRevert.unspecified(
            relayHubInstance.relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: incorrectWorker,
              gasPrice,
              gas
            }),
            'Not a right worker')
        })

        it('should not accept relay requests if destination recipient doesn\'t have a balance to pay for it',
          async function () {
            const verifier2 = await TestVerifierEverythingAccepted.new()
            const relayRequestVerifier2 = cloneRelayRequest(relayRequest)
            relayRequestVerifier2.relayData.callVerifier = verifier2.address

            await expectRevert.unspecified(
              relayHubInstance.relayCall(relayRequestVerifier2, signatureWithMisbehavingVerifier, {
                from: relayWorker,
                gas,
                gasPrice
              }),
              'Verifier balance too low')
          })

        describe('recipient balance withdrawal ban', function () {
          let misbehavingVerifier: TestVerifierConfigurableMisbehaviorInstance
          let relayRequestMisbehavingVerifier: RelayRequest
          beforeEach(async function () {
            misbehavingVerifier = await TestVerifierConfigurableMisbehavior.new()

            relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
            relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
            const dataToSign = new TypedRequestData(
              chainId,
              forwarder,
              relayRequestMisbehavingVerifier
            )
            signature = getLocalEip712Signature(
              dataToSign,
              gaslessAccount.privateKey
            )
          })
        })
      })
    })
  })
})

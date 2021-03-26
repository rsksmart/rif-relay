import { ether, expectRevert } from '@openzeppelin/test-helpers'
import chai from 'chai'

import { decodeRevertReason, getLocalEip712Signature, removeHexPrefix } from '../src/common/Utils'
import { RelayRequest, cloneRelayRequest, DeployRequest } from '../src/common/EIP712/RelayRequest'
import { Environment } from '../src/common/Environments'
import TypedRequestData, { getDomainSeparatorHash, TypedDeployRequestData } from '../src/common/EIP712/TypedRequestData'
import walletFactoryAbi from '../src/common/interfaces/IWalletFactory.json'
import relayHubAbi from '../src/common/interfaces/IRelayHub.json'

// @ts-ignore
import abiDecoder from 'abi-decoder'

import {
  RelayHubInstance,
  PenalizerInstance,
  TestRecipientInstance,
  IForwarderInstance,
  TestVerifierEverythingAcceptedInstance,
  TestVerifierConfigurableMisbehaviorInstance,
  SmartWalletInstance,
  SmartWalletFactoryInstance,
  TestTokenInstance,
  TestDeployVerifierConfigurableMisbehaviorInstance,
  TestDeployVerifierEverythingAcceptedInstance
} from '../types/truffle-contracts'
import { stripHex, deployHub, encodeRevertReason, getTestingEnvironment, createSmartWallet, getGaslessAccount, createSmartWalletFactory } from './TestUtils'

import chaiAsPromised from 'chai-as-promised'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { keccak } from 'ethereumjs-util'
import { constants } from '../src/common/Constants'
import { toBN, toChecksumAddress } from 'web3-utils'

const { assert } = chai.use(chaiAsPromised)
const SmartWallet = artifacts.require('SmartWallet')
const Penalizer = artifacts.require('Penalizer')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('TestDeployVerifierEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')
const TestVerifierConfigurableMisbehavior = artifacts.require('TestVerifierConfigurableMisbehavior')
const TestDeployVerifierConfigurableMisbehavior = artifacts.require('TestDeployVerifierConfigurableMisbehavior')

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
abiDecoder.addABI(walletFactoryAbi)
abiDecoder.addABI(relayHubAbi)

contract('RelayHub', function ([_, relayOwner, relayManager, relayWorker, incorrectWorker, incorrectRelayManager]) {
  let chainId: number
  let relayHub: string
  let penalizer: PenalizerInstance
  let relayHubInstance: RelayHubInstance
  let recipientContract: TestRecipientInstance
  let verifierContract: TestVerifierEverythingAcceptedInstance
  let deployVerifierContract: TestDeployVerifierEverythingAcceptedInstance
  let forwarderInstance: IForwarderInstance
  let target: string
  let verifier: string
  let forwarder: string
  let gaslessAccount: AccountKeypair
  const gasLimit = '1000000'
  const gasPrice = '1'
  const parametersGasOverhead = BigInt(40921)
  let sharedRelayRequestData: RelayRequest
  let sharedDeployRequestData: DeployRequest
  let env: Environment
  let token: TestTokenInstance
  let factory: SmartWalletFactoryInstance

  describe('add/disable relay workers', function () {
    beforeEach(async function () {
      env = await getTestingEnvironment()
      chainId = env.chainId

      penalizer = await Penalizer.new()
      relayHubInstance = await deployHub(penalizer.address)
      verifierContract = await TestVerifierEverythingAccepted.new()
      deployVerifierContract = await TestDeployVerifierEverythingAccepted.new()
      gaslessAccount = await getGaslessAccount()

      const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      factory = await createSmartWalletFactory(smartWalletTemplate)
      recipientContract = await TestRecipient.new()
      const testToken = artifacts.require('TestToken')
      token = await testToken.new()
      target = recipientContract.address
      verifier = verifierContract.address
      relayHub = relayHubInstance.address

      forwarderInstance = await createSmartWallet(_, gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
      forwarder = forwarderInstance.address
      await token.mint('1000', forwarder)

      sharedRelayRequestData = {
        request: {
          relayHub: relayHub,
          to: target,
          data: '',
          from: gaslessAccount.address,
          nonce: (await forwarderInstance.nonce()).toString(),
          value: '0',
          gas: gasLimit,
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000'
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

    it('should register and allow to disable new relay workers', async function () {
      await relayHubInstance.stakeForAddress(relayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })

      const relayWorkersBefore = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersBefore.toNumber(), 0, `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`)

      let txResponse = await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
      let receipt = await web3.eth.getTransactionReceipt(txResponse.tx)
      let logs = abiDecoder.decodeLogs(receipt.logs)

      const relayWorkersAddedEvent = logs.find((e: any) => e != null && e.name === 'RelayWorkersAdded')
      assert.equal(relayManager.toLowerCase(), relayWorkersAddedEvent.events[0].value.toLowerCase())
      assert.equal(relayWorker.toLowerCase(), relayWorkersAddedEvent.events[1].value[0].toLowerCase())
      assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value)

      let relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersAfter.toNumber(), 1, 'Workers must be one')

      let manager = await relayHubInstance.workerToManager(relayWorker)
      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

      assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

      txResponse = await relayHubInstance.disableRelayWorkers([relayWorker], { from: relayManager })

      receipt = await web3.eth.getTransactionReceipt(txResponse.tx)
      logs = abiDecoder.decodeLogs(receipt.logs)
      const relayWorkersDisabledEvent = logs.find((e: any) => e != null && e.name === 'RelayWorkersDisabled')
      assert.equal(relayManager.toLowerCase(), relayWorkersDisabledEvent.events[0].value.toLowerCase())
      assert.equal(relayWorker.toLowerCase(), relayWorkersDisabledEvent.events[1].value[0].toLowerCase())
      assert.equal(toBN(0), relayWorkersDisabledEvent.events[2].value)

      relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersAfter.toNumber(), 0, 'Workers must be zero')

      manager = await relayHubInstance.workerToManager(relayWorker)
      expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('0')))
      assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)
    })

    it('should fail to disable more relay workers than available', async function () {
      await relayHubInstance.stakeForAddress(relayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })

      const relayWorkersBefore = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersBefore.toNumber(), 0, `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`)

      const txResponse = await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })

      const receipt = await web3.eth.getTransactionReceipt(txResponse.tx)
      const logs = abiDecoder.decodeLogs(receipt.logs)

      const relayWorkersAddedEvent = logs.find((e: any) => e != null && e.name === 'RelayWorkersAdded')
      assert.equal(relayManager.toLowerCase(), relayWorkersAddedEvent.events[0].value.toLowerCase())
      assert.equal(relayWorker.toLowerCase(), relayWorkersAddedEvent.events[1].value[0].toLowerCase())
      assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value)

      let relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersAfter.toNumber(), 1, 'Workers must be one')

      let manager = await relayHubInstance.workerToManager(relayWorker)
      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

      assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

      await expectRevert.unspecified(
        relayHubInstance.disableRelayWorkers([relayWorker, relayWorker], { from: relayManager }),
        'invalid quantity of workers')

      relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersAfter.toNumber(), 1, 'Workers must be one')

      manager = await relayHubInstance.workerToManager(relayWorker)
      expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))
      assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)
    })

    it('should only allow the corresponding relay manager to disable their respective relay workers', async function () {
      await relayHubInstance.stakeForAddress(relayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })

      await relayHubInstance.stakeForAddress(incorrectRelayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })

      const relayWorkersBefore = await relayHubInstance.workerCount(relayManager)
      const relayWorkersBefore2 = await relayHubInstance.workerCount(incorrectRelayManager)
      assert.equal(relayWorkersBefore.toNumber(), 0, `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`)
      assert.equal(relayWorkersBefore2.toNumber(), 0, `Initial workers must be zero but was ${relayWorkersBefore2.toNumber()}`)

      await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
      await relayHubInstance.addRelayWorkers([incorrectWorker], { from: incorrectRelayManager })

      const relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      let relayWorkersAfter2 = await relayHubInstance.workerCount(incorrectRelayManager)

      assert.equal(relayWorkersAfter.toNumber(), 1, 'Workers must be one')
      assert.equal(relayWorkersAfter2.toNumber(), 1, 'Workers must be one')

      let manager = await relayHubInstance.workerToManager(relayWorker)
      let manager2 = await relayHubInstance.workerToManager(incorrectWorker)

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))
      let expectedManager2 = '0x00000000000000000000000'.concat(stripHex(incorrectRelayManager.concat('1')))

      assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)
      assert.equal(manager2.toLowerCase(), expectedManager2.toLowerCase(), `Incorrect relay manager: ${manager2}`)

      await expectRevert.unspecified(
        relayHubInstance.disableRelayWorkers([relayWorker], { from: incorrectRelayManager }),
        'Incorrect Manager')

      relayWorkersAfter2 = await relayHubInstance.workerCount(incorrectRelayManager)
      assert.equal(relayWorkersAfter2.toNumber(), 1, "Workers shouldn't have changed")

      manager = await relayHubInstance.workerToManager(relayWorker)
      expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))
      assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

      manager2 = await relayHubInstance.workerToManager(incorrectWorker)
      expectedManager2 = '0x00000000000000000000000'.concat(stripHex(incorrectRelayManager.concat('1')))
      assert.equal(manager2.toLowerCase(), expectedManager2.toLowerCase(), `Incorrect relay manager: ${manager2}`)
    })
  })

  describe('relayCall', function () {
    const baseRelayFee = '10000'
    const pctRelayFee = '10'

    beforeEach(async function () {
      env = await getTestingEnvironment()
      chainId = env.chainId

      penalizer = await Penalizer.new()
      relayHubInstance = await deployHub(penalizer.address)
      verifierContract = await TestVerifierEverythingAccepted.new()
      deployVerifierContract = await TestDeployVerifierEverythingAccepted.new()
      gaslessAccount = await getGaslessAccount()

      const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      factory = await createSmartWalletFactory(smartWalletTemplate)
      recipientContract = await TestRecipient.new()
      const testToken = artifacts.require('TestToken')
      token = await testToken.new()
      target = recipientContract.address
      verifier = verifierContract.address
      relayHub = relayHubInstance.address

      forwarderInstance = await createSmartWallet(_, gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
      forwarder = forwarderInstance.address
      await token.mint('1000', forwarder)

      sharedRelayRequestData = {
        request: {
          relayHub: relayHub,
          to: target,
          data: '',
          from: gaslessAccount.address,
          nonce: (await forwarderInstance.nonce()).toString(),
          value: '0',
          gas: gasLimit,
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000'
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
      assert.match(version, /2\.\d*\.\d*-?.*\+enveloping\.hub\.irelayhub/)
    })

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
          'Not an enabled worker')
      })

      context('with manager stake unlocked', function () {
        beforeEach(async function () {
          await relayHubInstance.stakeForAddress(relayManager, 1000, {
            value: ether('1'),
            from: relayOwner
          })
          await relayHubInstance.addRelayWorkers([relayWorker], {
            from: relayManager
          })
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
      const message = 'Enveloping RelayHub'
      const messageWithNoParams = 'Method with no parameters'

      let relayRequest: RelayRequest
      let encodedFunction: string
      let signatureWithPermissiveVerifier: string

      beforeEach(async function () {
        await relayHubInstance.stakeForAddress(relayManager, 1000, {
          value: ether('2'),
          from: relayOwner
        })

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

        it('gas estimation tests for SmartWallet', async function () {
          const SmartWallet = artifacts.require('SmartWallet')
          const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
          const smartWalletFactory: SmartWalletFactoryInstance = await createSmartWalletFactory(smartWalletTemplate)
          const sWalletInstance = await createSmartWallet(_, gaslessAccount.address, smartWalletFactory, gaslessAccount.privateKey, chainId)

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

          const { tx } = await relayHubInstance.relayCall(completeReq, sig, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const nonceAfter = await sWalletInstance.nonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber(), 'Incorrect nonce after execution')

          const eventHash = keccak('GasUsed(uint256,uint256)')
          const txReceipt = await web3.eth.getTransactionReceipt(tx)
          console.log('---------------SmartWallet: RelayCall metrics------------------------')
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

          const logs = abiDecoder.decodeLogs(txReceipt.logs)
          const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(sWalletInstance.address.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
          assert.equal(relayWorker.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())

          const transactionRelayedEvent = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')

          assert.isNotNull(transactionRelayedEvent)

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
              tokenAmount: '1',
              tokenGas: '50000'
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

          const { tx } = await relayHubInstance.relayCall(completeReq, sig, {
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

          const logs = abiDecoder.decodeLogs(txReceipt.logs)
          const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(forwarder.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
          assert.equal(relayWorker.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())

          const transactionRelayedEvent = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')

          assert.isNotNull(transactionRelayedEvent)
        })

        it('should fail to relay if the worker has been disabled', async function () {
          let manager = await relayHubInstance.workerToManager(relayWorker)
          // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
          let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

          assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await relayHubInstance.disableRelayWorkers([relayWorker], { from: relayManager })
          manager = await relayHubInstance.workerToManager(relayWorker)
          expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('0')))
          assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await expectRevert.unspecified(
            relayHubInstance.relayCall(relayRequest, signatureWithPermissiveVerifier, {
              from: relayWorker,
              gas,
              gasPrice
            }),
            'Not an enabled worker')
        })

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await forwarderInstance.nonce()

          const { tx } = await relayHubInstance.relayCall(relayRequest, signatureWithPermissiveVerifier, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const nonceAfter = await forwarderInstance.nonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber())

          const receipt = await web3.eth.getTransactionReceipt(tx)
          const logs = abiDecoder.decodeLogs(receipt.logs)
          const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(forwarder.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
          assert.equal(relayWorker.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())

          const transactionRelayedEvent = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')

          assert.isNotNull(transactionRelayedEvent)
        })

        it('relayCall should refuse to re-send transaction with same nonce', async function () {
          const { tx } = await relayHubInstance.relayCall(relayRequest, signatureWithPermissiveVerifier, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const receipt = await web3.eth.getTransactionReceipt(tx)
          const logs = abiDecoder.decodeLogs(receipt.logs)
          const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          assert.isNotNull(sampleRecipientEmittedEvent)

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

          const receipt = await web3.eth.getTransactionReceipt(tx)
          const logs = abiDecoder.decodeLogs(receipt.logs)
          const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          assert.equal(messageWithNoParams, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(forwarder.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
          assert.equal(relayWorker.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())
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
          const { tx } = await relayHubInstance.relayCall(relayRequestRevert, signature, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const reason = '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', 'always fail'))

          const receipt = await web3.eth.getTransactionReceipt(tx)
          const logs = abiDecoder.decodeLogs(receipt.logs)
          const transactionRelayedButRevertedByRecipientEvent =
            logs.find((e: any) => e != null && e.name === 'TransactionRelayedButRevertedByRecipient')

          assert.equal(relayWorker.toLowerCase(), transactionRelayedButRevertedByRecipientEvent.events[1].value.toLowerCase())
          assert.equal(reason, transactionRelayedButRevertedByRecipientEvent.events[3].value)
        })

        it('should not accept relay requests if passed gas is too low for a relayed transaction', async function () {
          const gasOverhead = (await relayHubInstance.gasOverhead()).toNumber()
          const gasAlreadyUsedBeforeDoingAnythingInRelayCall = parametersGasOverhead// Just by calling and sending the parameters
          const gasToSend = gasAlreadyUsedBeforeDoingAnythingInRelayCall + BigInt(gasOverhead) + BigInt(relayRequestMisbehavingVerifier.request.gas)
          await expectRevert.unspecified(
            relayHubInstance.relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gasPrice,
              gas: (gasToSend - BigInt(10000)).toString()
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

  describe('deployCall', function () {
    const baseRelayFee = '10000'
    const pctRelayFee = '10'
    let min = 0
    let max = 1000000000
    min = Math.ceil(min)
    max = Math.floor(max)
    let nextWalletIndex = Math.floor(Math.random() * (max - min + 1) + min)

    beforeEach(async function () {
      env = await getTestingEnvironment()
      chainId = env.chainId

      penalizer = await Penalizer.new()
      relayHubInstance = await deployHub(penalizer.address)
      verifierContract = await TestVerifierEverythingAccepted.new()
      deployVerifierContract = await TestDeployVerifierEverythingAccepted.new()
      gaslessAccount = await getGaslessAccount()

      const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      factory = await createSmartWalletFactory(smartWalletTemplate)
      recipientContract = await TestRecipient.new()
      const testToken = artifacts.require('TestToken')
      token = await testToken.new()
      target = recipientContract.address
      verifier = verifierContract.address
      relayHub = relayHubInstance.address

      sharedDeployRequestData = {
        request: {
          relayHub: relayHub,
          to: constants.ZERO_ADDRESS,
          data: '0x',
          from: gaslessAccount.address,
          nonce: (await factory.nonce(gaslessAccount.address)).toString(),
          value: '0',
          gas: gasLimit,
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000',
          recoverer: constants.ZERO_ADDRESS,
          index: '0'
        },
        relayData: {
          gasPrice,
          relayWorker,
          callForwarder: factory.address,
          callVerifier: deployVerifierContract.address,
          domainSeparator: getDomainSeparatorHash(factory.address, chainId)
        }
      }
    })

    // TODO review gasPrice for RSK
    context('with unknown worker', function () {
      const signature = '0xdeadbeef'
      const gas = 4e6
      let deployRequest: DeployRequest

      beforeEach(async function () {
        deployRequest = cloneRelayRequest(sharedDeployRequestData) as DeployRequest
        deployRequest.request.index = nextWalletIndex.toString()
        nextWalletIndex++
      })

      it('should not accept a deploy call', async function () {
        await expectRevert.unspecified(
          relayHubInstance.deployCall(deployRequest, signature, {
            from: relayWorker,
            gas
          }),
          'Not an enabled worker')
      })

      context('with manager stake unlocked', function () {
        beforeEach(async function () {
          await relayHubInstance.stakeForAddress(relayManager, 1000, {
            value: ether('1'),
            from: relayOwner
          })
          await relayHubInstance.addRelayWorkers([relayWorker], {
            from: relayManager
          })
        })

        it('should not accept a deploy call', async function () {
          await expectRevert.unspecified(
            relayHubInstance.deployCall(deployRequest, signature, {
              from: relayWorker,
              gas
            }),
            'relay manager not staked')
        })
      })
    })

    context('with staked and registered relay', function () {
      const url = 'http://relay.com'
      let deployRequest: DeployRequest

      beforeEach(async function () {
        await relayHubInstance.stakeForAddress(relayManager, 1000, {
          value: ether('2'),
          from: relayOwner
        })
        await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
        await relayHubInstance.registerRelayServer(baseRelayFee, pctRelayFee, url, { from: relayManager })

        deployRequest = cloneRelayRequest(sharedDeployRequestData) as DeployRequest
        deployRequest.request.index = nextWalletIndex.toString()
        nextWalletIndex++
      })

      context('with relay worker that is not externally-owned account', function () {
        it('should not accept deploy requests', async function () {
          const signature = '0xdeadbeef'
          const gas = 4e6
          const TestRelayWorkerContract = artifacts.require('TestRelayWorkerContract')
          const testRelayWorkerContract = await TestRelayWorkerContract.new()
          await relayHubInstance.addRelayWorkers([testRelayWorkerContract.address], {
            from: relayManager
          })
          await expectRevert.unspecified(
            testRelayWorkerContract.deployCall(
              relayHubInstance.address,
              deployRequest,
              signature,
              {
                gas
              }),
            'RelayWorker cannot be a contract')
        })
      })

      context('with funded verifier', function () {
        let misbehavingVerifier: TestDeployVerifierConfigurableMisbehaviorInstance
        let signatureWithMisbehavingVerifier: string
        let relayRequestMisbehavingVerifier: DeployRequest
        const gas = 4e6

        beforeEach(async function () {
          misbehavingVerifier = await TestDeployVerifierConfigurableMisbehavior.new()
          deployRequest.request.index = nextWalletIndex.toString()
          nextWalletIndex++

          relayRequestMisbehavingVerifier = cloneRelayRequest(deployRequest) as DeployRequest
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
          const dataToSign = new TypedDeployRequestData(
            chainId,
            factory.address,
            relayRequestMisbehavingVerifier
          )
          signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
        })

        it('deployCall executes the transaction and increments sender nonce on factory', async function () {
          const nonceBefore = await factory.nonce(gaslessAccount.address)
          const calculatedAddr = await factory.getSmartWalletAddress(gaslessAccount.address,
            constants.ZERO_ADDRESS, relayRequestMisbehavingVerifier.request.index)
          await token.mint('1', calculatedAddr)

          const { tx } = await relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const trx = await web3.eth.getTransactionReceipt(tx)

          const decodedLogs = abiDecoder.decodeLogs(trx.logs)

          const deployedEvent = decodedLogs.find((e: any) => e != null && e.name === 'Deployed')
          assert.isTrue(deployedEvent !== undefined, 'No Deployed event found')
          const event = deployedEvent?.events[0]
          assert.equal(event.name, 'addr')
          const generatedSWAddress = toChecksumAddress(event.value, env.chainId)

          assert.equal(calculatedAddr, generatedSWAddress)

          const nonceAfter = await factory.nonce(gaslessAccount.address)
          assert.equal(nonceAfter.toNumber(), nonceBefore.addn(1).toNumber())
        })

        it('should fail to deploy if the worker has been disabled', async function () {
          let manager = await relayHubInstance.workerToManager(relayWorker)
          // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
          let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

          assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await relayHubInstance.disableRelayWorkers([relayWorker], { from: relayManager })
          manager = await relayHubInstance.workerToManager(relayWorker)
          expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('0')))
          assert.equal(manager.toLowerCase(), expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await expectRevert.unspecified(
            relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gas,
              gasPrice
            }),
            'Not an enabled worker')
        })

        it('deployCall should refuse to re-send transaction with same nonce', async function () {
          const calculatedAddr = await factory.getSmartWalletAddress(gaslessAccount.address,
            constants.ZERO_ADDRESS, relayRequestMisbehavingVerifier.request.index)
          await token.mint('2', calculatedAddr)

          const { tx } = await relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
            from: relayWorker,
            gas,
            gasPrice
          })

          const trx = await web3.eth.getTransactionReceipt(tx)

          const decodedLogs = abiDecoder.decodeLogs(trx.logs)

          const deployedEvent = decodedLogs.find((e: any) => e != null && e.name === 'Deployed')
          assert.isTrue(deployedEvent !== undefined, 'No Deployed event found')
          const event = deployedEvent?.events[0]
          assert.equal(event.name, 'addr')
          const generatedSWAddress = toChecksumAddress(event.value, env.chainId)

          assert.equal(calculatedAddr, generatedSWAddress)
          assert.equal(calculatedAddr, generatedSWAddress)

          await expectRevert.unspecified(
            relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gas,
              gasPrice
            }),
            'nonce mismatch')
        })

        it('should not accept deploy requests if passed gas is too low for a relayed transaction', async function () {
          const gasOverhead = (await relayHubInstance.gasOverhead()).toNumber()
          const gasAlreadyUsedBeforeDoingAnythingInRelayCall = parametersGasOverhead// Just by calling and sending the parameters
          const gasToSend = gasAlreadyUsedBeforeDoingAnythingInRelayCall + BigInt(gasOverhead) + BigInt(relayRequestMisbehavingVerifier.request.gas)
          await expectRevert.unspecified(
            relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gasPrice,
              gas: (gasToSend - BigInt(10000)).toString()
            }),
            'Not enough gas left')
        })

        it('should not accept deploy requests with gas price lower than user specified', async function () {
          const relayRequestMisbehavingVerifier = cloneRelayRequest(deployRequest) as DeployRequest
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
          relayRequestMisbehavingVerifier.relayData.gasPrice = (BigInt(gasPrice) + BigInt(1)).toString()

          const dataToSign = new TypedDeployRequestData(
            chainId,
            factory.address,
            relayRequestMisbehavingVerifier
          )
          const signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          await expectRevert.unspecified(
            relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: relayWorker,
              gas,
              gasPrice: gasPrice
            }),
            'Invalid gas price')
        })

        it('should not accept deploy requests with incorrect relay worker', async function () {
          await relayHubInstance.addRelayWorkers([incorrectWorker], { from: relayManager })
          await expectRevert.unspecified(
            relayHubInstance.deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              from: incorrectWorker,
              gasPrice,
              gas
            }),
            'Not a right worker')
        })

        it('should not accept deploy requests if destination recipient doesn\'t have a balance to pay for it',
          async function () {
            const verifier2 = await TestDeployVerifierEverythingAccepted.new()
            const relayRequestVerifier2 = cloneRelayRequest(deployRequest) as DeployRequest
            relayRequestVerifier2.relayData.callVerifier = verifier2.address

            await expectRevert.unspecified(
              relayHubInstance.deployCall(relayRequestVerifier2, signatureWithMisbehavingVerifier, {
                from: relayWorker,
                gas,
                gasPrice
              }),
              'Verifier balance too low')
          })
      })
    })
  })
})

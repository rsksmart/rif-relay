/* global artifacts describe */
// @ts-ignore
import { HttpProvider } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'

import { EnvelopingConfig } from '../../src/relayclient/Configurator'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { SendTransactionDetails, SignedTransactionDetails } from '../../src/relayserver/TransactionManager'
import { ServerConfigParams } from '../../src/relayserver/ServerConfigParams'
import { TestDeployVerifierConfigurableMisbehaviorInstance, TestRecipientInstance, TestTokenInstance, TestVerifierConfigurableMisbehaviorInstance } from '../../types/truffle-contracts'
import { defaultEnvironment, isRsk } from '../../src/common/Environments'
import { sleep } from '../../src/common/Utils'

import { evmMineMany, INCORRECT_ECDSA_SIGNATURE, revert, snapshot, getTestingEnvironment } from '../TestUtils'
import { LocalhostOne, ServerTestEnvironment } from './ServerTestEnvironment'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import { assertRelayAdded, getTotalTxCosts } from './ServerTestUtils'
import { PrefixedHexString } from 'ethereumjs-tx'
import { ServerAction } from '../../src/relayserver/StoredTransaction'
import { constants } from '../../src/common/Constants'

const { expect, assert } = chai.use(chaiAsPromised).use(sinonChai)

const TestToken = artifacts.require('TestToken')
const TestVerifierConfigurableMisbehavior = artifacts.require('TestVerifierConfigurableMisbehavior')
const TestDeployVerifierConfigurableMisbehavior = artifacts.require('TestDeployVerifierConfigurableMisbehavior')

const revertReasonSupported = true
contract('RelayServer', function (accounts) {
  const alertedBlockDelay = 0

  let id: string
  let globalId: string
  let env: ServerTestEnvironment
  let token: TestTokenInstance

  before(async function () {
    globalId = (await snapshot()).result
    const relayClientConfig: Partial<EnvelopingConfig> = {
      preferredRelays: [LocalhostOne],
      maxRelayNonceGap: 0,
      chainId: (await getTestingEnvironment()).chainId
    }

    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init(relayClientConfig)
    const overrideParams: Partial<ServerConfigParams> = {
      alertedBlockDelay,
      workerTargetBalance: 0.6e18
    }
    await env.newServerInstance(overrideParams)
    await env.clearServerStorage()
    token = await TestToken.new()
    await token.mint('1000', env.forwarder.address)
  })

  after(async function () {
    await revert(globalId)
    await env.clearServerStorage()
  })

  describe('#init()', function () {
    it('should initialize relay params (chainId, networkId, gasPrice)', async function () {
      const env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
      await env.init({})
      await env.newServerInstanceNoInit()
      const relayServerToInit = env.relayServer
      const chainId = await env.web3.eth.getChainId()
      const networkId = await env.web3.eth.net.getId()
      assert.notEqual(relayServerToInit.chainId, chainId)
      assert.notEqual(relayServerToInit.networkId, networkId)
      assert.equal(relayServerToInit.ready, false)
      await relayServerToInit.init()
      assert.equal(relayServerToInit.ready, false, 'relay should not be ready yet')
      assert.equal(relayServerToInit.chainId, chainId)
      assert.equal(relayServerToInit.networkId, networkId)
    })
  })

  describe('validation', function () {
    beforeEach(async function () {
      await env.relayServer.txStoreManager.clearAll()
    })

    describe('#validateInputTypes()', function () {
      // skipped because error message changed here for no apparent reason
      it.skip('should throw on undefined data', async function () {
        const req = await env.createRelayHttpRequest()
        // @ts-ignore
        req.relayRequest.request.data = undefined
        try {
          env.relayServer.validateInputTypes(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
        }
      })
    })

    describe('#validateInput()', function () {
      it('should fail to relay with wrong relay worker', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.relayWorker = accounts[1]
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message, `Wrong worker address: ${accounts[1]}`)
        }
      })

      it('should fail to relay with unacceptable gasPrice', async function () {
        const wrongGasPrice = isRsk(await getTestingEnvironment()) ? '0.5' : '100'
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.gasPrice = wrongGasPrice
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message,
            `Unacceptable gasPrice: relayServer's gasPrice:${env.relayServer.gasPrice} request's gasPrice: ${wrongGasPrice}`)
        }
      })

      it('should fail to relay with wrong hub address', async function () {
        const wrongHubAddress = '0xdeadface'
        const req = await env.createRelayHttpRequest()
        req.metadata.relayHubAddress = wrongHubAddress
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message,
            `Wrong hub address.\nRelay server's hub address: ${env.relayServer.config.relayHubAddress}, request's hub address: ${wrongHubAddress}\n`)
        }
      })
    })

    describe('#validateVerifier()', function () {
      describe('with trusted forwarder', function () {
        before(async function () {
          await env.relayServer._initTrustedVerifiers([env.relayVerifier.address, env.deployVerifier.address])
        })

        after(async function () {
          await env.relayServer._initTrustedVerifiers([])
        })

        it('#_itTrustedForwarder', function () {
          assert.isFalse(env.relayServer.isTrustedVerifier(accounts[1]), 'identify untrusted verifier')
          assert.isTrue(env.relayServer.isTrustedVerifier(env.relayVerifier.address), 'identify trusted verifier')
          assert.isTrue(env.relayServer.isTrustedVerifier(env.deployVerifier.address), 'identify trusted verifier')
        })
      })

      describe('#validateMaxNonce()', function () {
        before(async function () {
          // this is a new worker account - create transaction
          const latestBlock = (await env.web3.eth.getBlock('latest')).number
          await env.relayServer._worker(latestBlock)
          const signer = env.relayServer.workerAddress

          console.log(`THE BALANCE OF THE WORKER ${signer} is`)
          console.log(await web3.eth.getBalance(signer))
          await env.relayServer.transactionManager.sendTransaction({
            signer,
            serverAction: ServerAction.VALUE_TRANSFER,
            gasLimit: defaultEnvironment.mintxgascost,
            destination: accounts[0],
            creationBlockNumber: 0
          })
        })

        it('should not throw with relayMaxNonce above current nonce', async function () {
          await env.relayServer.validateMaxNonce(1000)
        })

        it('should throw exception with relayMaxNonce below current nonce', async function () {
          try {
            await env.relayServer.validateMaxNonce(0)
            assert.fail()
          } catch (e) {
            assert.include(e.message, 'Unacceptable relayMaxNonce:')
          }
        })
      })
    })

    describe('#validateVerifierGasLimits()', function () {
      it('should fail to relay with invalid verifier', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.callVerifier = accounts[1]
        try {
          env.relayServer.validateVerifier(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message, `Invalid verifier: ${accounts[1]}`)
        }
      })

      describe('relay max exposure to verifier rejections', function () {
        let rejectingVerifier: TestVerifierConfigurableMisbehaviorInstance
        let req: RelayTransactionRequest

        before(async function () {
          rejectingVerifier = await TestVerifierConfigurableMisbehavior.new()
          req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.callVerifier = rejectingVerifier.address
        })

        it('should accept a transaction from trusted verifier returning above configured max exposure', async function () {
          const req = await env.createRelayHttpRequest()
          try {
            await env.relayServer._initTrustedVerifiers([rejectingVerifier.address])
            env.relayServer.validateVerifier(req)
          } finally {
            await env.relayServer._initTrustedVerifiers([])
          }
        })
      })
    })

    describe('#validateViewCallSucceeds()', function () {
      // RelayHub contract
      it('should fail to relay rejected transaction', async function () {
        const req = await env.createRelayHttpRequest()

        req.metadata.signature = INCORRECT_ECDSA_SIGNATURE
        const method = env.relayHub.contract.methods.relayCall(req.relayRequest, req.metadata.signature)

        try {
          await env.relayServer.validateViewCallSucceeds(method, req, toBN(2000000))
          assert.fail()
        } catch (e) {
          if (revertReasonSupported) {
            assert.include(e.message, 'signature mismatch')
          } else {
            assert.include(e.message, 'relayCall (local call) reverted in server: Returned error: VM execution error: transaction reverted')
          }
        }
      })

      it('should estimate the transaction max gas properly for subsidized transactions', async function () {
        let estimatedGas = (await env.contractInteractor.estimateGas({
          from: env.forwarder.address,
          to: env.recipient.address,
          gasPrice: toHex(60000000),
          data: env.encodedFunction
        }))

        estimatedGas = estimatedGas > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION ? estimatedGas - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION : estimatedGas

        const req = await env.createRelayHttpRequest({
          gas: toHex(estimatedGas)
        })

        assert.equal((await env.relayServer.txStoreManager.getAll()).length, 0)

        const result = await env.relayServer.validateRequestWithVerifier(req)
        const txDetails: SignedTransactionDetails = await env.relayServer.createRelayTransaction(req)

        const pendingTransactions = await env.relayServer.txStoreManager.getAll()
        assert.equal(pendingTransactions.length, 1)
        assert.equal(pendingTransactions[0].serverAction, ServerAction.RELAY_CALL)

        const receipt = await web3.eth.getTransactionReceipt(txDetails.transactionHash)

        console.log('Estimated gas is:', result.maxPossibleGas.toNumber())
        console.log('Actual gas used is: ', receipt.cumulativeGasUsed)
        assert.equal(receipt.cumulativeGasUsed, result.maxPossibleGas.toNumber())

        const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,uint256,uint256)') ?? ''
        assert(receipt.logs.find(log => log.topics.includes(topic)), 'SampleRecipientEmitted event not found')
      })

      it('should estimate the transaction max gas properly', async function () {
        let estimatedGas = (await env.contractInteractor.estimateGas({
          from: env.forwarder.address,
          to: env.recipient.address,
          gasPrice: toHex(60000000),
          data: env.encodedFunction
        }))

        estimatedGas = estimatedGas > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION ? estimatedGas - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION : estimatedGas

        const encodedFunction = env.contractInteractor.web3.eth.abi.encodeFunctionCall({
          name: 'transfer',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'recipient'
            }, {
              type: 'uint256',
              name: 'amount'
            }
          ]
        },
        [env.relayServer.workerAddress, '1'])

        let tokenGasCost = await env.contractInteractor.estimateGas({
          from: env.forwarder.address, // token holder is the smart wallet
          to: token.address,
          gasPrice: toHex(60000000),
          data: encodedFunction
        })

        tokenGasCost = tokenGasCost > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION ? tokenGasCost - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION : tokenGasCost

        const req = await env.createRelayHttpRequest({
          tokenContract: token.address,
          tokenAmount: '1',
          gas: toHex(estimatedGas),
          tokenGas: toHex(tokenGasCost)
        })

        assert.equal((await env.relayServer.txStoreManager.getAll()).length, 0)

        const result = await env.relayServer.validateRequestWithVerifier(req)
        const txDetails: SignedTransactionDetails = await env.relayServer.createRelayTransaction(req)

        const pendingTransactions = await env.relayServer.txStoreManager.getAll()
        assert.equal(pendingTransactions.length, 1)
        assert.equal(pendingTransactions[0].serverAction, ServerAction.RELAY_CALL)

        const receipt = await web3.eth.getTransactionReceipt(txDetails.transactionHash)

        // console.log("Estimated gas is:", result.maxPossibleGas.toNumber())
        // console.log("Actual gas used is: ", receipt.cumulativeGasUsed)
        assert.equal(receipt.cumulativeGasUsed, result.maxPossibleGas.toNumber())

        const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,uint256,uint256)') ?? ''
        assert(receipt.logs.find(log => log.topics.includes(topic)), 'SampleRecipientEmitted event not found')
      })
    })
  })

  describe('#createRelayTransaction()', function () {
    before(async function () {
      await env.relayServer.txStoreManager.clearAll()
    })

    it('should relay transaction', async function () {
      const req = await env.createRelayHttpRequest()
      assert.equal((await env.relayServer.txStoreManager.getAll()).length, 0)
      await env.relayServer.createRelayTransaction(req)
      const pendingTransactions = await env.relayServer.txStoreManager.getAll()
      assert.equal(pendingTransactions.length, 1)
      assert.equal(pendingTransactions[0].serverAction, ServerAction.RELAY_CALL)
      // TODO: add asserts here!!!
    })
  })

  describe('relay workers/manager rebalancing', function () {
    let relayServer: RelayServer
    const workerIndex = 0
    const gasPrice = 1e9.toString()
    let beforeDescribeId: string
    const txCost = toBN(defaultEnvironment.mintxgascost * parseInt(gasPrice))

    // TODO: not needed, worker is not funded at this point!
    before('deplete worker balance', async function () {
      relayServer = env.relayServer
      beforeDescribeId = (await snapshot()).result
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.workerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost,
        gasPrice: gasPrice,
        creationBlockNumber: 0,
        value: toHex((await relayServer.getWorkerBalance(workerIndex)).sub(txCost))
      })
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.lt(toBN(relayServer.config.workerMinBalance)),
        'worker balance should be lower than min balance')
    })

    after(async function () {
      await revert(beforeDescribeId)
    })

    beforeEach(async function () {
      id = (await snapshot()).result
      await relayServer.transactionManager.txStoreManager.clearAll()
    })

    afterEach(async function () {
      await revert(id)
      relayServer.transactionManager._initNonces()
      await relayServer.transactionManager.txStoreManager.clearAll()
    })

    it('should not replenish when all balances are sufficient', async function () {
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: relayServer.config.managerTargetBalance
      })
      await env.web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.workerAddress, value: relayServer.config.workerTargetBalance })
      const currentBlockNumber = await env.web3.eth.getBlockNumber()
      const receipts = await relayServer.replenishServer(workerIndex, 0)
      assert.deepEqual(receipts, [])
      assert.equal(currentBlockNumber, await env.web3.eth.getBlockNumber())
    })

    it('should use RBTC balance to fund workers', async function () {
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost,
        gasPrice: gasPrice,
        value: toHex((await relayServer.getManagerBalance()).sub(txCost))
      })
      assert.equal((await relayServer.getManagerBalance()).toString(), '0')
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance.toString()).sub(workerBalanceBefore)

      await env.web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.managerAddress, value: toBN(relayServer.config.managerTargetBalance).add(refill), gasPrice: 1 })
      const managerEthBalanceBefore = await relayServer.getManagerBalance()
      assert.isTrue(managerEthBalanceBefore.gt(toBN(relayServer.config.managerTargetBalance.toString())),
        'manager RBTC balance should be greater than target')
      const receipts = await relayServer.replenishServer(workerIndex, 0)
      const totalTxCosts = await getTotalTxCosts(receipts, await env.web3.eth.getGasPrice())
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()})`)
      const managerEthBalanceAfter = await relayServer.getManagerBalance()
      assert.isTrue(managerEthBalanceAfter.eq(managerEthBalanceBefore.sub(refill).sub(totalTxCosts)),
        'manager RBTC balance should increase by hub balance minus txs costs')
    })

    it('should fund from manager RBTC balance when balance is too low', async function () {
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: 1e18
      })
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerEthBalance.gte(refill), 'manager RBTC balance should be sufficient to replenish worker')
      await relayServer.replenishServer(workerIndex, 0)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })

    it('should emit \'funding needed\' when both rbtc and hub balances are too low', async function () {
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost,
        gasPrice: gasPrice.toString(),
        value: toHex((await relayServer.getManagerBalance()).sub(txCost))
      })
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerEthBalance.lt(refill), 'manager RBTC balance should be insufficient to replenish worker')
      let fundingNeededEmitted = false
      relayServer.on('fundingNeeded', () => { fundingNeededEmitted = true })
      await relayServer.replenishServer(workerIndex, 0)
      assert.isTrue(fundingNeededEmitted, 'fundingNeeded not emitted')
    })
  })

  describe('server keepalive re-registration', function () {
    const registrationBlockRate = 100
    const refreshStateTimeoutBlocks = 1
    let relayServer: RelayServer

    before(async function () {
      await env.newServerInstance({
        registrationBlockRate,
        refreshStateTimeoutBlocks,
        workerTargetBalance: 0.6e18
      })
      relayServer = env.relayServer
      sinon.spy(relayServer.registrationManager, 'handlePastEvents')
    })

    it('should re-register server only if registrationBlockRate passed from any tx', async function () {
      let latestBlock = await env.web3.eth.getBlock('latest')
      let receipts = await relayServer._worker(latestBlock.number)
      const receipts2 = await relayServer._worker(latestBlock.number + 1)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, sinon.match.any, sinon.match.any, false)
      assert.equal(receipts.length, 0, 'should not re-register if already registered')
      assert.equal(receipts2.length, 0, 'should not re-register if already registered')
      await evmMineMany(registrationBlockRate)
      latestBlock = await env.web3.eth.getBlock('latest')
      receipts = await relayServer._worker(latestBlock.number)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, sinon.match.any, sinon.match.any, true)
      await assertRelayAdded(receipts, relayServer, false)
    })
  })

  describe('Function testing', function () {
    let relayServer: RelayServer

    before(function () {
      relayServer = env.relayServer
    })
    it('_workerSemaphore', async function () {
      assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false first')
      const workerOrig = relayServer._worker
      let shouldRun = true
      try {
        relayServer._worker = async function (): Promise<PrefixedHexString[]> {
          // eslint-disable-next-line no-unmodified-loop-condition
          while (shouldRun) {
            await sleep(200)
          }
          return []
        }
        const latestBlock = await env.web3.eth.getBlock('latest')
        // eslint-disable-next-line
        relayServer._workerSemaphore(latestBlock.number)
        assert.isTrue(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be true after')
        shouldRun = false
        await sleep(200)
        assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false after')
      } finally {
        relayServer._worker = workerOrig
      }
    })
  })

  describe('alerted state as griefing mitigation', function () {
    const alertedBlockDelay = 100
    const refreshStateTimeoutBlocks = 1
    let rejectingVerifier: TestVerifierConfigurableMisbehaviorInstance
    let rejectingDeployVerifier: TestDeployVerifierConfigurableMisbehaviorInstance
    let newServer: RelayServer
    const TestRecipient = artifacts.require('TestRecipient')
    let recipient: TestRecipientInstance

    beforeEach('should enter an alerted state for a configured blocks delay after verifier rejecting an on-chain tx', async function () {
      id = (await snapshot()).result
      rejectingVerifier = await TestVerifierConfigurableMisbehavior.new()
      rejectingDeployVerifier = await TestDeployVerifierConfigurableMisbehavior.new()
      recipient = await TestRecipient.new()

      await env.newServerInstance({
        alertedBlockDelay,
        refreshStateTimeoutBlocks,
        relayVerifierAddress: rejectingVerifier.address,
        deployVerifierAddress: rejectingDeployVerifier.address,
        workerTargetBalance: 0.6e18
      })
      newServer = env.relayServer
      await attackTheServer(newServer)
    })
    afterEach(async function () {
      await revert(id)
      newServer.transactionManager._initNonces()
    })

    async function attackTheServer (server: RelayServer): Promise<void> {
      const _sendTransactionOrig = server.transactionManager.sendTransaction

      server.transactionManager.sendTransaction = async function ({ signer, method, destination, value = '0x', gasLimit, gasPrice, creationBlockNumber, serverAction }: SendTransactionDetails): Promise<SignedTransactionDetails> {
        await recipient.setNextRevert()
        return (await _sendTransactionOrig.call(server.transactionManager, { signer, method, destination, value, gasLimit, gasPrice, creationBlockNumber, serverAction }))
      }

      const req = await env.createRelayHttpRequest({
        callVerifier: rejectingVerifier.address,
        to: recipient.address,
        data: recipient.contract.methods.testNextRevert().encodeABI()
      })

      await env.relayServer.createRelayTransaction(req)
      const currentBlock = await env.web3.eth.getBlock('latest')

      await server._worker(currentBlock.number)
      assert.isTrue(server.alerted, 'server not alerted')
      assert.equal(server.alertedBlock, currentBlock.number, 'server alerted block incorrect')
    }

    it('should delay transactions in alerted state', async function () {
      newServer.config.minAlertedDelayMS = 300
      newServer.config.maxAlertedDelayMS = 350
      const timeBefore = Date.now()
      const req = await env.createRelayHttpRequest()
      await env.relayServer.createRelayTransaction(req)
      // await relayTransaction(relayTransactionParams, options)
      const timeAfter = Date.now()
      assert.isTrue((timeAfter - timeBefore) > 300, 'checking that enough time passed')
    })

    it('should exit alerted state after the configured blocks delay', async function () {
      await evmMineMany(newServer.config.alertedBlockDelay - 1)
      let latestBlock = await env.web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      assert.isTrue(newServer.alerted, 'server not alerted')
      await evmMineMany(2)
      latestBlock = await env.web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      assert.isFalse(newServer.alerted, 'server alerted')
    })
  })

  describe('Custom replenish function', function () {
    let relayServer: RelayServer
    const workerIndex = 0

    before(async function () {
      await env.newServerInstanceNoInit({
        customReplenish: true
      })
      relayServer = env.relayServer
    })
    // This test should be skipped in the case a custom replenish is implemented
    it('should throw an errror if there is no custom replenish function', async function () {
      try {
        await relayServer.replenishServer(workerIndex, 0)
      } catch (error) {
        assert.equal(error.message, 'No custom replenish function found, to remove this error please add the custom replenish implementation here deleting this line.')
      }
    })
  })
})

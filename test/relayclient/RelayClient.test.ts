import Transaction from 'ethereumjs-tx/dist/transaction'
import Web3 from 'web3'
import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'
import express from 'express'
import axios from 'axios'
// @ts-ignore
import abiDecoder from 'abi-decoder'

import {
  RelayHubInstance,
  TestRecipientInstance,
  SmartWalletInstance, SmartWalletFactoryInstance, TestTokenInstance, TestVerifierEverythingAcceptedInstance, TestDeployVerifierEverythingAcceptedInstance
} from '../../types/truffle-contracts'

import { DeployRequest } from '../../src/common/EIP712/RelayRequest'
import { _dumpRelayingResult, RelayClient } from '../../src/relayclient/RelayClient'
import { Address } from '../../src/relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'
import { configure, getDependencies, EnvelopingConfig } from '../../src/relayclient/Configurator'
import replaceErrors from '../../src/common/ErrorReplacerJSON'
import EnvelopingTransactionDetails from '../../src/relayclient/types/EnvelopingTransactionDetails'

import BadHttpClient from '../dummies/BadHttpClient'
import BadContractInteractor from '../dummies/BadContractInteractor'
import BadRelayedTransactionValidator from '../dummies/BadRelayedTransactionValidator'
import { stripHex, deployHub, startRelay, stopRelay, getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount, snapshot, revert, INCORRECT_ECDSA_SIGNATURE } from '../TestUtils'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import PingResponse from '../../src/common/PingResponse'
import { RelayEvent } from '../../src/relayclient/RelayEvents'
import { Web3Provider } from '../../src/common/ContractInteractor'
import bodyParser from 'body-parser'
import { Server } from 'http'
import HttpClient from '../../src/relayclient/HttpClient'
import HttpWrapper from '../../src/relayclient/HttpWrapper'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { toBN, toHex } from 'web3-utils'
import { constants } from '../../src/common/Constants'
import { getDomainSeparatorHash, TypedDeployRequestData } from '../../src/common/EIP712/TypedRequestData'
import { ether } from '@openzeppelin/test-helpers'
import { Commitment, CommitmentReceipt, CommitmentResponse } from '../../src/enveloping/Commitment'
import { MockCommitmentValidator } from '../dummies/MockCommitmentValidator'

const TestRecipient = artifacts.require('TestRecipient')
const TestRelayVerifier = artifacts.require('TestVerifierEverythingAccepted')
const TestDeployVerifier = artifacts.require('TestDeployVerifierEverythingAccepted')
const SmartWallet = artifacts.require('SmartWallet')
const TestToken = artifacts.require('TestToken')
const RelayHub = artifacts.require('RelayHub')
const SmartWalletFactory = artifacts.require('SmartWalletFactory')
// @ts-ignore
abiDecoder.addABI(RelayHub.abi)
// @ts-ignore
abiDecoder.addABI(SmartWalletFactory.abi)

const expect = chai.expect
chai.use(sinonChai)

const localhostOne = 'http://localhost:8090'
const cheapRelayerUrl = 'http://localhost:54321'
const underlyingProvider = web3.currentProvider as HttpProvider

class MockHttpClient extends HttpClient {
  constructor (readonly mockPort: number,
    httpWrapper: HttpWrapper, config: Partial<EnvelopingConfig>) {
    super(httpWrapper, config)
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<CommitmentResponse> {
    return await super.relayTransaction(this.mapUrl(relayUrl), request)
  }

  private mapUrl (relayUrl: string): string {
    return relayUrl.replace(':8090', `:${this.mockPort}`)
  }
}

const gasOptions = [
  {
    title: 'with gas estimation',
    estimateGas: true
  },
  {
    title: 'with hardcoded gas',
    estimateGas: false
  }
]

gasOptions.forEach(gasOption => {
  contract(`RelayClient with ${gasOption.title}`, function (accounts) {
    let web3: Web3
    let relayHub: RelayHubInstance
    let testRecipient: TestRecipientInstance
    let relayVerifier: TestVerifierEverythingAcceptedInstance
    let deployVerifier: TestDeployVerifierEverythingAcceptedInstance
    let relayProcess: ChildProcessWithoutNullStreams
    let relayClient: RelayClient
    let config: Partial<EnvelopingConfig>
    let options: EnvelopingTransactionDetails
    let to: Address
    let from: Address
    let data: PrefixedHexString
    let relayEvents: RelayEvent[] = []
    let factory: SmartWalletFactoryInstance
    let sWalletTemplate: SmartWalletInstance
    let smartWallet: SmartWalletInstance
    let token: TestTokenInstance
    let gaslessAccount: AccountKeypair
    let relayWorker: Address

    async function registerRelayer (relayHub: RelayHubInstance): Promise<void> {
      const relayWorker = '0x'.padEnd(42, '2')
      const relayOwner = accounts[3]
      const relayManager = accounts[4]
      await relayHub.stakeForAddress(relayManager, 1000, {
        value: ether('2'),
        from: relayOwner
      })

      await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
      await relayHub.registerRelayServer(cheapRelayerUrl, { from: relayManager })
    }

    before(async function () {
      web3 = new Web3(underlyingProvider)
      relayHub = await deployHub()
      testRecipient = await TestRecipient.new()
      sWalletTemplate = await SmartWallet.new()
      token = await TestToken.new()
      const env = (await getTestingEnvironment())

      gaslessAccount = await getGaslessAccount()
      factory = await createSmartWalletFactory(sWalletTemplate)
      smartWallet = await createSmartWallet(accounts[0], gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)
      relayVerifier = await TestRelayVerifier.new()
      deployVerifier = await TestDeployVerifier.new()

      const startRelayResult = await startRelay(relayHub, {
        stake: 1e18,
        relayOwner: accounts[1],
        rskNodeUrl: underlyingProvider.host,
        deployVerifierAddress: deployVerifier.address,
        relayVerifierAddress: relayVerifier.address,
        workerMinBalance: 0.01e18,
        workerTargetBalance: 0.03e18,
        managerMinBalance: 0.01e18,
        managerTargetBalance: 0.03e18
      })

      relayWorker = accounts[2]
      const relayOwner = accounts[3]
      const relayManager = accounts[4]
      await relayHub.stakeForAddress(relayManager, 1000, {
        value: ether('2'),
        from: relayOwner
      })

      await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
      // await relayHub.registerRelayServer(cheapRelayerUrl, { from: relayManager })

      relayProcess = startRelayResult.proc

      config = {
        logLevel: 5,
        relayHubAddress: relayHub.address,
        chainId: env.chainId,
        deployVerifierAddress: deployVerifier.address,
        relayVerifierAddress: relayVerifier.address
      }

      relayClient = new RelayClient(underlyingProvider, config)

      // register gasless account in RelayClient to avoid signing with RSKJ
      relayClient.accountManager.addAccount(gaslessAccount)

      from = gaslessAccount.address
      to = testRecipient.address
      await token.mint('1000', smartWallet.address)

      data = testRecipient.contract.methods.emitMessage('hello world').encodeABI()

      options = {
        from,
        to,
        data,
        relayHub: relayHub.address,
        callForwarder: smartWallet.address,
        callVerifier: relayVerifier.address,
        clientId: '1',
        tokenContract: token.address,
        tokenAmount: '1',
        isSmartWalletDeploy: false
      }

      if (!gasOption.estimateGas) {
        options.tokenGas = '50000'
      }
    })

    after(async function () {
      await stopRelay(relayProcess)
    })

    describe('#relayTransaction()', function () {
      it('should send transaction to a relay and receive a signed transaction in response', async function () {
        const relayingResult = await relayClient.relayTransaction(options)
        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          assert.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash(true).toString('hex')
        const txHash = `0x${validTransactionHash}`
        const res = await web3.eth.getTransactionReceipt(txHash)

        // validate we've got the "SampleRecipientEmitted" event
        // TODO: use OZ test helpers
        const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,uint256,uint256)') ?? ''
        assert(res.logs.find(log => log.topics.includes(topic)))

        const destination: string = validTransaction.to.toString('hex')
        assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())
      })

      it('should skip timed-out server', async function () {
        let server: Server | undefined
        try {
          const pingResponse = await axios.get('http://localhost:8090/getaddr').then(res => res.data)
          const mockServer = express()
          mockServer.use(bodyParser.urlencoded({ extended: false }))
          mockServer.use(bodyParser.json())

          /* eslint-disable @typescript-eslint/no-misused-promises */
          mockServer.get('/getaddr', async (req, res) => {
            console.log('=== got GET ping', req.query)
            res.send(pingResponse)
          })
          /* eslint-enable */

          mockServer.post('/relay', () => {
            console.log('== got relay.. ignoring')
            // don't answer... keeping client in limbo
          })

          await new Promise((resolve) => {
            // @ts-ignore
            server = mockServer.listen(0, () => resolve(true))
          })
          const mockServerPort = (server as any).address().port

          // MockHttpClient alter the server port, so the client "thinks" it works with relayUrl, but actually
          // it uses the mockServer's port
          const relayClient = new RelayClient(underlyingProvider, config, {
            httpClient: new MockHttpClient(mockServerPort, new HttpWrapper({ timeout: 100 }), config)
          })

          // register gasless account in RelayClient to avoid signing with RSKJ
          relayClient.accountManager.addAccount(gaslessAccount)

          // async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<PrefixedHexString> {
          const relayingResult = await relayClient.relayTransaction(options)
          assert.match(_dumpRelayingResult(relayingResult), /timeout.*exceeded/)
        } finally {
          server?.close()
        }
      })

      it('should use forceGasPrice if provided', async function () {
        const forceGasPrice = '0x777777777'
        const optionsForceGas = Object.assign({}, options, { forceGasPrice })
        const { transaction, pingErrors, relayingErrors } = await relayClient.relayTransaction(optionsForceGas)
        assert.equal(pingErrors.size, 0, 'Ping Errors list is not empty')
        assert.equal(relayingErrors.size, 0, 'Relaying Errors list is not empy')
        assert.equal(parseInt(transaction!.gasPrice.toString('hex'), 16), parseInt(forceGasPrice))
      })

      it('should return errors encountered in ping', async function () {
        const badHttpClient = new BadHttpClient(configure(config), true, false, false)
        const relayClient =
          new RelayClient(underlyingProvider, config, { httpClient: badHttpClient })
        const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
        assert.isUndefined(transaction)
        assert.equal(relayingErrors.size, 0)
        assert.equal(pingErrors.size, 1)
        assert.equal(pingErrors.get(localhostOne)!.message, BadHttpClient.message)
      })

      it('should return errors encountered in relaying', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, true, false)
        const relayClient =
          new RelayClient(underlyingProvider, config, { httpClient: badHttpClient })

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
        assert.isUndefined(transaction)
        assert.equal(pingErrors.size, 0)
        assert.equal(relayingErrors.size, 1)
        assert.equal(relayingErrors.get(localhostOne)!.message, BadHttpClient.message)
      })

      // TODO test other things, for example, if the smart wallet to deploy has no funds, etc
      // Do we want to restrict to certnain factories?

      it('should calculate the estimatedGas for deploying a SmartWallet using the SmartWalletFactory', async function () {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()
        // register eoaWithoutSmartWalletAccount account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(eoaWithoutSmartWalletAccount)
        const swAddress = await factory.getSmartWalletAddress(eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0')
        await token.mint('1000', swAddress)

        const details: EnvelopingTransactionDetails = {
          from: eoaWithoutSmartWalletAccount.address,
          to: constants.ZERO_ADDRESS, // No extra logic for the Smart Wallet
          data: '0x', // No extra-logic init data
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
          clientId: '1',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: gasOption.estimateGas ? undefined : '50000',
          recoverer: constants.ZERO_ADDRESS,
          index: '0',
          gasPrice: '1',
          gas: '0x00',
          value: '0',
          isSmartWalletDeploy: true,
          useEnveloping: true,
          relayHub: relayHub.address,
          smartWalletAddress: swAddress
        }

        const tokenPaymentEstimate = await relayClient.estimateTokenTransferGas(details, relayWorker)
        const testRequest = await relayClient._prepareFactoryGasEstimationRequest(details, relayWorker, Date.now() + (300 * 1000))
        const estimatedGasResultWithoutTokenPayment = await relayClient.calculateDeployCallGas(testRequest)

        const originalBalance = await token.balanceOf(swAddress)
        const senderNonce = await factory.nonce(eoaWithoutSmartWalletAccount.address)
        const chainId = (await getTestingEnvironment()).chainId

        const request: DeployRequest = {
          request: {
            relayHub: relayHub.address,
            from: eoaWithoutSmartWalletAccount.address,
            to: constants.ZERO_ADDRESS,
            value: '0',
            nonce: senderNonce.toString(),
            data: '0x',
            tokenContract: token.address,
            tokenAmount: '1',
            tokenGas: tokenPaymentEstimate.toString(),
            recoverer: constants.ZERO_ADDRESS,
            index: '0'
          },
          relayData: {
            gasPrice: '1',
            relayWorker: relayWorker,
            callForwarder: factory.address,
            callVerifier: deployVerifier.address,
            domainSeparator: getDomainSeparatorHash(factory.address, chainId)
          }
        }
        const dataToSign = new TypedDeployRequestData(
          chainId,
          factory.address,
          request
        )

        const sig = relayClient.accountManager._signWithControlledKey(eoaWithoutSmartWalletAccount, dataToSign)

        const txResponse = await relayHub.deployCall(request, sig, {
          from: relayWorker,
          gasPrice: '1',
          gas: 4e6
        })

        const salt = web3.utils.soliditySha3(
          { t: 'address', v: eoaWithoutSmartWalletAccount.address },
          { t: 'address', v: constants.ZERO_ADDRESS },
          { t: 'uint256', v: '0' }
        ) ?? ''

        const expectedSalt = web3.utils.toBN(salt).toString()

        const actualGasUsed: number = txResponse.receipt.cumulativeGasUsed
        const receipt = await web3.eth.getTransactionReceipt(txResponse.tx)

        const logs = abiDecoder.decodeLogs(receipt.logs)

        const deployedEvent = logs.find((e: any) => e != null && e.name === 'Deployed')
        assert.equal(swAddress.toLowerCase(), deployedEvent.events[0].value.toLowerCase())
        assert.equal(expectedSalt.toLowerCase(), deployedEvent.events[1].value.toLowerCase())

        // The Smart Wallet should have been charged for the deploy
        const newBalance = await token.balanceOf(swAddress)
        const expectedBalance = originalBalance.sub(web3.utils.toBN('1'))
        chai.expect(expectedBalance, 'Deployment not paid').to.be.bignumber.equal(newBalance)

        const tenPercertGasCushion = actualGasUsed * 0.1
        const highActual = actualGasUsed + tenPercertGasCushion
        const lowActual = actualGasUsed - tenPercertGasCushion

        const estimatedGasResult = estimatedGasResultWithoutTokenPayment + tokenPaymentEstimate
        assert.isTrue(estimatedGasResult === actualGasUsed ||
          ((lowActual <= estimatedGasResult) && (highActual >= estimatedGasResult)), 'Incorrect estimated gas')
      })

      it('should relay properly with token transfer and relay gas estimations used', async function () {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()

        // register eoaWithoutSmartWallet account to avoid signing with RSKJ
        relayClient.accountManager.addAccount(eoaWithoutSmartWalletAccount)
        const swAddress = await factory.getSmartWalletAddress(eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0')

        const deployOptions: EnvelopingTransactionDetails = {
          from: eoaWithoutSmartWalletAccount.address,
          to: constants.ZERO_ADDRESS, // No extra logic for the Smart Wallet
          data: '0x', // No extra-logic init data
          gas: '0x1E8480',
          relayHub: relayHub.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
          clientId: '1',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: gasOption.estimateGas ? undefined : '50000',
          isSmartWalletDeploy: true,
          recoverer: constants.ZERO_ADDRESS,
          smartWalletAddress: swAddress,
          index: '0'
        }

        await token.mint('1000', swAddress)

        assert.equal(await web3.eth.getCode(swAddress), '0x', 'SmartWallet not yet deployed, it must not have installed code')

        const result = await relayClient.relayTransaction(deployOptions)
        const senderAddress = `0x${result.transaction?.getSenderAddress().toString('hex')}`
        const senderTokenInitialBalance = await token.balanceOf(senderAddress)
        assert.notEqual(senderAddress, constants.ZERO_ADDRESS)
        assert.notEqual(await web3.eth.getCode(swAddress), '0x', 'SmartWalletdeployed, it must have installed code')

        const relayOptions = {
          from: eoaWithoutSmartWalletAccount.address,
          to: options.to,
          data: options.data,
          relayHub: options.relayHub,
          callForwarder: swAddress,
          callVerifier: options.callVerifier,
          clientId: options.clientId,
          tokenContract: options.tokenContract, // tokenGas is skipped, also smartWalletAddress is not needed since is the forwarder
          tokenAmount: '1',
          isSmartWalletDeploy: false
        }

        const relayingResult = await relayClient.relayTransaction(relayOptions)
        const senderAddressRelay = `0x${relayingResult.transaction?.getSenderAddress().toString('hex')}`
        const senderTokenFinalBalance = await token.balanceOf(senderAddressRelay)

        assert.notEqual(senderAddressRelay, '0xundefined')
        assert.equal(senderAddress, senderAddressRelay)
        assert.equal(senderTokenInitialBalance.toString(), senderTokenFinalBalance.sub(toBN('1')).toString())

        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          assert.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash(true).toString('hex')
        const txHash = `0x${validTransactionHash}`
        const res = await web3.eth.getTransactionReceipt(txHash)

        // validate we've got the "SampleRecipientEmitted" event
        // TODO: use OZ test helpers
        const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,uint256,uint256)') ?? ''
        assert(res.logs.find(log => log.topics.includes(topic)))

        const destination: string = validTransaction.to.toString('hex')
        assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())
      })

      it('should fail if a deploy without tokenGas and smartwallet is attempted', async function () {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()

        // register eoaWithoutSmartWallet account to avoid signing with RSKJ
        relayClient.accountManager.addAccount(eoaWithoutSmartWalletAccount)

        const deployOptions: EnvelopingTransactionDetails = {
          from: eoaWithoutSmartWalletAccount.address,
          to: constants.ZERO_ADDRESS, // No extra logic for the Smart Wallet
          data: '0x', // No extra-logic init data
          gas: '0x1E8480',
          relayHub: relayHub.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
          clientId: '1',
          tokenContract: token.address,
          tokenAmount: '1',
          // tokenGas: '50000', omitted so it is calculated
          isSmartWalletDeploy: true,
          recoverer: constants.ZERO_ADDRESS,
          index: '0'
        }

        const swAddress = await factory.getSmartWalletAddress(eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0')
        await token.mint('1000', swAddress)
        // deployOptions.smartWalletAddress = swAddress  --> The client cannot tell who is the token sender so it cannot estimate the token transfer.
        // calculating the address in the client is not an option because the factory used is not in control of the client (a thus, the method to calculate it, which is not unique)

        assert.equal(await web3.eth.getCode(swAddress), '0x', 'SmartWallet not yet deployed, it must not have installed code')

        try {
          await relayClient.relayTransaction(deployOptions)
        } catch (error) {
          assert.equal(error.message, 'In a deploy, if tokenGas is not defined, then the calculated SmartWallet address is needed to estimate the tokenGas value')
        }
      })

      it('should relay properly with full gas estimation used when token balance ends in zero', async function () {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()

        // register eoaWithoutSmartWallet account to avoid signing with RSKJ
        relayClient.accountManager.addAccount(eoaWithoutSmartWalletAccount)

        const swAddress = await factory.getSmartWalletAddress(eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0')

        const deployOptions: EnvelopingTransactionDetails = {
          from: eoaWithoutSmartWalletAccount.address,
          to: constants.ZERO_ADDRESS, // No extra logic for the Smart Wallet
          data: '0x', // No extra-logic init data
          gas: '0x1E8480',
          relayHub: relayHub.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
          clientId: '1',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: gasOption.estimateGas ? undefined : '55000',
          isSmartWalletDeploy: true,
          recoverer: constants.ZERO_ADDRESS,
          index: '0',
          smartWalletAddress: swAddress
        }

        await token.mint('1000', swAddress)

        assert.equal(await web3.eth.getCode(swAddress), '0x', 'SmartWallet not yet deployed, it must not have installed code')

        const result = await relayClient.relayTransaction(deployOptions)
        const senderAddress = `0x${result.transaction?.getSenderAddress().toString('hex')}`
        const senderTokenInitialBalance = await token.balanceOf(senderAddress)
        assert.notEqual(senderAddress, constants.ZERO_ADDRESS)
        assert.notEqual(await web3.eth.getCode(swAddress), '0x', 'SmartWalletdeployed, it must have installed code')

        const balanceToTransfer = await token.balanceOf(swAddress)

        const relayOptions = {
          from: eoaWithoutSmartWalletAccount.address,
          to: options.to,
          data: options.data,
          relayHub: options.relayHub,
          callForwarder: swAddress,
          callVerifier: options.callVerifier,
          clientId: options.clientId,
          tokenContract: options.tokenContract, // tokenGas is skipped, also smartWalletAddress is not needed since is the forwarder
          tokenAmount: balanceToTransfer.toString(),
          isSmartWalletDeploy: false
        }

        const relayingResult = await relayClient.relayTransaction(relayOptions)
        const senderAddressRelay = `0x${relayingResult.transaction?.getSenderAddress().toString('hex')}`
        const senderTokenFinalBalance = await token.balanceOf(senderAddressRelay)

        assert.notEqual(senderAddressRelay, '0xundefined')
        assert.equal(senderAddress, senderAddressRelay)
        assert.equal(senderTokenInitialBalance.toString(), senderTokenFinalBalance.sub(balanceToTransfer).toString())

        const sWalletFinalBalance = await token.balanceOf(swAddress)
        assert.isTrue(sWalletFinalBalance.eq(toBN(0)), 'SW Final balance must be zero')

        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          assert.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash(true).toString('hex')
        const txHash = `0x${validTransactionHash}`
        const res = await web3.eth.getTransactionReceipt(txHash)

        // validate we've got the "SampleRecipientEmitted" event
        // TODO: use OZ test helpers
        const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,uint256,uint256)') ?? ''
        assert(res.logs.find(log => log.topics.includes(topic)))

        const destination: string = validTransaction.to.toString('hex')
        assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())
      })
      it('should deploy properly with token transfer gas estimation used', async function () {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()

        // register eoaWithoutSmartWallet account to avoid signing with RSKJ
        relayClient.accountManager.addAccount(eoaWithoutSmartWalletAccount)

        const deployOptions: EnvelopingTransactionDetails = {
          from: eoaWithoutSmartWalletAccount.address,
          to: constants.ZERO_ADDRESS, // No extra logic for the Smart Wallet
          data: '0x', // No extra-logic init data
          gas: gasOption.estimateGas ? undefined : '0x1E8480',
          relayHub: relayHub.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
          clientId: '1',
          tokenContract: token.address,
          tokenAmount: '1',
          // tokenGas: '50000', omitted so it is calculated
          isSmartWalletDeploy: true,
          recoverer: constants.ZERO_ADDRESS,
          index: '0'
        }

        const swAddress = (await factory.getSmartWalletAddress(eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0')).toLowerCase()
        await token.mint('1000', swAddress)
        deployOptions.smartWalletAddress = swAddress

        assert.equal(await web3.eth.getCode(swAddress), '0x', 'SmartWallet not yet deployed, it must not have installed code')

        const relayingResult = await relayClient.relayTransaction(deployOptions)
        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          assert.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash(true).toString('hex')
        const txHash = `0x${validTransactionHash}`
        const res = await web3.eth.getTransactionReceipt(txHash)
        // validate we've got the "Deployed" event

        const topic: string = web3.utils.sha3('Deployed(address,uint256)') ?? ''
        assert.notEqual(topic, '', 'error while calculating topic')

        assert(res.logs.find(log => log.topics.includes(topic)))
        const eventIdx = res.logs.findIndex(log => log.topics.includes(topic))
        const loggedEvent = res.logs[eventIdx]

        const strippedAddr = stripHex(swAddress)
        assert(loggedEvent.topics.find(data => data.slice(26, data.length).includes(strippedAddr)))
        let eventSWAddress = loggedEvent.topics[loggedEvent.topics.findIndex(data => data.slice(26, data.length).includes(strippedAddr))]
        eventSWAddress = '0x'.concat(eventSWAddress.slice(26, eventSWAddress.length).toLowerCase())

        const saltSha = web3.utils.soliditySha3(
          { t: 'address', v: eoaWithoutSmartWalletAccount.address },
          { t: 'address', v: constants.ZERO_ADDRESS },
          { t: 'uint256', v: '0' }
        ) ?? ''

        assert.notEqual(saltSha, '', 'error while calculating salt')

        const expectedSalt = web3.utils.toBN(saltSha).toString()

        const obtainedEventData = web3.eth.abi.decodeParameters([{ type: 'uint256', name: 'salt' }], loggedEvent.data)

        assert.equal(obtainedEventData.salt, expectedSalt, 'salt from Deployed event is not the expected one')
        assert.equal(eventSWAddress, swAddress, 'SmartWallet address from the Deployed event is not the expected one')

        const destination: string = validTransaction.to.toString('hex')
        assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())

        let expectedCode = await factory.getCreationBytecode()
        expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)// only runtime code
        assert.equal(await web3.eth.getCode(swAddress), expectedCode, 'The installed code is not the expected one')
      })

      it('should send a SmartWallet create transaction to a relay and receive a signed transaction in response', async function () {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()

        // register eoaWithoutSmartWallet account to avoid signing with RSKJ
        relayClient.accountManager.addAccount(eoaWithoutSmartWalletAccount)
        const swAddress = (await factory.getSmartWalletAddress(eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0')).toLowerCase()

        const deployOptions: EnvelopingTransactionDetails = {
          from: eoaWithoutSmartWalletAccount.address,
          to: constants.ZERO_ADDRESS, // No extra logic for the Smart Wallet
          data: '0x', // No extra-logic init data
          gas: gasOption.estimateGas ? undefined : '0x1E8480',
          relayHub: relayHub.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
          clientId: '1',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: gasOption.estimateGas ? undefined : '50000',
          isSmartWalletDeploy: true,
          recoverer: constants.ZERO_ADDRESS,
          index: '0',
          smartWalletAddress: swAddress
        }

        await token.mint('1000', swAddress)

        assert.equal(await web3.eth.getCode(swAddress), '0x', 'SmartWallet not yet deployed, it must not have installed code')

        const relayingResult = await relayClient.relayTransaction(deployOptions)
        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          assert.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash(true).toString('hex')
        const txHash = `0x${validTransactionHash}`
        const res = await web3.eth.getTransactionReceipt(txHash)
        // validate we've got the "Deployed" event

        const topic: string = web3.utils.sha3('Deployed(address,uint256)') ?? ''
        assert.notEqual(topic, '', 'error while calculating topic')

        assert(res.logs.find(log => log.topics.includes(topic)))
        const eventIdx = res.logs.findIndex(log => log.topics.includes(topic))
        const loggedEvent = res.logs[eventIdx]

        const strippedAddr = stripHex(swAddress)
        assert(loggedEvent.topics.find(data => data.slice(26, data.length).includes(strippedAddr)))
        let eventSWAddress = loggedEvent.topics[loggedEvent.topics.findIndex(data => data.slice(26, data.length).includes(strippedAddr))]
        eventSWAddress = '0x'.concat(eventSWAddress.slice(26, eventSWAddress.length).toLowerCase())

        const saltSha = web3.utils.soliditySha3(
          { t: 'address', v: eoaWithoutSmartWalletAccount.address },
          { t: 'address', v: constants.ZERO_ADDRESS },
          { t: 'uint256', v: '0' }
        ) ?? ''

        assert.notEqual(saltSha, '', 'error while calculating salt')

        const expectedSalt = web3.utils.toBN(saltSha).toString()

        const obtainedEventData = web3.eth.abi.decodeParameters([{ type: 'uint256', name: 'salt' }], loggedEvent.data)

        assert.equal(obtainedEventData.salt, expectedSalt, 'salt from Deployed event is not the expected one')
        assert.equal(eventSWAddress, swAddress, 'SmartWallet address from the Deployed event is not the expected one')

        const destination: string = validTransaction.to.toString('hex')
        assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())

        let expectedCode = await factory.getCreationBytecode()
        expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)// only runtime code
        assert.equal(await web3.eth.getCode(swAddress), expectedCode, 'The installed code is not the expected one')
      })

      describe('with events listener', () => {
        function eventsHandler (e: RelayEvent): void {
          relayEvents.push(e)
        }

        before('registerEventsListener', () => {
          relayClient = new RelayClient(underlyingProvider, config)
          relayClient.registerEventListener(eventsHandler)

          // register gaslessAccount account to avoid signing with RSKJ
          relayClient.accountManager.addAccount(gaslessAccount)
        })
        it('should call events handler', async function () {
          await relayClient.relayTransaction(options)
          assert.equal(relayEvents.length, 8)
          assert.equal(relayEvents[0].step, 0)
          assert.equal(relayEvents[0].total, 8)
          assert.equal(relayEvents[7].step, 7)
        })
        describe('removing events listener', () => {
          before('registerEventsListener', () => {
            relayEvents = []
            relayClient.unregisterEventListener(eventsHandler)
          })
          it('should call events handler', async function () {
            await relayClient.relayTransaction(options)
            assert.equal(relayEvents.length, 0)
          })
        })
      })
    })

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    describe('#_calculateDefaultGasPrice()', function () {
      it('should use minimum gas price if calculated is to low', async function () {
        const minGasPrice = 1e18
        const config: Partial<EnvelopingConfig> = {
          logLevel: 5,
          relayHubAddress: relayHub.address,
          minGasPrice,
          chainId: (await getTestingEnvironment()).chainId
        }
        const relayClient = new RelayClient(underlyingProvider, config)
        const calculatedGasPrice = await relayClient._calculateGasPrice()
        assert.equal(calculatedGasPrice, `0x${minGasPrice.toString(16)}`)
      })
    })

    describe('#_attemptRelay()', function () {
      const relayUrl = localhostOne
      const relayWorkerAddress = accounts[1]
      const relayManager = accounts[2]
      const relayOwner = accounts[3]
      let pingResponse: PingResponse
      let relayInfo: RelayInfo
      let optionsWithGas: EnvelopingTransactionDetails
      let maxTime: number
      let badCommitmentReceipt: CommitmentReceipt

      before(async function () {
        await relayHub.stakeForAddress(relayManager, 7 * 24 * 3600, {
          from: relayOwner,
          value: (2e18).toString()
        })
        await relayHub.addRelayWorkers([relayWorkerAddress], { from: relayManager })
        await relayHub.registerRelayServer('url', { from: relayManager })
        pingResponse = {
          relayWorkerAddress: relayWorkerAddress,
          relayManagerAddress: relayManager,
          relayHubAddress: relayManager,
          maxDelay: Date.now() + (300 * 1000),
          minGasPrice: '',
          ready: true,
          version: ''
        }
        relayInfo = {
          relayInfo: {
            relayManager,
            relayUrl
          },
          pingResponse
        }

        let gasToSend = await web3.eth.estimateGas({
          from: options.callForwarder,
          to: options.to,
          gasPrice: toHex('6000000000'),
          data: options.data
        })

        gasToSend = gasToSend > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION ? gasToSend - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION : gasToSend

        optionsWithGas = Object.assign({}, options, {
          gas: toHex(gasToSend),
          gasPrice: toHex('6000000000')
        })

        const commitment = new Commitment(
          pingResponse.maxDelay,
          from,
          to,
          data,
          relayHub.address,
          relayWorkerAddress,
          'false'
        )
        badCommitmentReceipt = {
          commitment: commitment,
          workerSignature: INCORRECT_ECDSA_SIGNATURE,
          workerAddress: relayWorkerAddress
        }
      })

      it('should return error if view call to \'relayCall()\' fails', async function () {
        const badContractInteractor = new BadContractInteractor(web3.currentProvider as Web3Provider, configure(config), true)
        const relayClient =
          new RelayClient(underlyingProvider, config, { contractInteractor: badContractInteractor })
        await relayClient._init()

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)
        const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas, maxTime)
        assert.isUndefined(transaction)
        assert.equal(error!.message, `local view call reverted: ${BadContractInteractor.message}`)
      })

      it('should report relays that timeout to the Known Relays Manager', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, false, true)
        const dependencyTree = getDependencies(configure(config), underlyingProvider, { httpClient: badHttpClient })
        const relayClient =
          new RelayClient(underlyingProvider, config, dependencyTree)
        await relayClient._init()

        const tokenGas = (gasOption.estimateGas ? (await relayClient.estimateTokenTransferGas(options, relayWorkerAddress)).toString() : options.tokenGas)

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
        sinon.spy(dependencyTree.knownRelaysManager)
        const attempt = await relayClient._attemptRelay(relayInfo, Object.assign({}, optionsWithGas, {
          tokenGas
        }), maxTime)
        assert.equal(attempt.error?.message, 'some error describing how timeout occurred somewhere')
        expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
      })

      it('should not report relays if error is not timeout', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, true, false)
        const dependencyTree = getDependencies(configure(config), underlyingProvider, { httpClient: badHttpClient })
        dependencyTree.httpClient = badHttpClient
        const relayClient =
          new RelayClient(underlyingProvider, config, dependencyTree)
        await relayClient._init()

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
        sinon.spy(dependencyTree.knownRelaysManager)
        await relayClient._attemptRelay(relayInfo, optionsWithGas, maxTime)
        expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.not.been.called
      })

      it('should return error if transaction returned by a relay does not pass validation', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, false, false, pingResponse, '0x123')
        let dependencyTree = getDependencies(configure(config), underlyingProvider)
        const badTransactionValidator = new BadRelayedTransactionValidator(true, dependencyTree.contractInteractor, configure(config))
        const mockCommitmentValidator = new MockCommitmentValidator(true)
        dependencyTree = getDependencies(configure(config), underlyingProvider, {
          httpClient: badHttpClient,
          transactionValidator: badTransactionValidator,
          commitmentValidator: mockCommitmentValidator
        })
        const relayClient =
          new RelayClient(underlyingProvider, config, dependencyTree)

        await relayClient._init()

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
        sinon.spy(dependencyTree.knownRelaysManager)
        const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas, maxTime)
        assert.isUndefined(transaction)
        assert.equal(error!.message, 'Returned transaction did not pass validation')
        expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
      })

      it('should return error if commitment receipt returned by a relay does not pass validation', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, false, false, pingResponse, '0x123', badCommitmentReceipt)
        const dependencyTree = getDependencies(configure(config), underlyingProvider, {
          httpClient: badHttpClient
        })
        const relayClient = new RelayClient(underlyingProvider, config, dependencyTree)
        await relayClient._init()

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
        sinon.spy(dependencyTree.knownRelaysManager)
        const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas, maxTime)
        assert.isUndefined(transaction)
        assert.equal(error!.message, 'Returned commitment did not pass validation')
        expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
      })
    })

    describe('#_broadcastRawTx()', function () {
      // TODO: TBD: there has to be other behavior then that. Maybe query the transaction with the nonce somehow?
      it('should return \'wrongNonce\' if broadcast fails with nonce error', async function () {
        const badContractInteractor = new BadContractInteractor(underlyingProvider, configure(config), true)
        const transaction = new Transaction('0x')
        const relayClient =
          new RelayClient(underlyingProvider, config, { contractInteractor: badContractInteractor })
        const { hasReceipt, wrongNonce, broadcastError } = await relayClient._broadcastRawTx(transaction)
        assert.isFalse(hasReceipt)
        assert.isTrue(wrongNonce)
        assert.equal(broadcastError?.message, BadContractInteractor.wrongNonceMessage)
      })
    })

    describe('multiple relayers', () => {
      let id: string
      before(async () => {
        id = (await snapshot()).result
        await registerRelayer(relayHub)
      })
      after(async () => {
        await revert(id)
      })

      it('should succeed to relay, but report ping error', async () => {
        const relayingResult = await relayClient.relayTransaction(options)
        assert.isNotNull(relayingResult.transaction)
        assert.match(relayingResult.pingErrors.get(cheapRelayerUrl)?.message as string, /ECONNREFUSED/,
          `relayResult: ${_dumpRelayingResult(relayingResult)}`)
      })

      it('use preferred relay if one is set', async () => {
        relayClient = new RelayClient(underlyingProvider, {
          preferredRelays: ['http://localhost:8090'],
          ...config
        })

        relayClient.accountManager.addAccount(gaslessAccount)

        const relayingResult = await relayClient.relayTransaction(options)
        assert.isNotNull(relayingResult.transaction)
        assert.equal(relayingResult.pingErrors.size, 0)

        console.log(relayingResult)
      })
    })
  })
})

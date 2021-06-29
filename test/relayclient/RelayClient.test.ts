import chai, { expect } from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { ChildProcessWithoutNullStreams } from 'child_process'
import express from 'express'
import axios from 'axios'
import { DeployRequest } from '../../src/common/EIP712/RelayRequest'
import { _dumpRelayingResult, RelayClient } from '../../src/relayclient/RelayClient'
import { Address, PrefixedHexString } from '../../src/relayclient/types/Aliases'
import { configure, getDependencies, EnvelopingConfig } from '../../src/relayclient/Configurator'
import replaceErrors from '../../src/common/ErrorReplacerJSON'
import EnvelopingTransactionDetails from '../../src/relayclient/types/EnvelopingTransactionDetails'
import BadHttpClient from '../dummies/BadHttpClient'
import BadContractInteractor from '../dummies/BadContractInteractor'
import BadRelayedTransactionValidator from '../dummies/BadRelayedTransactionValidator'
import { stripHex, deployHub, startRelay, stopRelay, getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount, snapshot, revert, emittedEvent } from '../TestUtils'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import PingResponse from '../../src/common/PingResponse'
import { RelayEvent } from '../../src/relayclient/RelayEvents'
import { Provider } from '../../src/common/ContractInteractor'
import bodyParser from 'body-parser'
import { Server } from 'http'
import HttpClient from '../../src/relayclient/HttpClient'
import HttpWrapper from '../../src/relayclient/HttpWrapper'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { constants } from '../../src/common/Constants'
import { getDomainSeparatorHash, TypedDeployRequestData } from '../../src/common/EIP712/TypedRequestData'
import { ethers, network } from 'hardhat'
import { BigNumber, Transaction } from 'ethers'
import { RelayHub, SmartWallet, SmartWalletFactory, SmartWallet__factory, TestDeployVerifierEverythingAccepted, TestDeployVerifierEverythingAccepted__factory, TestRecipient, TestRecipient__factory, TestToken, TestToken__factory, TestVerifierEverythingAccepted, TestVerifierEverythingAccepted__factory } from '../../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

chai.use(sinonChai)

const localhostOne = 'http://localhost:8090'
const cheapRelayerUrl = 'http://localhost:54321'
const underlyingProvider = ethers.provider

class MockHttpClient extends HttpClient {
  constructor (readonly mockPort: number,
    httpWrapper: HttpWrapper, config: Partial<EnvelopingConfig>) {
    super(httpWrapper, config)
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<PrefixedHexString> {
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
  describe(`RelayClient with ${gasOption.title}`, function () {
    let accountsSigners: SignerWithAddress[]
    let accounts: string[]
    let TestRecipient: TestRecipient__factory
    let TestRelayVerifier: TestVerifierEverythingAccepted__factory
    let TestDeployVerifier: TestDeployVerifierEverythingAccepted__factory
    let SmartWallet: SmartWallet__factory
    let TestToken: TestToken__factory
    let relayHub: RelayHub
    let testRecipient: TestRecipient
    let relayVerifier: TestVerifierEverythingAccepted
    let deployVerifier: TestDeployVerifierEverythingAccepted
    let relayProcess: ChildProcessWithoutNullStreams
    let relayClient: RelayClient
    let config: Partial<EnvelopingConfig>
    let options: EnvelopingTransactionDetails
    let to: Address
    let from: Address
    let data: PrefixedHexString
    let relayEvents: RelayEvent[] = []
    let factory: SmartWalletFactory
    let sWalletTemplate: SmartWallet
    let smartWallet: SmartWallet
    let token: TestToken
    let gaslessAccount: AccountKeypair
    let relayWorker: Address

    async function registerRelayer (relayHub: RelayHub, relayOwnerSigner: SignerWithAddress, relayManagerSigner: SignerWithAddress): Promise<void> {
      const relayWorker = '0x'.padEnd(42, '2')
      await relayHub.connect(relayOwnerSigner).stakeForAddress(await relayManagerSigner.getAddress(), 1000, {
        value: ethers.utils.parseEther('2')
      })

      await relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker])
      await relayHub.connect(relayManagerSigner).registerRelayServer(cheapRelayerUrl)
    }

    before(async function () {
      accounts = await ethers.provider.listAccounts()
      accountsSigners = await ethers.getSigners()
      relayHub = await deployHub()
      TestRecipient = await ethers.getContractFactory('TestRecipient') as TestRecipient__factory
      testRecipient = await TestRecipient.deploy()
      await testRecipient.deployed()
      SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
      sWalletTemplate = await SmartWallet.deploy()
      await sWalletTemplate.deployed()
      TestToken = await ethers.getContractFactory('TestToken') as TestToken__factory
      token = await TestToken.deploy()
      await token.deployed()
      const env = (await getTestingEnvironment())

      gaslessAccount = await getGaslessAccount()
      factory = await createSmartWalletFactory(sWalletTemplate)
      smartWallet = await createSmartWallet(accounts[0], gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)
      TestRelayVerifier = await ethers.getContractFactory('TestVerifierEverythingAccepted') as TestVerifierEverythingAccepted__factory
      relayVerifier = await TestRelayVerifier.deploy()
      await relayVerifier.deployed()
      TestDeployVerifier = await ethers.getContractFactory('TestDeployVerifierEverythingAccepted') as TestDeployVerifierEverythingAccepted__factory
      deployVerifier = await TestDeployVerifier.deploy()
      await deployVerifier.deployed()

      const startRelayResult = await startRelay(relayHub, {
        stake: 1e18,
        relayOwner: accounts[1],
        // @ts-ignore
        rskNodeUrl: network.config.url,
        deployVerifierAddress: deployVerifier.address,
        relayVerifierAddress: relayVerifier.address,
        workerTargetBalance: 0.6e18//,
        // relaylog:true
      })

      relayWorker = await accountsSigners[2].getAddress()
      const relayOwner = accountsSigners[3]
      const relayManager = accountsSigners[4]
      await relayHub.connect(relayOwner).stakeForAddress(await relayManager.getAddress(), 1000, {
        value: ethers.utils.parseEther('2')
      })

      await relayHub.connect(relayManager).addRelayWorkers([relayWorker])
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

      data = (await testRecipient.populateTransaction.emitMessage('hello world')).data ?? ''

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
          expect.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }

        const validTransactionHash: string = validTransaction.hash ?? ''
        const txHash = `0x${validTransactionHash}`
        const res = await ethers.provider.getTransactionReceipt(txHash)

        // validate we've got the "SampleRecipientEmitted" event
        expect(emittedEvent(testRecipient, res, 'SampleRecipientEmitted(string,address,address,uint256,uint256)', [])).to.be.true

        const destination: string = validTransaction.to ?? ''
        expect(`0x${destination}`).to.be.equal(relayHub.address.toString().toLowerCase())
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
            server = mockServer.listen(0, resolve)
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
          expect(_dumpRelayingResult(relayingResult)).to.match(/timeout.*exceeded/)
        } finally {
          server?.close()
        }
      })

      it('should use forceGasPrice if provided', async function () {
        const forceGasPrice = '0x777777777'
        const optionsForceGas = Object.assign({}, options, { forceGasPrice })
        const { transaction, pingErrors, relayingErrors } = await relayClient.relayTransaction(optionsForceGas)
        expect(pingErrors.size).to.be.equal(0, 'Ping Errors list is not empty')
        expect(relayingErrors.size).to.be.equal(0, 'Relaying Errors list is not empy')
        expect(parseInt(transaction!.gasPrice.toString(), 16)).to.be.equal(parseInt(forceGasPrice))
      })

      it('should return errors encountered in ping', async function () {
        const badHttpClient = new BadHttpClient(configure(config), true, false, false)
        const relayClient =
          new RelayClient(underlyingProvider, config, { httpClient: badHttpClient })
        const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
        expect(transaction).is.undefined
        expect(relayingErrors.size).to.be.equal(0)
        expect(pingErrors.size).to.be.equal(1)
        expect(pingErrors.get(localhostOne)!.message).to.be.equal(BadHttpClient.message)
      })

      it('should return errors encountered in relaying', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, true, false)
        const relayClient =
          new RelayClient(underlyingProvider, config, { httpClient: badHttpClient })

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
        expect(transaction).is.undefined
        expect(pingErrors.size).to.be.equal(0)
        expect(relayingErrors.size).to.be.equal(1)
        expect(relayingErrors.get(localhostOne)!.message).to.be.equal(BadHttpClient.message)
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
        const testRequest = await relayClient._prepareFactoryGasEstimationRequest(details, relayWorker)
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
          gasLimit: 4e6
        })
        const salt = ethers.utils.solidityKeccak256(['address', 'address', 'address', 'uint256'], [eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0']) ?? ''
        const expectedSalt = BigNumber.from(salt).toString()

        const actualGasUsed: number = (await txResponse.wait()).cumulativeGasUsed.toNumber()

        const event = factory.filters.Deployed(null, null)
        const eventEmitted = await factory.queryFilter(event)
        expect(eventEmitted[0].event).to.be.equal('Deployed')
        expect(eventEmitted[0].args.addr).to.be.equal(swAddress)
        expect(eventEmitted[0].args.salt).to.be.equal(expectedSalt)

        // The Smart Wallet should have been charged for the deploy
        const newBalance = await token.balanceOf(swAddress)
        const expectedBalance = originalBalance.sub(BigNumber.from('1'))
        expect(expectedBalance).to.be.equal(newBalance, 'Deployment not paid')

        const tenPercertGasCushion = actualGasUsed * 0.1
        const highActual = actualGasUsed + tenPercertGasCushion
        const lowActual = actualGasUsed - tenPercertGasCushion

        const estimatedGasResult = estimatedGasResultWithoutTokenPayment + tokenPaymentEstimate
        expect(estimatedGasResult === actualGasUsed ||
          ((lowActual <= estimatedGasResult) && (highActual >= estimatedGasResult))).to.be.true //, 'Incorrect estimated gas')
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

        expect(await ethers.provider.getCode(swAddress)).to.be.equal('0x', 'SmartWallet not yet deployed, it must not have installed code')

        const result = await relayClient.relayTransaction(deployOptions)
        const senderAddress = `0x${result.transaction?.from}`
        const senderTokenInitialBalance = await token.balanceOf(senderAddress)
        expect(senderAddress).to.not.be.equal(constants.ZERO_ADDRESS)
        expect(await ethers.provider.getCode(swAddress)).to.not.be.equal('0x', 'SmartWalletdeployed, it must have installed code')

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
        const senderAddressRelay = `0x${relayingResult.transaction?.from}`
        const senderTokenFinalBalance = await token.balanceOf(senderAddressRelay)

        expect(senderAddressRelay).to.not.be.equal('0xundefined')
        expect(senderAddress).to.be.equal(senderAddressRelay)
        expect(senderTokenInitialBalance.toString()).to.be.equal(senderTokenFinalBalance.sub(BigNumber.from('1')).toString())

        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          expect.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash ?? ''
        const txHash = `0x${validTransactionHash}`
        const res = await ethers.provider.getTransactionReceipt(txHash)

        // validate we've got the "SampleRecipientEmitted" event
        expect(emittedEvent(testRecipient, res, 'SampleRecipientEmitted(string,address,address,uint256,uint256)', [])).to.be.true

        const destination: string = validTransaction.to ?? ''
        expect(`0x${destination}`).to.be.equal(relayHub.address.toString().toLowerCase())
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

        expect(await ethers.provider.getCode(swAddress)).to.be.equal('0x', 'SmartWallet not yet deployed, it must not have installed code')

        try {
          await relayClient.relayTransaction(deployOptions)
        } catch (error) {
          expect(error.message).to.be.equal('In a deploy, if tokenGas is not defined, then the calculated SmartWallet address is needed to estimate the tokenGas value')
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

        expect(await ethers.provider.getCode(swAddress)).to.be.equal('0x', 'SmartWallet not yet deployed, it must not have installed code')

        const result = await relayClient.relayTransaction(deployOptions)
        const senderAddress = `0x${result.transaction?.from}`
        const senderTokenInitialBalance = await token.balanceOf(senderAddress)
        expect(senderAddress).to.not.be.equal(constants.ZERO_ADDRESS)
        expect(await ethers.provider.getCode(swAddress)).to.not.be.equal('0x', 'SmartWalletdeployed, it must have installed code')

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
        const senderAddressRelay = `0x${relayingResult.transaction?.from}`
        const senderTokenFinalBalance = await token.balanceOf(senderAddressRelay)

        expect(senderAddressRelay).to.not.be.equal('0xundefined')
        expect(senderAddress).to.be.equal(senderAddressRelay)
        expect(senderTokenInitialBalance.toString()).to.be.equal(senderTokenFinalBalance.sub(balanceToTransfer).toString())

        const sWalletFinalBalance = await token.balanceOf(swAddress)
        expect(sWalletFinalBalance).to.be.equal(BigNumber.from(0), 'SW Final balance must be zero')

        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          expect.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }
        const validTransactionHash: string = validTransaction.hash ?? ''
        const txHash = `0x${validTransactionHash}`
        const res = await ethers.provider.getTransactionReceipt(txHash)

        // validate we've got the "SampleRecipientEmitted" event
        // TODO: use OZ test helpers
        expect(emittedEvent(testRecipient, res, 'SampleRecipientEmitted(string,address,address,uint256,uint256)', [])).to.be.true

        const destination: string = validTransaction.to ?? ''
        expect(`0x${destination}`).to.be.equal(relayHub.address.toString().toLowerCase())
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

        expect(await ethers.provider.getCode(swAddress)).to.be.equal('0x', 'SmartWallet not yet deployed, it must not have installed code')

        const relayingResult = await relayClient.relayTransaction(deployOptions)
        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          expect.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
          return
        }

        // expect(topic).to.not.be.equal('', 'error while calculating topic')
        const saltSha = ethers.utils.solidityKeccak256(['address', 'address', 'address', 'uint256'], [eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0']) ?? ''
        expect(saltSha).to.not.be.equal('', 'error while calculating salt')

        const expectedSalt = BigNumber.from(saltSha).toString()

        const event = factory.filters.Deployed(null, null)
        const eventEmitted = await factory.queryFilter(event)

        // validate we've got the "Deployed" event
        expect(eventEmitted[0].event).to.be.equal('Deployed')
        expect(eventEmitted[0].args.addr).to.be.equal(stripHex(swAddress))
        expect(eventEmitted[0].args.salt).to.be.equal(expectedSalt)

        // expect(res.logs.find(log => log.topics.includes(topic))).to.be.true
        // const eventIdx = res.logs.findIndex(log => log.topics.includes(topic))
        // const loggedEvent = res.logs[eventIdx]

        // const strippedAddr = stripHex(swAddress)
        // expect(loggedEvent.topics.find(data => data.slice(26, data.length).includes(strippedAddr))).to.be.true
        // let eventSWAddress = loggedEvent.topics[loggedEvent.topics.findIndex(data => data.slice(26, data.length).includes(strippedAddr))]
        // eventSWAddress = '0x'.concat(eventSWAddress.slice(26, eventSWAddress.length).toLowerCase())

        // const obtainedEventData = web3.eth.abi.decodeParameters([{ type: 'uint256', name: 'salt' }], loggedEvent.data)

        // expect(obtainedEventData.salt).to.be.equal(expectedSalt, 'salt from Deployed event is not the expected one')
        // expect(eventSWAddress).to.be.equal(swAddress, 'SmartWallet address from the Deployed event is not the expected one')

        const destination: string = validTransaction.to ?? ''
        expect(`0x${destination}`).to.be.equal(relayHub.address.toString().toLowerCase())

        let expectedCode = await factory.getCreationBytecode()
        expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)// only runtime code
        expect(await ethers.provider.getCode(swAddress)).to.be.equal(expectedCode, 'The installed code is not the expected one')
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

        expect(await ethers.provider.getCode(swAddress)).to.be.equal('0x', 'SmartWallet not yet deployed, it must not have installed code')

        const relayingResult = await relayClient.relayTransaction(deployOptions)
        const validTransaction = relayingResult.transaction

        if (validTransaction == null) {
          expect.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
        }
        // validate we've got the "Deployed" event

        // const topic: string = web3.utils.sha3('Deployed(address,uint256)') ?? ''
        // expect(topic).to.not.be.equal('', 'error while calculating topic')

        // expect(res.logs.find(log => log.topics.includes(topic))).to.be.true
        // const eventIdx = res.logs.findIndex(log => log.topics.includes(topic))
        // const loggedEvent = res.logs[eventIdx]

        // const strippedAddr = stripHex(swAddress)
        // expect(loggedEvent.topics.find(data => data.slice(26, data.length).includes(strippedAddr))).to.be.true
        // let eventSWAddress = loggedEvent.topics[loggedEvent.topics.findIndex(data => data.slice(26, data.length).includes(strippedAddr))]
        // eventSWAddress = '0x'.concat(eventSWAddress.slice(26, eventSWAddress.length).toLowerCase())

        const saltSha = ethers.utils.solidityKeccak256(['address', 'address', 'address', 'uint256'], [eoaWithoutSmartWalletAccount.address, constants.ZERO_ADDRESS, '0']) ?? ''
        expect(saltSha).to.not.be.equal('', 'error while calculating salt')

        // const obtainedEventData = web3.eth.abi.decodeParameters([{ type: 'uint256', name: 'salt' }], loggedEvent.data)
        // expect(obtainedEventData.salt).to.be.equal(saltSha, 'salt from Deployed event is not the expected one')
        // expect(eventSWAddress).to.be.equal(swAddress, 'SmartWallet address from the Deployed event is not the expected one')

        const event = factory.filters.Deployed(null, null)
        const eventEmitted = await factory.queryFilter(event)

        expect(eventEmitted[0].event).to.be.equal('Deployed')
        expect(eventEmitted[0].args.addr).to.be.equal(stripHex(swAddress))
        expect(eventEmitted[0].args.salt).to.be.equal(saltSha)

        const destination: string = validTransaction.to ?? ''
        expect(`0x${destination}`, relayHub.address.toString().toLowerCase())

        let expectedCode = await factory.getCreationBytecode()
        expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)// only runtime code
        expect(await ethers.provider.getCode(swAddress)).to.be.equal(expectedCode, 'The installed code is not the expected one')
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
          expect(relayEvents.length).to.be.equal(8)
          expect(relayEvents[0].step).to.be.equal(0)
          expect(relayEvents[0].total).to.be.equal(8)
          expect(relayEvents[7].step).to.be.equal(7)
        })
        describe('removing events listener', () => {
          before('registerEventsListener', () => {
            relayEvents = []
            relayClient.unregisterEventListener(eventsHandler)
          })
          it('should call events handler', async function () {
            await relayClient.relayTransaction(options)
            expect(relayEvents.length).to.be.equal(0)
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
        expect(calculatedGasPrice).to.be.equal(`0x${minGasPrice.toString(16)}`)
      })
    })

    describe('#_attemptRelay()', function () {
      const relayUrl = localhostOne
      let relayWorkerAddress: string
      let relayManager: string
      let relayOwner: string
      let pingResponse: PingResponse
      let relayInfo: RelayInfo
      let optionsWithGas: EnvelopingTransactionDetails

      before(async function () {
        relayWorkerAddress = accounts[1]
        relayManager = accounts[2]
        relayOwner = accounts[3]
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

        let gasToSend = (await ethers.provider.estimateGas({
          from: options.callForwarder,
          to: options.to,
          gasPrice: ethers.utils.hexlify('6000000000'),
          data: options.data
        })).toNumber()

        gasToSend = gasToSend > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION ? gasToSend - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION : gasToSend

        optionsWithGas = Object.assign({}, options, {
          gas: ethers.utils.hexlify(gasToSend),
          gasPrice: ethers.utils.hexlify('6000000000')
        })
      })

      it('should return error if view call to \'relayCall()\' fails', async function () {
        const badContractInteractor = new BadContractInteractor(ethers.provider as Provider, configure(config), true)
        const relayClient =
          new RelayClient(underlyingProvider, config, { contractInteractor: badContractInteractor })
        await relayClient._init()

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)
        const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
        expect(transaction).is.undefined
        expect(error!.message).to.be.equal(`local view call reverted: ${BadContractInteractor.message}`)
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
        }))
        expect(attempt.error?.message).to.be.equal('some error describing how timeout occurred somewhere')
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
        await relayClient._attemptRelay(relayInfo, optionsWithGas)
        expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.not.been.called
      })

      it('should return error if transaction returned by a relay does not pass validation', async function () {
        const badHttpClient = new BadHttpClient(configure(config), false, false, false, pingResponse, '0x123')
        let dependencyTree = getDependencies(configure(config), underlyingProvider)
        const badTransactionValidator = new BadRelayedTransactionValidator(true, dependencyTree.contractInteractor, configure(config))
        dependencyTree = getDependencies(configure(config), underlyingProvider, {
          httpClient: badHttpClient,
          transactionValidator: badTransactionValidator
        })
        const relayClient =
          new RelayClient(underlyingProvider, config, dependencyTree)

        await relayClient._init()

        // register gasless account in RelayClient to avoid signing with RSKJ
        relayClient.accountManager.addAccount(gaslessAccount)

        // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
        sinon.spy(dependencyTree.knownRelaysManager)
        const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
        expect(transaction).is.undefined
        expect(error!.message).to.be.equal('Returned transaction did not pass validation')
        expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
      })
    })

    describe('#_broadcastRawTx()', function () {
      // TODO: TBD: there has to be other behavior then that. Maybe query the transaction with the nonce somehow?
      it('should return \'wrongNonce\' if broadcast fails with nonce error', async function () {
        const badContractInteractor = new BadContractInteractor(underlyingProvider, configure(config), true)
        const transaction: Transaction = ethers.utils.parseTransaction('0x')
        const relayClient =
          new RelayClient(underlyingProvider, config, { contractInteractor: badContractInteractor })
        const { hasReceipt, wrongNonce, broadcastError } = await relayClient._broadcastRawTx(transaction)
        expect(hasReceipt).to.be.false
        expect(wrongNonce).to.be.true
        expect(broadcastError?.message).to.be.equal(BadContractInteractor.wrongNonceMessage)
      })
    })

    describe('multiple relayers', () => {
      let id: string
      before(async () => {
        id = (await snapshot()).result
        await registerRelayer(relayHub, accountsSigners[3], accountsSigners[4])
      })
      after(async () => {
        await revert(id)
      })

      it('should succeed to relay, but report ping error', async () => {
        const relayingResult = await relayClient.relayTransaction(options)
        expect(relayingResult.transaction).is.not.null
        expect(relayingResult.pingErrors.get(cheapRelayerUrl)?.message as string).to.match(/ECONNREFUSED/,
          `relayResult: ${_dumpRelayingResult(relayingResult)}`)
      })

      it('use preferred relay if one is set', async () => {
        relayClient = new RelayClient(underlyingProvider, {
          preferredRelays: ['http://localhost:8090'],
          ...config
        })

        relayClient.accountManager.addAccount(gaslessAccount)

        const relayingResult = await relayClient.relayTransaction(options)
        expect(relayingResult.transaction).is.not.null
        expect(relayingResult.pingErrors.size).to.be.equal(0)

        console.log(relayingResult)
      })
    })
  })
})

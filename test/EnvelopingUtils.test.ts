import { ChildProcessWithoutNullStreams } from "child_process"
import { BN, toBuffer } from "ethereumjs-util"
import { configure, EnvelopingConfig } from "../Configurator"
import { HttpProvider } from "web3-core"
import { EnvelopingUtils } from "../src/common/Utils"
import { AccountKeypair } from "../src/relayclient/AccountManager"
import { Address } from "../src/relayclient/types/Aliases"
import { ProxyFactoryInstance, RelayHubInstance, SmartWalletInstance, StakeManagerInstance, TestDeployVerifierEverythingAcceptedInstance, TestRecipientInstance, TestTokenInstance, TestVerifierEverythingAcceptedInstance } from "../types/truffle-contracts"
import { ServerTestEnvironment } from "./relayserver/ServerTestEnvironment"
import { createProxyFactory, deployHub, getExistingGaslessAccount, getTestingEnvironment, startRelay, stopRelay } from "./TestUtils"
import { constants } from "../src/common/Constants"
import { randomHex, soliditySha3Raw } from "web3-utils"
import { expectEvent } from "@openzeppelin/test-helpers"

const TestRecipient = artifacts.require('tests/TestRecipient')
const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const SmartWallet = artifacts.require('SmartWallet')
const TestVerifierEverythingAccepted = artifacts.require('tests/TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('tests/TestDeployVerifierEverythingAccepted')
const ProxyFactory = artifacts.require('ProxyFactory')

const localhost = 'http://localhost:8090'

contract('Enveloping utils', (accounts) => {
    let enveloping: EnvelopingUtils
    let env: ServerTestEnvironment
    let tokenContract: TestTokenInstance
    let relayHub: RelayHubInstance
    let stakeManager: StakeManagerInstance
    let verifier: TestVerifierEverythingAcceptedInstance
    let deployVerifier: TestDeployVerifierEverythingAcceptedInstance
    let factory: ProxyFactoryInstance
    let sWalletTemplate: SmartWalletInstance
    let testRecipient: TestRecipientInstance
    let chainId: number
    let workerAddress: Address
    let config: EnvelopingConfig
    let fundedAccount: AccountKeypair
    let gaslessAccount: AccountKeypair
    let relayproc: ChildProcessWithoutNullStreams
    let swAddress: Address
    let index: string

    const gasLimit = '160000'


    before(async () => {
        gaslessAccount = await getExistingGaslessAccount()
        fundedAccount = {
            privateKey: toBuffer('0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4'),
            address: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
        }

        testRecipient = await TestRecipient.new()
        stakeManager = await StakeManager.new(0)
        sWalletTemplate = await SmartWallet.new()
        verifier = await TestVerifierEverythingAccepted.new()
        deployVerifier = await TestDeployVerifierEverythingAccepted.new()
        factory = await createProxyFactory(sWalletTemplate)
        chainId = (await getTestingEnvironment()).chainId
        env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
        tokenContract = await TestToken.new()
        relayHub = await deployHub(stakeManager.address)
        index =  randomHex(32)
        swAddress = await factory.getSmartWalletAddress(gaslessAccount.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, soliditySha3Raw({ t: 'bytes', v: '0x' }), index)

        const partialConfig: Partial<EnvelopingConfig> =
        {
            relayHubAddress: relayHub.address,
            proxyFactoryAddress: factory.address,
            chainId: chainId,
            relayVerifierAddress: verifier.address,
            deployVerifierAddress: deployVerifier.address,
            preferredRelays:['http://localhost:8090'],
            forwarderAddress: swAddress
        }
        config = configure(partialConfig)
        const serverData = await startRelay(relayHub.address, stakeManager,{
            stake: 1e18,
            delay: 3600 * 24 * 7,
            url: 'asd',
            relayOwner: fundedAccount.address,
            gasPriceFactor: 1,
            // @ts-ignore
            rskNodeUrl: web3.currentProvider.host,
            relayVerifierAddress: verifier.address,
            deployVerifierAddress: deployVerifier.address,
        })
        relayproc = serverData.proc
        workerAddress = serverData.worker
        enveloping = new EnvelopingUtils(config, web3, workerAddress)
        await enveloping._init()
    })

    after(async function () {
        await stopRelay(relayproc)
      })

    
    it('Should deploy a smart wallet correctly and relay a tx using enveloping utils without tokens', async () => {
        let expectedCode = await web3.eth.getCode(swAddress)
        assert.equal('0x00', expectedCode)
        const deployRequest = await enveloping.createDeployRequest(gaslessAccount.address, gasLimit, constants.ZERO_ADDRESS, '0', '0', '1000000000', index)
        const deploySignature = enveloping.signDeployRequest(gaslessAccount.privateKey, deployRequest)
        const httpDeployRequest = await enveloping.generateDeployTransactionRequest(deploySignature, deployRequest)
        const sentDeployTransaction = await enveloping.sendTransaction(localhost, httpDeployRequest)
        const txDeployHash = sentDeployTransaction.transaction?.hash(true).toString('hex')
        await expectEvent.inTransaction(txDeployHash, ProxyFactory, 'Deployed')
        
        const deployedCode = await web3.eth.getCode(swAddress)
        expectedCode = await factory.getCreationBytecode()
        expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)
        assert.equal(deployedCode, expectedCode)

        const encodedFunction = testRecipient.contract.methods.emitMessage('hello world').encodeABI()
        const relayRequest = await enveloping.createRelayRequest(gaslessAccount.address, testRecipient.address, encodedFunction, gasLimit, constants.ZERO_ADDRESS, '0', '0', '1000000000')
        const relaySignature = enveloping.signRelayRequest(gaslessAccount.privateKey, relayRequest)
        const httpRelayRequest = await enveloping.generateRelayTransactionRequest(relaySignature, relayRequest)
        const sentRelayTransaction = await enveloping.sendTransaction(localhost, httpRelayRequest)
        const txRelayHash = sentRelayTransaction.transaction?.hash(true).toString('hex')
        if(txRelayHash != undefined) {
            await expectEvent.inTransaction(txRelayHash, TestRecipient, 'SampleRecipientEmitted', {
                message: 'hello world'
            })
        } else {
            assert.fail('Transacion has not been send or it threw an error')
        }
    })

     it('Should deploy a smart wallet correctly and relay a tx using enveloping utils paying with tokens', async () => {
        let expectedCode = await web3.eth.getCode(swAddress)
        assert.equal('0x00', expectedCode)
        await tokenContract.mint('100', swAddress)
        const previousBalance = await tokenContract.balanceOf(workerAddress)

        
        const deployRequest = await enveloping.createDeployRequest(gaslessAccount.address, gasLimit, tokenContract.address, '10', '50000', '1000000000', index)
        const deploySignature = enveloping.signDeployRequest(gaslessAccount.privateKey, deployRequest)
        const httpDeployRequest = await enveloping.generateDeployTransactionRequest(deploySignature, deployRequest)
        const sentDeployTransaction = await enveloping.sendTransaction(localhost, httpDeployRequest)
        const txDeployHash = sentDeployTransaction.transaction?.hash(true).toString('hex')
        await expectEvent.inTransaction(txDeployHash, ProxyFactory, 'Deployed')
       
        const deployedCode = await web3.eth.getCode(swAddress)
        expectedCode = await factory.getCreationBytecode()
        expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)
        assert.equal(deployedCode, expectedCode)
        const newBalance = await tokenContract.balanceOf(workerAddress)
        console.log(newBalance.toNumber())
        console.log(previousBalance.add(new BN(10)).toNumber())
        assert.equal(newBalance.toNumber(), previousBalance.add(new BN(10)).toNumber())

        const encodedFunction = testRecipient.contract.methods.emitMessage('hello world').encodeABI()
        const relayRequest = await enveloping.createRelayRequest(gaslessAccount.address, testRecipient.address, encodedFunction, gasLimit, tokenContract.address, '10', '50000', '1000000000')
        const relaySignature = enveloping.signRelayRequest(gaslessAccount.privateKey, relayRequest)
        const httpRelayRequest = await enveloping.generateRelayTransactionRequest(relaySignature, relayRequest)
        const sentTransaction = await enveloping.sendTransaction(localhost, httpRelayRequest)
        const txRelayHash = sentTransaction.transaction?.hash(true).toString('hex')
        if(txRelayHash != undefined) {
            const finalBalance = await tokenContract.balanceOf(workerAddress)
            await expectEvent.inTransaction(txRelayHash, TestRecipient, 'SampleRecipientEmitted', {
                message: 'hello world'
            })
            assert.equal(finalBalance.toNumber(), newBalance.add(new BN(10)).toNumber())
        } else {
            assert.fail('Transacion has not been send')
        }
    })
})




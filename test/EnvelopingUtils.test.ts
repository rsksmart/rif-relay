import { ChildProcessWithoutNullStreams } from 'child_process'
import { BN, toBuffer } from 'ethereumjs-util'
import { configure, EnvelopingConfig } from '../Configurator'
import { isSameAddress } from '../src/common/Utils'
import { Enveloping, SignatureProvider } from '../src/relayclient/Enveloping'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { Address, IntString } from '../src/relayclient/types/Aliases'
import { SmartWalletFactoryInstance, RelayHubInstance, SmartWalletInstance, TestDeployVerifierEverythingAcceptedInstance, TestRecipientInstance, TestTokenInstance, TestVerifierEverythingAcceptedInstance } from '../types/truffle-contracts'
import { createSmartWalletFactory, deployHub, getTestingEnvironment, startRelay, stopRelay } from './TestUtils'
import { constants } from '../src/common/Constants'
import { randomHex, toChecksumAddress } from 'web3-utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import { PrefixedHexString } from 'ethereumjs-tx'
import { DeployRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import sigUtil from 'eth-sig-util'

// @ts-ignore
import abiDecoder from 'abi-decoder'

const TestRecipient = artifacts.require('tests/TestRecipient')
const TestToken = artifacts.require('TestToken')
const SmartWallet = artifacts.require('SmartWallet')
const TestVerifierEverythingAccepted = artifacts.require('tests/TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('tests/TestDeployVerifierEverythingAccepted')
const SmartWalletFactory = artifacts.require('SmartWalletFactory')

const localhost = 'http://localhost:8090'
const message = 'hello world'

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(SmartWalletFactory.abi)

contract('Enveloping utils', () => {
  let enveloping: Enveloping
  let tokenContract: TestTokenInstance
  let relayHub: RelayHubInstance
  let verifier: TestVerifierEverythingAcceptedInstance
  let deployVerifier: TestDeployVerifierEverythingAcceptedInstance
  let factory: SmartWalletFactoryInstance
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

  const signatureProvider: SignatureProvider = {
    sign: (dataToSign: TypedRequestData) => {
      const privKey = toBuffer('0x082f57b8084286a079aeb9f2d0e17e565ced44a2cb9ce4844e6d4b9d89f3f595')
      // @ts-ignore
      return sigUtil.signTypedData_v4(privKey, { data: dataToSign })
    },
    verifySign: (signature: PrefixedHexString, dataToSign: TypedRequestData, request: RelayRequest|DeployRequest) => {
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: dataToSign,
        sig: signature
      })
      return isSameAddress(request.request.from, rec)
    }
  }

  const deploySmartWallet = async function deploySmartWallet (tokenContract: Address, tokenAmount: IntString, tokenGas: IntString): Promise<string|undefined> {
    const deployRequest = await enveloping.createDeployRequest(gaslessAccount.address, gasLimit, tokenContract, tokenAmount, tokenGas, '1000000000', index)
    const deploySignature = enveloping.signDeployRequest(signatureProvider, deployRequest)
    const httpDeployRequest = await enveloping.generateDeployTransactionRequest(deploySignature, deployRequest)
    const sentDeployTransaction = await enveloping.sendTransaction(localhost, httpDeployRequest)
    return sentDeployTransaction.transaction?.hash(true).toString('hex')
  }

  const assertSmartWalletDeployedCorrectly = async function assertSmartWalletDeployedCorrectly (swAddress: Address): Promise<void> {
    const deployedCode = await web3.eth.getCode(swAddress)
    let expectedCode = await factory.getCreationBytecode()
    expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)
    assert.equal(deployedCode, expectedCode)
  }

  const relayTransaction = async function relayTransaction (tokenContract: Address, tokenAmount: IntString, tokenGas: IntString): Promise<string|undefined> {
    const encodedFunction = testRecipient.contract.methods.emitMessage(message).encodeABI()
    const relayRequest = await enveloping.createRelayRequest(gaslessAccount.address, testRecipient.address, swAddress, encodedFunction, gasLimit, tokenContract, tokenAmount, tokenGas, '1000000000')
    const relaySignature = enveloping.signRelayRequest(signatureProvider, relayRequest)
    const httpRelayRequest = await enveloping.generateRelayTransactionRequest(relaySignature, relayRequest)
    const sentRelayTransaction = await enveloping.sendTransaction(localhost, httpRelayRequest)
    return sentRelayTransaction.transaction?.hash(true).toString('hex')
  }

  const gasLimit = '160000'

  before(async () => {
    gaslessAccount = {
      privateKey: toBuffer('0x082f57b8084286a079aeb9f2d0e17e565ced44a2cb9ce4844e6d4b9d89f3f595'),
      address: toChecksumAddress('0x09a1eda29f664ac8f68106f6567276df0c65d859', (await getTestingEnvironment()).chainId).toLowerCase()
    }
    fundedAccount = {
      privateKey: toBuffer('0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4'),
      address: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
    }
    testRecipient = await TestRecipient.new()
    sWalletTemplate = await SmartWallet.new()
    verifier = await TestVerifierEverythingAccepted.new()
    deployVerifier = await TestDeployVerifierEverythingAccepted.new()
    factory = await createSmartWalletFactory(sWalletTemplate)
    chainId = (await getTestingEnvironment()).chainId
    tokenContract = await TestToken.new()
    relayHub = await deployHub()
  })

  beforeEach(async () => {
    index = randomHex(32)
    swAddress = await factory.getSmartWalletAddress(gaslessAccount.address, constants.ZERO_ADDRESS, index)

    const partialConfig: Partial<EnvelopingConfig> =
    {
      relayHubAddress: relayHub.address,
      smartWalletFactoryAddress: factory.address,
      chainId: chainId,
      relayVerifierAddress: verifier.address,
      deployVerifierAddress: deployVerifier.address,
      preferredRelays: ['http://localhost:8090']
    }

    config = configure(partialConfig)
    const serverData = await startRelay(relayHub, {
      stake: 1e18,
      delay: 3600 * 24 * 7,
      url: 'asd',
      relayOwner: fundedAccount.address,
      gasPriceFactor: 1,
      // @ts-ignore
      rskNodeUrl: web3.currentProvider.host,
      relayVerifierAddress: verifier.address,
      deployVerifierAddress: deployVerifier.address
    })
    relayproc = serverData.proc
    workerAddress = serverData.worker
    enveloping = new Enveloping(config, web3, workerAddress)
    await enveloping._init()
  })

  afterEach(async function () {
    await stopRelay(relayproc)
  })

  it('Should deploy a smart wallet correctly and relay a tx using enveloping utils without tokens', async () => {
    const expectedInitialCode = await web3.eth.getCode(swAddress)
    assert.equal('0x00', expectedInitialCode)

    const txDeployHash = await deploySmartWallet(constants.ZERO_ADDRESS, '0', '0')

    if (txDeployHash === undefined) {
      assert.fail('Transacion has not been send or it threw an error')
    }

    let txReceipt = await web3.eth.getTransactionReceipt(txDeployHash)
    let logs = abiDecoder.decodeLogs(txReceipt.logs)

    const deployedEvent = logs.find((e: any) => e != null && e.name === 'Deployed')
    assert.equal(swAddress.toLowerCase(), deployedEvent.events[0].value.toLowerCase())

    await assertSmartWalletDeployedCorrectly(swAddress)

    const txRelayHash = await relayTransaction(constants.ZERO_ADDRESS, '0', '0')

    if (txRelayHash === undefined) {
      assert.fail('Transacion has not been send or it threw an error')
    }

    txReceipt = await web3.eth.getTransactionReceipt(txRelayHash)
    logs = abiDecoder.decodeLogs(txReceipt.logs)

    const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

    assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
    assert.equal(swAddress.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
    assert.equal(workerAddress.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())
  })

  it('Should deploy a smart wallet correctly and relay a tx using enveloping utils paying with tokens', async () => {
    const expectedInitialCode = await web3.eth.getCode(swAddress)
    const balanceTransfered = new BN(10)
    assert.equal('0x00', expectedInitialCode)
    await tokenContract.mint('100', swAddress)
    const previousBalance = await tokenContract.balanceOf(workerAddress)

    const txDeployHash = await deploySmartWallet(tokenContract.address, '10', '50000')

    if (txDeployHash === undefined) {
      assert.fail('Transacion has not been send or it threw an error')
    }

    let txReceipt = await web3.eth.getTransactionReceipt(txDeployHash)
    let logs = abiDecoder.decodeLogs(txReceipt.logs)

    const deployedEvent = logs.find((e: any) => e != null && e.name === 'Deployed')
    assert.equal(swAddress.toLowerCase(), deployedEvent.events[0].value.toLowerCase())

    await assertSmartWalletDeployedCorrectly(swAddress)

    const newBalance = await tokenContract.balanceOf(workerAddress)
    assert.equal(newBalance.toNumber(), previousBalance.add(balanceTransfered).toNumber())

    const txRelayHash = await relayTransaction(tokenContract.address, '10', '50000')

    if (txRelayHash === undefined) {
      assert.fail('Transacion has not been send')
    }

    const finalBalance = await tokenContract.balanceOf(workerAddress)

    txReceipt = await web3.eth.getTransactionReceipt(txRelayHash)
    logs = abiDecoder.decodeLogs(txReceipt.logs)

    const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

    assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
    assert.equal(swAddress.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
    assert.equal(workerAddress.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())

    assert.equal(finalBalance.toNumber(), newBalance.add(balanceTransfered).toNumber())
  })
})

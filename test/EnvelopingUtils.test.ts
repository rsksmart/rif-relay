import { ChildProcessWithoutNullStreams } from 'child_process'
import { BN, toBuffer } from 'ethereumjs-util'
import { configure, EnvelopingConfig } from '../Configurator'
import { EnvelopingUtils, isSameAddress, SignatureProvider } from '../src/common/Utils'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { Address, IntString } from '../src/relayclient/types/Aliases'
import { ProxyFactoryInstance, RelayHubInstance, SmartWalletInstance, StakeManagerInstance, TestDeployVerifierEverythingAcceptedInstance, TestRecipientInstance, TestTokenInstance, TestVerifierEverythingAcceptedInstance } from '../types/truffle-contracts'
import { createProxyFactory, deployHub, getExistingGaslessAccount, getTestingEnvironment, startRelay, stopRelay } from './TestUtils'
import { constants } from '../src/common/Constants'
import { randomHex, soliditySha3Raw } from 'web3-utils'
import { expectEvent } from '@openzeppelin/test-helpers'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import { PrefixedHexString } from 'ethereumjs-tx'
import { DeployRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import sigUtil from 'eth-sig-util'

const TestRecipient = artifacts.require('tests/TestRecipient')
const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const SmartWallet = artifacts.require('SmartWallet')
const TestVerifierEverythingAccepted = artifacts.require('tests/TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('tests/TestDeployVerifierEverythingAccepted')
const ProxyFactory = artifacts.require('ProxyFactory')

const localhost = 'http://localhost:8090'
const message = 'hello world'

contract('Enveloping utils', () => {
  let enveloping: EnvelopingUtils
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

  const signatureProvider: SignatureProvider = {
    sign: (dataToSign: TypedRequestData, privKey?: Buffer) => {
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
    const deploySignature = enveloping.signDeployRequest(signatureProvider, deployRequest, gaslessAccount.privateKey)
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
    const relayRequest = await enveloping.createRelayRequest(gaslessAccount.address, testRecipient.address, encodedFunction, gasLimit, tokenContract, tokenAmount, tokenGas, '1000000000')
    const relaySignature = enveloping.signRelayRequest(signatureProvider, relayRequest, gaslessAccount.privateKey)
    const httpRelayRequest = await enveloping.generateRelayTransactionRequest(relaySignature, relayRequest)
    const sentRelayTransaction = await enveloping.sendTransaction(localhost, httpRelayRequest)
    return sentRelayTransaction.transaction?.hash(true).toString('hex')
  }

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
    tokenContract = await TestToken.new()
    relayHub = await deployHub(stakeManager.address)
  })

  beforeEach(async () => {
    index = randomHex(32)
    swAddress = await factory.getSmartWalletAddress(gaslessAccount.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, soliditySha3Raw({ t: 'bytes', v: '0x' }), index)

    const partialConfig: Partial<EnvelopingConfig> =
    {
      relayHubAddress: relayHub.address,
      proxyFactoryAddress: factory.address,
      chainId: chainId,
      relayVerifierAddress: verifier.address,
      deployVerifierAddress: deployVerifier.address,
      preferredRelays: ['http://localhost:8090'],
      forwarderAddress: swAddress
    }

    config = configure(partialConfig)
    const serverData = await startRelay(relayHub.address, stakeManager, {
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
    enveloping = new EnvelopingUtils(config, web3, workerAddress)
    await enveloping._init()
  })

  afterEach(async function () {
    await stopRelay(relayproc)
  })

  it('Should deploy a smart wallet correctly and relay a tx using enveloping utils without tokens', async () => {
    const expectedInitialCode = await web3.eth.getCode(swAddress)
    assert.equal('0x00', expectedInitialCode)

    const txDeployHash = await deploySmartWallet(constants.ZERO_ADDRESS, '0', '0')
    await expectEvent.inTransaction(txDeployHash, ProxyFactory, 'Deployed')
    await assertSmartWalletDeployedCorrectly(swAddress)

    const txRelayHash = await relayTransaction(constants.ZERO_ADDRESS, '0', '0')
    if (txRelayHash !== undefined) {
      await expectEvent.inTransaction(txRelayHash, TestRecipient, 'SampleRecipientEmitted', {
        message: message
      })
    } else {
      assert.fail('Transacion has not been send or it threw an error')
    }
  })

  it('Should deploy a smart wallet correctly and relay a tx using enveloping utils paying with tokens', async () => {
    const expectedInitialCode = await web3.eth.getCode(swAddress)
    const balanceTransfered = new BN(10)
    assert.equal('0x00', expectedInitialCode)
    await tokenContract.mint('100', swAddress)
    const previousBalance = await tokenContract.balanceOf(workerAddress)

    const txDeployHash = await deploySmartWallet(tokenContract.address, '10', '50000')
    await expectEvent.inTransaction(txDeployHash, ProxyFactory, 'Deployed')

    await assertSmartWalletDeployedCorrectly(swAddress)

    const newBalance = await tokenContract.balanceOf(workerAddress)
    assert.equal(newBalance.toNumber(), previousBalance.add(balanceTransfered).toNumber())

    const txRelayHash = await relayTransaction(tokenContract.address, '10', '50000')
    if (txRelayHash !== undefined) {
      const finalBalance = await tokenContract.balanceOf(workerAddress)
      await expectEvent.inTransaction(txRelayHash, TestRecipient, 'SampleRecipientEmitted', {
        message: 'hello world'
      })
      assert.equal(finalBalance.toNumber(), newBalance.add(balanceTransfered).toNumber())
    } else {
      assert.fail('Transacion has not been send')
    }
  })
})

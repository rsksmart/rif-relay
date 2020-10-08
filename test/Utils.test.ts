/* global describe it web3 */
// @ts-ignore
import { recoverTypedSignature_v4, TypedDataUtils } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'
import chai from 'chai'
import { HttpProvider } from 'web3-core'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData, {
  getDomainSeparatorHash,
  GsnDomainSeparatorType, GsnRequestType
} from '../src/common/EIP712/TypedRequestData'
import { expectEvent } from '@openzeppelin/test-helpers'
import { SmartWalletInstance, TestRecipientInstance, TestUtilInstance, ProxyFactoryInstance, TestGSNUtilsInstance} from '../types/truffle-contracts'
import { PrefixedHexString } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { encodeRevertReason, createProxyFactory, createSmartWallet } from './TestUtils'
import CommandsLogic from '../src/cli/CommandsLogic'
import { configureGSN, GSNConfig, resolveConfigurationGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment } from '../src/common/Environments'
import { Web3Provider } from '../src/relayclient/ContractInteractor'
import ForwardRequest from '../src/common/EIP712/ForwardRequest'
import { constants } from '../src/common/Constants'
require('source-map-support').install({ errorFormatterForce: true })

// import web3Utils from 'web3-utils'

const { expect, assert } = chai.use(chaiAsPromised)

const TestUtil = artifacts.require('TestUtil')
const TestRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')

const TestGSNUtils = artifacts.require('TestGSNUtils')
interface SplittedRelayRequest {
  request: ForwardRequest
  encodedRelayData: string
}

contract('Utils', function (accounts) {
  describe('#getEip712Signature()', function () {
    // ganache always reports chainId as '1'
    let chainId: number
    let forwarder: PrefixedHexString
    let relayRequest: RelayRequest
    const senderAddress = accounts[0]
    let testUtil: TestUtilInstance
    let recipient: TestRecipientInstance

    let forwarderInstance: SmartWalletInstance
    before(async () => {
      testUtil = await TestUtil.new()
      chainId = (await testUtil.libGetChainID()).toNumber()
      const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
      forwarderInstance = await createSmartWallet(senderAddress, factory, chainId)
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new()

      const senderNonce = '0'
      const target = recipient.address
      const encodedFunction = '0xdeadbeef'
      const pctRelayFee = '15'
      const baseRelayFee = '1000'
      const gasPrice = '10000000'
      const gasLimit = '500000'
      // const forwarder = accounts[6]
      const paymaster = accounts[7]
      const relayWorker = accounts[9]
      const paymasterData = '0x'
      const clientId = '0'

      const res1 = await forwarderInstance.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version)
      console.log(res1.logs[0])
      const { domainSeparator } = res1.logs[0].args

      // sanity check: our locally-calculated domain-separator is the same as on-chain registered domain-separator
      assert.equal(domainSeparator, getDomainSeparatorHash(forwarder, chainId))

      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )

      const typeName = res.logs[0].args.typeStr

      relayRequest = {
        request: {
          to: target,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          tokenRecipient: constants.ZERO_ADDRESS,
          tokenContract: constants.ZERO_ADDRESS,
          tokenAmount: '0',
          factory: constants.ZERO_ADDRESS, // only set if this is a deploy request
          recoverer: constants.ZERO_ADDRESS, // since we are calling a contract in this test, we cannot ommit it
          index: '0' // since we are calling a contract in this test, we cannot ommit it
        },
        relayData: {
          gasPrice,
          pctRelayFee,
          baseRelayFee,
          relayWorker,
          forwarder,
          paymaster,
          paymasterData,
          clientId
        }
      }
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )
      assert.equal(typeName, TypedDataUtils.encodeType(dataToSign.primaryType, dataToSign.types))
    })

    it('#_getEncoded should extract data exactly as local encoded data', async () => {
      // @ts-ignore
      const { forwardRequest, typeHash, suffixData } = await testUtil.splitRequest(relayRequest)
      const getEncoded = await forwarderInstance._getEncoded(forwardRequest, typeHash, suffixData)
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )
      const localEncoded = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types))
      assert.equal(getEncoded, localEncoded)
    })

    it('library constants should match RelayHub eip712 constants', async function () {
      assert.equal(GsnRequestType.typeName, await testUtil.libRelayRequestName())
      assert.equal(GsnRequestType.typeSuffix, await testUtil.libRelayRequestSuffix())

      const res1 = await forwarderInstance.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version)
      console.log(res1.logs[0])
      const { domainSeparator } = res1.logs[0].args
      assert.equal(domainSeparator, await testUtil.libDomainSeparator(forwarder))

      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )
      const { typeStr, typeHash } = res.logs[0].args

      assert.equal(typeStr, await testUtil.libRelayRequestType())
      assert.equal(typeHash, await testUtil.libRelayRequestTypeHash())
    })

    it('should use same domainSeparator on-chain and off-chain', async () => {
      assert.equal(getDomainSeparatorHash(forwarder, chainId), await testUtil.libDomainSeparator(forwarder))
    })

    it('should generate a valid EIP-712 compatible signature', async function () {
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )

      const sig = await getEip712Signature(
        web3,
        dataToSign
      )

      const recoveredAccount = recoverTypedSignature_v4({
        data: dataToSign,
        sig
      })
      assert.strictEqual(senderAddress.toLowerCase(), recoveredAccount.toLowerCase())

      await testUtil.callForwarderVerify(relayRequest, sig)
    })

    describe('#callForwarderVerifyAndCall', () => {
      it('should return revert result', async function () {
        relayRequest.request.data = await recipient.contract.methods.testRevert().encodeABI()
        const sig = await getEip712Signature(
          web3, new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ))
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        const expectedReturnValue = encodeRevertReason('always fail')
        expectEvent(ret, 'Called', {
          success: false,
          error: expectedReturnValue
        })
      })
      it('should call target', async function () {
        relayRequest.request.data = await recipient.contract.methods.emitMessage('hello').encodeABI()
        relayRequest.request.nonce = (await forwarderInstance.getNonce()).toString()

        const sig = await getEip712Signature(
          web3, new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ))
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        expectEvent(ret, 'Called', {
          error: null
        })
        const logs = await recipient.contract.getPastEvents(null, { fromBlock: 1 })
        assert.equal(logs[0].event, 'SampleRecipientEmitted')
      })
    })
  })

  describe('#resolveGSNDeploymentFromPaymaster()', function () {
    it('should resolve the deployment from paymaster', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const defaultConfiguration = configureGSN({})
      const commandsLogic = new CommandsLogic(host, defaultConfiguration)
      const deploymentResult = await commandsLogic.deployGsnContracts({
        from: accounts[0],
        gasPrice: '1',
        deployPaymaster: true,
        skipConfirmation: true,
        relayHubConfiguration: defaultEnvironment.relayHubConfiguration
      })
      const minGasPrice = 777
      const partialConfig: Partial<GSNConfig> = {
        paymasterAddress: deploymentResult.naivePaymasterAddress,
        minGasPrice
      }
      const resolvedPartialConfig = await resolveConfigurationGSN(web3.currentProvider as Web3Provider, partialConfig)
      assert.equal(resolvedPartialConfig.paymasterAddress, deploymentResult.naivePaymasterAddress)
      assert.equal(resolvedPartialConfig.relayHubAddress, deploymentResult.relayHubAddress)
      assert.equal(resolvedPartialConfig.minGasPrice, minGasPrice, 'Input value lost')
      assert.equal(resolvedPartialConfig.sliceSize, defaultConfiguration.sliceSize, 'Unexpected value appeared')
    })

    it('should throw if no paymaster at address', async function () {
      await expect(resolveConfigurationGSN(
        web3.currentProvider as Web3Provider, {})
      ).to.be.eventually.rejectedWith('Cannot resolve GSN deployment without paymaster address')
    })
  })
})

contract('TestGSNUtils', function (accounts) {
  let testGSNUtils: TestGSNUtilsInstance

  beforeEach(async () => {
    testGSNUtils = await TestGSNUtils.new()
  })

  describe('Check correctness of functions', function () {
    it('should correctly check if address is contract', async function () {
      assert.equal(await testGSNUtils._isContract(accounts[0]), false, 'Input is not contract')
      assert.equal(await testGSNUtils._isContract(testGSNUtils.address), true, 'Input IS contract')
    })

    it.only('should correctly return wanted bytes param', async function () {
      const owner = accounts[0]
      const logic = accounts[1]
      const paymentToken = accounts[2]
      const recipient = accounts[3]
      const deployPrice = 46
      const logicInitGas = 100000
      const initParams = '0x43532420'
      const sig = '0x1fdf77b663cd5082669f97b136f87f8322a23e6c494cb0c5929f4581b6aaa0161b20485f69455eeb2e59e321e8b9751855955e38fe5b9cc1e45d5d82ca92b6b81b'

      let data = 'FFFFFFFF' + web3.eth.abi.encodeParameters(['address', 'address', 'address', 'address',
        'uint256', 'uint256', 'bytes', 'bytes'], [owner, logic, paymentToken, recipient, deployPrice, logicInitGas, initParams, sig])
      data = data.replace('0x', '')
      data = '0x' + data

      const resultInitParams = await testGSNUtils.getBytesParam(data, 6)
      assert.equal(resultInitParams, initParams, 'Param incorectly decoded')

      const resultOwner = await testGSNUtils.getParam(data, 0)
      assert(web3.utils.toBN(owner).eq(resultOwner), 'Param incorectly decoded')

      const resultLogic = await testGSNUtils.getParam(data, 1)
      assert(web3.utils.toBN(logic).eq(resultLogic), 'Param incorectly decoded')
    })
  })
})

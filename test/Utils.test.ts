/* global describe it web3 */
// @ts-ignore
import { recoverTypedSignature_v4, TypedDataUtils } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'
import chai from 'chai'
import { HttpProvider } from 'web3-core'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import TypedRequestData, { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { expectEvent } from '@openzeppelin/test-helpers'
import { SmartWalletInstance, TestRecipientInstance, TestUtilInstance, ProxyFactoryInstance, TestTokenRecipientInstance } from '../types/truffle-contracts'
import { PrefixedHexString } from 'ethereumjs-tx'
import { BN, bufferToHex } from 'ethereumjs-util'
import { encodeRevertReason, createProxyFactory, createSmartWallet, getGaslessAccount } from './TestUtils'
import CommandsLogic from '../src/cli/CommandsLogic'
import { configureGSN, GSNConfig, resolveConfigurationGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment } from '../src/common/Environments'
import { Web3Provider } from '../src/relayclient/ContractInteractor'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { getLocalEip712Signature } from '../src/common/Utils'
require('source-map-support').install({ errorFormatterForce: true })

// import web3Utils from 'web3-utils'

const { expect, assert } = chai.use(chaiAsPromised)

const TestUtil = artifacts.require('TestUtil')
const TestRecipient = artifacts.require('TestRecipient')
const TestTokenRecipient = artifacts.require('TestTokenRecipient')
const SmartWallet = artifacts.require('SmartWallet')

const tokenReceiverAddress = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'

contract('Utils', function (accounts) {
  // This test verifies signing typed data with a local implementation of signTypedData
  describe('#getLocalEip712Signature()', function () {
    // ganache always reports chainId as '1'
    let senderAccount: AccountKeypair
    let chainId: number
    let forwarder: PrefixedHexString
    let relayRequest: RelayRequest
    let senderAddress: string
    let senderPrivateKey: Buffer
    let testUtil: TestUtilInstance
    let recipient: TestRecipientInstance
    let testTokenRecipient: TestTokenRecipientInstance

    let forwarderInstance: SmartWalletInstance
    before(async () => {
      senderAccount = await getGaslessAccount()
      senderAddress = senderAccount.address
      senderPrivateKey = senderAccount.privateKey
      testUtil = await TestUtil.new()
      chainId = (await testUtil.libGetChainID()).toNumber()
      const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
      forwarderInstance = await createSmartWallet(senderAddress, factory, senderPrivateKey, chainId)
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new()
      testTokenRecipient = await TestTokenRecipient.new()

      const senderNonce = '0'
      const target = recipient.address
      const encodedFunction = '0xdeadbeef'
      const pctRelayFee = '15'
      const baseRelayFee = '1000'
      const gasPrice = '10000000'
      const gasLimit = '500000'
      const paymaster = accounts[7]
      const relayWorker = accounts[9]
      const paymasterData = '0x'
      const clientId = '0'

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

    it('should use same domainSeparator on-chain and off-chain', async () => {
      assert.equal(getDomainSeparatorHash(forwarder, chainId), await testUtil.libDomainSeparator(forwarder))
    })

    it('should generate a valid EIP-712 compatible signature', async function () {
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )

      const sig = await getLocalEip712Signature(
        dataToSign,
        senderPrivateKey
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
        const sig = await getLocalEip712Signature(
          new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ), senderPrivateKey)
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        const expectedReturnValue = encodeRevertReason('always fail')
        expectEvent(ret, 'Called', {
          success: false,
          error: expectedReturnValue
        })
      })
      it('should call target', async function () {
        relayRequest.request.data = await recipient.contract.methods.emitMessage('hello').encodeABI()
        relayRequest.request.nonce = (await forwarderInstance.nonce()).toString()

        const sig = await getLocalEip712Signature(
          new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ), senderPrivateKey)
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        expectEvent(ret, 'Called', {
          error: null
        })
        const logs = await recipient.contract.getPastEvents(null, { fromBlock: 1 })
        assert.equal(logs[0].event, 'SampleRecipientEmitted')
      })
    })

    describe('#callForwarderVerifyAndCallInvokingTokenContract', () => {
      it('should return revert result because token payment without balance', async function () {
        relayRequest.request.to = testTokenRecipient.address
        relayRequest.request.nonce = (await forwarderInstance.nonce()).toString()
        relayRequest.request.data = await testTokenRecipient.contract.methods.transfer(tokenReceiverAddress, '5').encodeABI()
        const startPayerBalance = await testTokenRecipient.balanceOf(forwarder)
        const sig = await getLocalEip712Signature(
          new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ), senderPrivateKey)
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        const expectedReturnValue = encodeRevertReason('ERC20: transfer amount exceeds balance')
        expectEvent(ret, 'Called', {
          success: false,
          error: expectedReturnValue
        })
        const balance = await testTokenRecipient.balanceOf(tokenReceiverAddress)
        chai.expect('0').to.be.bignumber.equal(balance)
        const lastPayerBalance = await testTokenRecipient.balanceOf(forwarder)
        assert.equal(startPayerBalance.toString(), lastPayerBalance.toString())
      })

      it('should call token contract', async function () {
        await testTokenRecipient.mint('200', forwarder)
        const tokenToTransfer = 5
        const startPayerBalance = await testTokenRecipient.balanceOf(forwarder)
        relayRequest.request.to = testTokenRecipient.address
        relayRequest.request.nonce = (await forwarderInstance.nonce()).toString()
        relayRequest.request.data = await testTokenRecipient.contract.methods.transfer(tokenReceiverAddress, tokenToTransfer.toString()).encodeABI()
        const sig = await getLocalEip712Signature(
          new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ), senderPrivateKey)
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        const balance = await testTokenRecipient.balanceOf(tokenReceiverAddress)
        chai.expect('5').to.be.bignumber.equal(balance)
        expectEvent(ret, 'Called', {
          error: null
        })
        const logs = await testTokenRecipient.contract.getPastEvents(null, { fromBlock: 1 })
        assert.equal(logs[0].event, 'Transfer')
        const lastPayerBalance = await testTokenRecipient.balanceOf(forwarder)
        assert.equal(startPayerBalance.sub(new BN(tokenToTransfer)).toString(), lastPayerBalance.toString())
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
        deployPaymasters: true,
        skipConfirmation: true,
        relayHubConfiguration: defaultEnvironment.relayHubConfiguration
      })
      const minGasPrice = 777
      const partialConfig: Partial<GSNConfig> = {
        relayPaymasterAddress: deploymentResult.naiveRelayPaymasterAddress,
        deployPaymasterAddress: deploymentResult.naiveDeployPaymasterAddress,
        minGasPrice
      }
      const resolvedPartialConfig = await resolveConfigurationGSN(web3.currentProvider as Web3Provider, partialConfig)
      assert.equal(resolvedPartialConfig.relayPaymasterAddress, deploymentResult.naiveRelayPaymasterAddress)
      assert.equal(resolvedPartialConfig.deployPaymasterAddress, deploymentResult.naiveDeployPaymasterAddress)
      assert.equal(resolvedPartialConfig.relayHubAddress, deploymentResult.relayHubAddress)
      assert.equal(resolvedPartialConfig.minGasPrice, minGasPrice, 'Input value lost')
      assert.equal(resolvedPartialConfig.sliceSize, defaultConfiguration.sliceSize, 'Unexpected value appeared')
    })

    it('should throw if no paymaster at address', async function () {
      await expect(resolveConfigurationGSN(
        web3.currentProvider as Web3Provider, {})
      ).to.be.eventually.rejectedWith('Cannot resolve GSN deployment without relayer paymaster address')
    })
  })
})

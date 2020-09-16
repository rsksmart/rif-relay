/* global describe it web3 */
// @ts-ignore
import { recoverTypedSignature_v4, TypedDataUtils } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'
import chai from 'chai'
import { HttpProvider } from 'web3-core'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData, { getDomainSeparatorHash, GsnRequestType } from '../src/common/EIP712/TypedRequestData'
import { expectEvent } from '@openzeppelin/test-helpers'
import { ForwarderInstance, TestRecipientInstance, TestUtilInstance, TestTokenInstance } from '../types/truffle-contracts'
import { PrefixedHexString } from 'ethereumjs-tx'
import { BN, bufferToHex } from 'ethereumjs-util'
import { encodeRevertReason } from './TestUtils'
import CommandsLogic from '../src/cli/CommandsLogic'
import { configureGSN, GSNConfig, resolveConfigurationGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment } from '../src/common/Environments'

// import web3Utils from 'web3-utils'

const { expect, assert } = chai.use(chaiAsPromised)

const TestUtil = artifacts.require('TestUtil')
const Forwarder = artifacts.require('Forwarder')
const TestRecipient = artifacts.require('TestRecipient')
const TestToken = artifacts.require('TestToken')

import ForwardRequest from '../src/common/EIP712/ForwardRequest'
import RelayData from '../src/common/EIP712/RelayData'
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
    let tokenContract: TestTokenInstance
    let tokenAddress: string


    let forwardRequest: ForwardRequest
    let anotherForwardRequest: ForwardRequest
    let relayData: RelayData
    let anotherRelayData: RelayData

    let forwarderInstance: ForwarderInstance
    beforeEach(async () => {
      testUtil = await TestUtil.new()
      chainId = (await testUtil.libGetChainID()).toNumber()
      forwarderInstance = await Forwarder.new()
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new(forwarder)
      tokenContract = await TestToken.new()
      tokenAddress = tokenContract.address

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

      await tokenContract.mint('1000', forwarder)
      
      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )

      const typeName = res.logs[0].args.typeStr

      const tokenPayment = {
        tokenRecipient: recipient.address,
        tokenContract: tokenAddress,
        paybackTokens: '1',
        tokenGas: gasLimit
      }
      
      forwardRequest = {
        to: target,
        data: encodedFunction,
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        ...tokenPayment
      };

      anotherForwardRequest = {
        ...forwardRequest,
        data: '0xcafebabe',
        nonce: '1'
      }

      relayData = {
        gasPrice,
        pctRelayFee,
        baseRelayFee,
        relayWorker,
        forwarder,
        paymaster,
        paymasterData,
        clientId
      };

      anotherRelayData = {
        ...relayData,
        clientId: '1'
      }

      relayRequest = {
        request: {
          to: target,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          ...tokenPayment
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

    /*
    it.only('Debug contract signature', async () => {
      console.log(`Chain id = ${await testUtil.libGetChainID()}`)

      // @ts-ignore
      const { forwardRequest, typeHash, suffixData } = await testUtil.splitRequest(relayRequest)

      console.log(`Relay request = ${JSON.stringify(relayRequest)}`);
      console.log(`Forward request = ${JSON.stringify(forwardRequest)}`);
      console.log(`Type hash = ${JSON.stringify(typeHash)}`);
      console.log(`Suffix data = ${JSON.stringify(suffixData)}`);

      console.log(await testUtil.libEncodedDomain(forwarder));
      console.log(await testUtil.libEncodedData(relayRequest.relayData));
      console.log(await testUtil.libEncodedRequest(forwardRequest, typeHash, suffixData));
    })
    */


    //SKIPPED: RSK WIP to support multiple relay requests in a single relay, if it's unskipped tknPayment must be fixed
    it.skip("Signs typed data with multiple relay requests", async () => {
      /*
      const relayRequests = [
        {
          request: forwardRequest,
          relayData
        },
        {
          request: anotherForwardRequest,
          relayData: anotherRelayData
        }
      ]
      */
     const tknPayment = {
      tokenRecipient: '',
      tokenContract: '',
      paybackTokens: '0',
      tokenGas: 0
    }
      const relayRequests = [
        {
          request: {
            to: '0xD1F0892ecce4f9f6f37D34634fF956A17BD647ed',
            data: '0xdeadbeef',
            from: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            nonce: '0',
            value: '0',
            gas: '500000',
            ...tknPayment
          },
          relayData: {
            gasPrice: '10000000',
            pctRelayFee: '15',
            baseRelayFee: '1000',
            relayWorker: '0x09a1edA29F664ac8f68106F6567276dF0C65D859',
            forwarder: '0x0C24045B556ec463aD2F7253D1843d336682fb86',
            paymaster: '0x7857288e171C6159C5576d1bD9AC40c0c48a771C',
            paymasterData: '0x',
            clientId: '0'
          }
        },
        {
          request: {
            to: '0xD1F0892ecce4f9f6f37D34634fF956A17BD647ed',
            data: '0xcafebabe',
            from: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            nonce: '1',
            value: '0',
            gas: '500000',
            ...tknPayment
          },
          relayData: {
            gasPrice: '10000000',
            pctRelayFee: '15',
            baseRelayFee: '1000',
            relayWorker: '0x09a1edA29F664ac8f68106F6567276dF0C65D859',
            forwarder: '0x0C24045B556ec463aD2F7253D1843d336682fb86',
            paymaster: '0x7857288e171C6159C5576d1bD9AC40c0c48a771C',
            paymasterData: '0x',
            clientId: '1'
          }
        }
      ]
      
      //console.log(`Relay requests = ${JSON.stringify(relayRequests)}`)

      const result = await testUtil.mockExecute(
        relayRequests,
        '0x0C24045B556ec463aD2F7253D1843d336682fb86',
        '0xdeadbeef')
        
      // The expected result is what the node is returning when encoding relayRequests
      assert.equal(result, "0xeffdafba17bae0af215feb069260ee187b6152c054a0b8f0a27b826de93d9cb8")
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
        
        const tknBalance = await tokenContract.balanceOf(recipient.address)
        assert.isTrue(new BN(1).eq(tknBalance))

        expectEvent(ret, 'Called', {
          success: false,
          error: expectedReturnValue
        })
      })
      it('should call target', async function () {
        relayRequest.request.data = await recipient.contract.methods.emitMessage('hello').encodeABI()
        relayRequest.request.nonce = (await forwarderInstance.getNonce(relayRequest.request.from)).toString()

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

        const tknBalance = await tokenContract.balanceOf(recipient.address)
        assert.isTrue(new BN(1).eq(tknBalance))
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
      const resolvedPartialConfig = await resolveConfigurationGSN(web3.currentProvider, partialConfig)
      assert.equal(resolvedPartialConfig.paymasterAddress, deploymentResult.naivePaymasterAddress)
      assert.equal(resolvedPartialConfig.stakeManagerAddress, deploymentResult.stakeManagerAddress)
      assert.equal(resolvedPartialConfig.relayHubAddress, deploymentResult.relayHubAddress)
      assert.equal(resolvedPartialConfig.minGasPrice, minGasPrice, 'Input value lost')
      assert.equal(resolvedPartialConfig.sliceSize, defaultConfiguration.sliceSize, 'Unexpected value appeared')
    })

    it('should throw if no paymaster at address', async function () {
      await expect(resolveConfigurationGSN(
        web3.currentProvider, {})
      ).to.be.eventually.rejectedWith('Cannot resolve GSN deployment without paymaster address')
    })
  })
})

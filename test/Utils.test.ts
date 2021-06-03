// @ts-ignore
import { recoverTypedSignature_v4 } from 'eth-sig-util'
import { expect } from 'chai'

import { RelayRequest } from '../src/common/EIP712/RelayRequest'
import TypedRequestData, { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { createSmartWalletFactory, createSmartWallet, encodeRevertReason } from './TestUtils'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { getLocalEip712Signature } from '../src/common/Utils'
import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { SmartWallet, SmartWalletFactory, SmartWallet__factory, TestRecipient, TestRecipient__factory, TestUtil, TestUtil__factory } from '../typechain'
import { PrefixedHexString } from '../src/relayclient/types/Aliases'
// require('source-map-support').install({ errorFormatterForce: true })

// contract('Utils', function (accounts) {
// This test verifies signing typed data with a local implementation of signTypedData
describe('#getLocalEip712Signature()', function () {
  // ganache always reports chainId as '1'
  let senderAccount: AccountKeypair
  let chainId: number
  let forwarder: PrefixedHexString
  let relayRequest: RelayRequest
  let senderAddress: string
  let senderPrivateKey: Uint8Array
  let testUtil: TestUtil
  let recipient: TestRecipient
  let forwarderInstance: SmartWallet
  before(async () => {
    const accounts: Signer[] = await ethers.getSigners()
    const sender = ethers.Wallet.createRandom()
    const privateKey = ethers.utils.arrayify(sender.privateKey)
    const address = sender.address
    senderAccount = { privateKey, address }
    senderAddress = senderAccount.address
    senderPrivateKey = senderAccount.privateKey
    // testUtil = await TestUtil.new()
    const TestUtil = await ethers.getContractFactory('TestUtil') as TestUtil__factory
    testUtil = await TestUtil.deploy()
    await testUtil.deployed()
    chainId = (await testUtil.libGetChainID()).toNumber()
    // const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
    const smartWalletTemplate = await SmartWallet.deploy()
    await smartWalletTemplate.deployed()

    const factory: SmartWalletFactory = await createSmartWalletFactory(smartWalletTemplate)
    forwarderInstance = await createSmartWallet(await accounts[0].getAddress(), senderAddress, factory, senderPrivateKey, chainId)
    forwarder = forwarderInstance.address

    const TestRecipient = await ethers.getContractFactory('TestRecipient') as TestRecipient__factory
    recipient = await TestRecipient.deploy()
    await recipient.deployed()

    const senderNonce = '0'
    const target = recipient.address
    const encodedFunction = '0xdeadbeef'
    const gasPrice = '1'
    const gasLimit = '1000000'
    const verifier = await accounts[7].getAddress()
    const relayWorker = await accounts[9].getAddress()

    relayRequest = {
      request: {
        relayHub: testUtil.address,
        to: target,
        data: encodedFunction,
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '0',
        tokenGas: '0'
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

  it('should generate a valid EIP-712 compatible signature', async function () {
    const dataToSign = new TypedRequestData(
      chainId,
      forwarder,
      relayRequest
    )

    const sig = getLocalEip712Signature(
      dataToSign,
      senderPrivateKey
    )

    const recoveredAccount = recoverTypedSignature_v4({
      data: dataToSign,
      sig
    })
    expect(senderAddress.toLowerCase()).to.be.equals(recoveredAccount.toLowerCase())
    await testUtil.callForwarderVerify(relayRequest, sig)
  })

  describe('#callForwarderVerifyAndCall', () => {
    it('should return revert result', async function () {
      relayRequest.request.data = (await recipient.populateTransaction.testRevert()).data ?? ''
      const sig = getLocalEip712Signature(
        new TypedRequestData(
          chainId,
          forwarder,
          relayRequest
        ), senderPrivateKey)

      const recoveredAccount = recoverTypedSignature_v4({
        data: new TypedRequestData(
          chainId,
          forwarder,
          relayRequest
        ),
        sig
      })

      expect(senderAddress.toLowerCase()).to.be.equals(recoveredAccount.toLowerCase())
      const expectedReturnValue = encodeRevertReason('always fail')
      await expect(testUtil.callForwarderVerifyAndCall(relayRequest, sig)).to.emit(testUtil, 'Called').withArgs(false, expectedReturnValue)
    })

    it('should call target', async function () {
      relayRequest.request.data = (await recipient.populateTransaction.emitMessage('hello')).data ?? ''
      relayRequest.request.nonce = (await forwarderInstance.nonce()).toString()

      const sig = getLocalEip712Signature(
        new TypedRequestData(
          chainId,
          forwarder,
          relayRequest
        ), senderPrivateKey)

      await expect(testUtil.callForwarderVerifyAndCall(relayRequest, sig)).to.emit(testUtil, 'Called')
      // const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
      // expectEvent(ret, 'Called', {
      //   error: null
      // })
      const event = recipient.filters.SampleRecipientEmitted(null, null, null, null, null)
      const eventEmitted = await recipient.queryFilter(event, 1)
      // const logs = await recipient.getPastEvents(null, { fromBlock: 1 })
      expect(eventEmitted[0].event).to.be.equal('SampleRecipientEmitted')
    })
  })
})

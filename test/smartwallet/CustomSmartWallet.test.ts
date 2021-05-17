import {
  CustomSmartWalletInstance,
  TestForwarderTargetInstance,
  TestTokenInstance
} from '../../types/truffle-contracts'

// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { BN, bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { bytes32, containsEvent, getTestingEnvironment } from '../TestUtils'
import TypedRequestData, { ForwardRequestType, getDomainSeparatorHash } from '../../src/common/EIP712/TypedRequestData'
import { constants } from '../../src/common/Constants'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import { expectRevert } from '@openzeppelin/test-helpers'

require('source-map-support').install({ errorFormatterForce: true })

const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const TestToken = artifacts.require('TestToken')
const TestSmartWallet = artifacts.require('TestSmartWallet')
const SuccessCustomLogic = artifacts.require('SuccessCustomLogic')
const FailureCustomLogic = artifacts.require('FailureCustomLogic')
const ProxyCustomLogic = artifacts.require('ProxyCustomLogic')
const CustomSmartWallet = artifacts.require('CustomSmartWallet')

async function fillTokens (token: TestTokenInstance, recipient: string, amount: string): Promise<void> {
  await token.mint(amount, recipient)
}

async function getTokenBalance (token: TestTokenInstance, account: string): Promise<BN> {
  return await token.balanceOf(account)
}

contract('Custom Smart Wallet using TestToken', ([worker, fundedAccount]) => {
  const countParams = ForwardRequestType.length
  const senderPrivateKey = toBuffer(bytes32(1))
  let chainId: number
  let senderAddress: string
  let token: TestTokenInstance
  let smartWallet: CustomSmartWalletInstance
  let domainSeparatorHash: string

  const request: RelayRequest = {
    request: {
      relayHub: constants.ZERO_ADDRESS,
      from: constants.ZERO_ADDRESS,
      to: constants.ZERO_ADDRESS,
      value: '0',
      gas: '1000000',
      nonce: '0',
      data: '0x',
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '1',
      tokenGas: '50000'
    },
    relayData: {
      gasPrice: '1',
      domainSeparator: '0x',
      relayWorker: constants.ZERO_ADDRESS,
      callForwarder: constants.ZERO_ADDRESS,
      callVerifier: constants.ZERO_ADDRESS
    }
  }

  before(async () => {
    chainId = (await getTestingEnvironment()).chainId
    senderAddress = bufferToHex(privateToAddress(senderPrivateKey)).toLowerCase()
    request.request.from = senderAddress
    token = await TestToken.new()
    request.request.tokenContract = token.address
  })

  beforeEach(async () => {
    smartWallet = await CustomSmartWallet.new()
    request.relayData.callForwarder = smartWallet.address
    request.relayData.domainSeparator = getDomainSeparatorHash(smartWallet.address, chainId)
    domainSeparatorHash = request.relayData.domainSeparator
  })

  describe('#verifyAndCall', () => {
    let recipient: TestForwarderTargetInstance

    beforeEach(async () => {
      await fillTokens(token, smartWallet.address, '1000')
      recipient = await TestForwarderTarget.new()
      request.request.tokenAmount = '0'
    })

    it('should call function with custom logic', async () => {
      // Init smart wallet and
      const customLogic = await SuccessCustomLogic.new()
      await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const req1 = { ...request }
      req1.request.data = func
      req1.request.to = recipient.address
      req1.request.nonce = initialNonce.toString()
      req1.request.tokenAmount = '1'
      req1.request.relayHub = worker
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, req1)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      const result = await smartWallet.execute(domainSeparatorHash, suffixData, req1.request, sig, { from: worker })

      // @ts-ignore
      assert(containsEvent(customLogic.abi, result.receipt.rawLogs, 'LogicCalled'), 'Should call custom logic')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
      assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')

      assert.equal((await smartWallet.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
    })

    it("should call function from custom logic with wallet's address", async () => {
      // Init smart wallet and
      const customLogic = await ProxyCustomLogic.new()
      await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const req1 = { ...request }
      req1.request.data = func
      req1.request.to = recipient.address
      req1.request.nonce = initialNonce.toString()
      req1.request.tokenAmount = '1'
      req1.request.relayHub = worker
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, req1)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      const result = await smartWallet.execute(domainSeparatorHash, suffixData, req1.request, sig, { from: worker })

      // @ts-ignore
      assert(containsEvent(customLogic.abi, result.receipt.rawLogs, 'LogicCalled'), 'Should call custom logic')

      // @ts-ignore
      const logs = await recipient.getPastEvents('TestForwarderMessage')
      assert.equal(logs.length, 1, 'TestRecipient should emit')
      assert.equal(logs[0].args.origin, worker, 'test "from" account is the tx.origin')
      assert.equal(logs[0].args.msgSender, smartWallet.address, 'msg.sender must be the smart wallet address')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
      assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')

      assert.equal((await smartWallet.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
    })

    it('should revert if logic revert', async () => {
      const customLogic = await FailureCustomLogic.new()
      await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')

      const hub = await TestSmartWallet.new()

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const req1 = { ...request }
      req1.request.data = func
      req1.request.to = recipient.address
      req1.request.nonce = initialNonce.toString()
      req1.request.tokenAmount = '1'
      req1.request.relayHub = hub.address
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, req1)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      const result = await hub.callExecute(smartWallet.address, req1.request, domainSeparatorHash, suffixData, sig, { from: worker })
      assert.equal(result.logs[0].args.error, 'always fail', 'Incorrect message')
      assert.equal(result.logs[0].args.success, false, 'Should have failed')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
      assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')

      assert.equal((await smartWallet.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
    })

    it('should not be able to re-submit after revert', async () => {
      const customLogic = await FailureCustomLogic.new()
      await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')

      const hub = await TestSmartWallet.new()

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const req1 = { ...request }
      req1.request.data = func
      req1.request.to = recipient.address
      req1.request.nonce = initialNonce.toString()
      req1.request.tokenAmount = '1'
      req1.request.relayHub = hub.address
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, req1)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      const result = await hub.callExecute(smartWallet.address, req1.request, domainSeparatorHash, suffixData, sig, { from: worker })
      assert.equal(result.logs[0].args.error, 'always fail', 'Incorrect message')
      assert.equal(result.logs[0].args.success, false, 'Should have failed')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
      assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')

      await expectRevert.unspecified(hub.callExecute(smartWallet.address, req1.request, domainSeparatorHash, suffixData, sig, { from: worker }), 'nonce mismatch')

      const tknBalance2 = await getTokenBalance(token, worker)
      const swTknBalance2 = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance2.toString(), tknBalance.toString(), 'Incorrect new worker token balance')
      assert.equal(swTknBalance2.toString(), swTknBalance.toString(), 'Incorrect new smart wallet token balance')

      assert.equal((await smartWallet.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
    })
  })

  describe('#verifyAndCallByOwner', () => {
    let recipient: TestForwarderTargetInstance

    beforeEach(async () => {
      await fillTokens(token, smartWallet.address, '1000')

      recipient = await TestForwarderTarget.new()

      request.request.tokenAmount = '0'
    })

    it('should call function with custom logic', async () => {
      // Init smart wallet and
      const customLogic = await SuccessCustomLogic.new()
      await smartWallet.initialize(fundedAccount, customLogic.address, token.address, worker, '0', '400000', '0x')

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const result = await smartWallet.directExecute(recipient.address, func, { from: fundedAccount })

      // @ts-ignore
      assert(containsEvent(customLogic.abi, result.receipt.rawLogs, 'LogicCalled'), 'Should call custom logic')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(0).toString(), 'worker token balance should not change')
      assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(0).toString(), 'smart wallet token balance should not cahnge')

      assert.equal((await smartWallet.nonce()).toString(), initialNonce.toString(), 'direct execute should NOT increment nonce')
    })

    it('should revert if logic revert', async () => {
      const customLogic = await FailureCustomLogic.new()
      await smartWallet.initialize(fundedAccount, customLogic.address, token.address, worker, '0', '400000', '0x')
      const func = recipient.contract.methods.emitMessage('hello').encodeABI()

      await smartWallet.directExecute(recipient.address, func, { from: fundedAccount })
      const result = await smartWallet.directExecute.call(recipient.address, func, { from: fundedAccount })
      assert.isTrue(!result[0], 'should revert')
    })

    it("should call function from custom logic with wallet's address", async () => {
      // Init smart wallet and
      const customLogic = await ProxyCustomLogic.new()
      await smartWallet.initialize(fundedAccount, customLogic.address, token.address, worker, '0', '400000', '0x')

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const result = await smartWallet.directExecute(recipient.address, func, { from: fundedAccount })

      // @ts-ignore
      assert(containsEvent(customLogic.abi, result.receipt.rawLogs, 'LogicCalled'), 'Should call custom logic')

      // @ts-ignore
      const logs = await recipient.getPastEvents('TestForwarderMessage')
      assert.equal(logs.length, 1, 'TestRecipient should emit')
      assert.equal(logs[0].args.origin, fundedAccount, 'test "from" account is the tx.origin')
      assert.equal(logs[0].args.msgSender, smartWallet.address, 'msg.sender must be the smart wallet address')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(0).toString(), 'worker token balance should not change')
      assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(0).toString(), 'smart wallet token balance should not cahnge')

      assert.equal((await smartWallet.nonce()).toString(), initialNonce.toString(), 'direct execute should NOT increment nonce')
    })
  })
})

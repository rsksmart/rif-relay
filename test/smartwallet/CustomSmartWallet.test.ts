// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { bytes32, emittedEvent, encodeRevertReason, getTestingEnvironment, stripHex } from '../TestUtils'
import TypedRequestData, { ForwardRequestType, getDomainSeparatorHash } from '../../src/common/EIP712/TypedRequestData'
import { constants } from '../../src/common/Constants'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import RelayData from '../../src/common/EIP712/RelayData'
import { ForwardRequest } from '../../src/common/EIP712/ForwardRequest'
import { CustomSmartWallet, CustomSmartWallet__factory, TestForwarderTarget, TestForwarderTarget__factory, TestSmartWallet__factory, TestToken, TestToken__factory } from '../../typechain'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { SuccessCustomLogic__factory } from '../../typechain/factories/SuccessCustomLogic__factory'
import { FailureCustomLogic__factory } from '../../typechain/factories/FailureCustomLogic__factory'
import { ProxyCustomLogic__factory } from '../../typechain/factories/ProxyCustomLogic__factory'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

// require('source-map-support').install({ errorFormatterForce: true })

async function fillTokens (token: TestToken, recipient: string, amount: string): Promise<void> {
  await token.mint(amount, recipient)
}

async function getTokenBalance (token: TestToken, account: string): Promise<BigNumber> {
  return await token.balanceOf(account)
}

function createRequest (request: Partial<ForwardRequest>, relayData: Partial<RelayData>): RelayRequest {
  const baseRequest: RelayRequest = {
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
  return {
    request: {
      ...baseRequest.request,
      ...request
    },
    relayData: {
      ...baseRequest.relayData,
      ...relayData
    }
  }
}

function signRequest (senderPrivateKey: Uint8Array, relayRequest: RelayRequest, chainId: number): { signature: string, suffixData: string } {
  const reqData: EIP712TypedData = new TypedRequestData(chainId, relayRequest.relayData.callForwarder, relayRequest)
  const signature = signTypedData_v4(senderPrivateKey, { data: reqData })
  const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + ForwardRequestType.length) * 32))
  return { signature, suffixData }
}

describe('Custom Smart Wallet using TestToken', () => {
  let workerSigner: SignerWithAddress
  let fundedAccountSigner: SignerWithAddress
  let worker: string
  let fundedAccount: string
  const countParams = ForwardRequestType.length
  const senderPrivateKey = ethers.utils.arrayify(bytes32(1))
  let chainId: number
  let senderAddress: string
  let token: TestToken
  let smartWallet: CustomSmartWallet
  let domainSeparatorHash: string
  let relayData: Partial<RelayData>
  let TestForwarderTarget: TestForwarderTarget__factory
  let TestToken: TestToken__factory
  let TestSmartWallet: TestSmartWallet__factory
  let SuccessCustomLogic: SuccessCustomLogic__factory
  let FailureCustomLogic: FailureCustomLogic__factory
  let ProxyCustomLogic: ProxyCustomLogic__factory
  let CustomSmartWallet: CustomSmartWallet__factory

  before(async () => {
    [workerSigner, fundedAccountSigner] = await ethers.getSigners()
    worker = await workerSigner.getAddress()
    fundedAccount = await fundedAccountSigner.getAddress()
    TestForwarderTarget = await ethers.getContractFactory('TestForwarderTarget') as TestForwarderTarget__factory
    TestToken = await ethers.getContractFactory('TestToken') as TestToken__factory
    TestSmartWallet = await ethers.getContractFactory('TestSmartWallet') as TestSmartWallet__factory
    SuccessCustomLogic = await ethers.getContractFactory('SuccessCustomLogic') as SuccessCustomLogic__factory
    FailureCustomLogic = await ethers.getContractFactory('FailureCustomLogic') as FailureCustomLogic__factory
    ProxyCustomLogic = await ethers.getContractFactory('ProxyCustomLogic') as ProxyCustomLogic__factory
    CustomSmartWallet = await ethers.getContractFactory('CustomSmartWallet') as CustomSmartWallet__factory
    senderAddress = ethers.utils.computeAddress(senderPrivateKey).toLowerCase()
    token = await TestToken.deploy()
    await token.deployed()
  })

  beforeEach(async () => {
    smartWallet = await CustomSmartWallet.deploy()
    await smartWallet.deployed()
    chainId = (await getTestingEnvironment()).chainId
    domainSeparatorHash = getDomainSeparatorHash(smartWallet.address, chainId)
    relayData = {
      callForwarder: smartWallet.address,
      domainSeparator: domainSeparatorHash
    }
  })

  describe('#verifyAndCall', () => {
    let recipient: TestForwarderTarget
    let recipientFunction: any

    beforeEach(async () => {
      await fillTokens(token, smartWallet.address, '1000')
      recipient = await TestForwarderTarget.deploy()
      await recipient.deployed()
      recipientFunction = (await recipient.populateTransaction.emitMessage('hello')).data ?? ''
    })

    it('should call function with custom logic', async () => {
      // Init smart wallet and
      const customLogic = await SuccessCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)
      const initialNonce = await smartWallet.nonce()

      const relayRequest = await createRequest({
        data: recipientFunction,
        to: recipient.address,
        nonce: initialNonce.toString(),
        relayHub: worker,
        tokenContract: token.address,
        from: senderAddress
      }, relayData)
      const { signature, suffixData } = signRequest(senderPrivateKey, relayRequest, chainId)

      const result = await smartWallet.connect(workerSigner).execute(domainSeparatorHash, suffixData, relayRequest.request, signature)
      expect(emittedEvent(customLogic, await result.wait(), 'LogicCalled()', [])).to.be.true

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new worker token balance')
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new smart wallet token balance')

      expect((await smartWallet.nonce())).to.be.equal(initialNonce.add(BigNumber.from(1)), 'verifyAndCall should increment nonce')
    })

    it("should call function from custom logic with wallet's address", async () => {
      // Init smart wallet and
      const customLogic = await ProxyCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const relayRequest = await createRequest({
        data: recipientFunction,
        to: recipient.address,
        nonce: initialNonce.toString(),
        relayHub: worker,
        tokenContract: token.address,
        from: senderAddress
      }, relayData)
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, relayRequest)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      const result = await smartWallet.connect(workerSigner).execute(domainSeparatorHash, suffixData, relayRequest.request, sig)
      expect(emittedEvent(customLogic, await result.wait(), 'LogicCalled()', [])).to.be.true

      const event = recipient.filters.TestForwarderMessage(null, null, null)
      const eventEmitted = await recipient.queryFilter(event)
      expect(eventEmitted.length).to.be.equal(1, 'TestRecipient should emit')
      expect(eventEmitted[0].args.origin).to.be.equal(worker, 'test "from" account is the tx.origin')
      expect(eventEmitted[0].args.msgSender).to.be.equal(smartWallet.address, 'msg.sender must be the smart wallet address')
      // const logs = await recipient.getPastEvents('TestForwarderMessage')
      // expect(logs.length).to.be.equal(1, 'TestRecipient should emit')
      // expect(logs[0].args.origin).to.be.equal(worker, 'test "from" account is the tx.origin')
      // expect(logs[0].args.msgSender).to.be.equal(smartWallet.address, 'msg.sender must be the smart wallet address')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new worker token balance')
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new smart wallet token balance')

      expect((await smartWallet.nonce())).to.be.equal(initialNonce.add(BigNumber.from(1)), 'verifyAndCall should increment nonce')
    })

    it('should revert if logic revert', async () => {
      const customLogic = await FailureCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      const caller = await TestSmartWallet.deploy()
      await caller.deployed()

      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const relayRequest = await createRequest({
        data: recipientFunction,
        to: recipient.address,
        nonce: initialNonce.toString(),
        relayHub: caller.address,
        tokenContract: token.address,
        from: senderAddress
      }, relayData)
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, relayRequest)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      await expect(caller.connect(workerSigner).callExecute(smartWallet.address, relayRequest.request, domainSeparatorHash, suffixData, sig))
        .to.emit(caller, 'Result').withArgs(false, 'always fail')
      // assert.equal(result.logs[0].args.error, 'always fail', 'Incorrect message')
      // assert.equal(result.logs[0].args.success, false, 'Should have failed')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new worker token balance')
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new smart wallet token balance')
      expect((await smartWallet.nonce())).to.be.equal(initialNonce.add(BigNumber.from(1)), 'verifyAndCall should increment nonce')
    })

    it('should not be able to re-submit after revert', async () => {
      const customLogic = await FailureCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(senderAddress, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      const caller = await TestSmartWallet.deploy()
      await caller.deployed()

      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const relayRequest = await createRequest({
        data: recipientFunction,
        to: recipient.address,
        nonce: initialNonce.toString(),
        relayHub: caller.address,
        tokenContract: token.address,
        from: senderAddress
      }, relayData)
      const reqData: EIP712TypedData = new TypedRequestData(chainId, smartWallet.address, relayRequest)
      const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

      await expect(caller.connect(workerSigner).callExecute(smartWallet.address, relayRequest.request, domainSeparatorHash, suffixData, sig))
        .to.emit(caller, 'Result').withArgs(false, 'always fail')
      // assert.equal(result.logs[0].args.error, 'always fail', 'Incorrect message')
      // assert.equal(result.logs[0].args.success, false, 'Should have failed')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new worker token balance')
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new smart wallet token balance')

      await expect(caller.connect(workerSigner).callExecute(smartWallet.address, relayRequest.request, domainSeparatorHash, suffixData, sig)).to.revertedWith('nonce mismatch')

      const tknBalance2 = await getTokenBalance(token, worker)
      const swTknBalance2 = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance2).to.be.equal(tknBalance, 'Incorrect new worker token balance')
      expect(swTknBalance2).to.be.equal(swTknBalance, 'Incorrect new smart wallet token balance')

      expect((await smartWallet.nonce())).to.be.equal(initialNonce.add(BigNumber.from(1)), 'verifyAndCall should increment nonce')
    })
  })

  describe('#verifyAndCallByOwner', () => {
    let recipient: TestForwarderTarget
    let recipientFunction: any

    beforeEach(async () => {
      await fillTokens(token, smartWallet.address, '1000')
      recipient = await TestForwarderTarget.deploy()
      await recipient.deployed()
      recipientFunction = (await recipient.populateTransaction.emitMessage('hello')).data ?? ''
    })

    it('should call function with custom logic', async () => {
      // Init smart wallet and
      const customLogic = await SuccessCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(fundedAccount, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const result = await smartWallet.connect(fundedAccountSigner).directExecute(recipient.address, recipientFunction)
      expect(emittedEvent(customLogic, await result.wait(), 'LogicCalled()', [])).to.be.true

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(0), 'worker token balance should not change')
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(0), 'smart wallet token balance should not cahnge')

      expect(await smartWallet.nonce()).to.be.equal(initialNonce, 'direct execute should NOT increment nonce')
    })

    it('should revert if logic revert', async () => {
      const customLogic = await FailureCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(fundedAccount, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      await smartWallet.connect(fundedAccountSigner).directExecute(recipient.address, recipientFunction)
      const tx = await smartWallet.connect(fundedAccountSigner).populateTransaction.directExecute(recipient.address, recipientFunction)
      const result = await ethers.provider.call(tx)
      expect(result).to.include(stripHex(encodeRevertReason('always fail').toString()))
      // .call(recipient.address, recipientFunction)
      // assert.isTrue(!result[0], 'should revert')
    })

    it("should call function from custom logic with wallet's address", async () => {
      // Init smart wallet and
      const customLogic = await ProxyCustomLogic.deploy()
      await customLogic.deployed()

      const initResult = await smartWallet.initialize(fundedAccount, customLogic.address, token.address, worker, '0', '400000', '0x')
      expect(emittedEvent(customLogic, await initResult.wait(), 'InitCalled()', [])).to.be.true

      const initialWorkerTokenBalance = await getTokenBalance(token, worker)
      const initialSWalletTokenBalance = await getTokenBalance(token, smartWallet.address)

      const initialNonce = await smartWallet.nonce()

      const result = await smartWallet.connect(fundedAccountSigner).directExecute(recipient.address, recipientFunction)
      expect(emittedEvent(customLogic, await result.wait(), 'LogicCalled()', [])).to.be.true

      const event = recipient.filters.TestForwarderMessage(null, null, null)
      const eventEmitted = await recipient.queryFilter(event)
      expect(eventEmitted.length).to.be.equal(1, 'TestRecipient should emit')
      expect(eventEmitted[0].args.origin).to.be.equal(fundedAccount, 'test "from" account is the tx.origin')
      expect(eventEmitted[0].args.msgSender).to.be.equal(smartWallet.address, 'msg.sender must be the smart wallet address')
      // const logs = await recipient.getPastEvents('TestForwarderMessage')
      // expect(logs.length).to.be.equal(1, 'TestRecipient should emit')
      // expect(logs[0].args.origin).to.be.equal(fundedAccount, 'test "from" account is the tx.origin')
      // expect(logs[0].args.msgSender).to.be.equal(smartWallet.address, 'msg.sender must be the smart wallet address')

      const tknBalance = await getTokenBalance(token, worker)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(0), 'worker token balance should not change')
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(0), 'smart wallet token balance should not cahnge')

      expect((await smartWallet.nonce())).to.be.equal(initialNonce, 'direct execute should NOT increment nonce')
    })
  })
})

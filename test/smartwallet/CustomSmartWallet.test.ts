import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  createSmartWalletFactory,
  createSmartWallet,
  signEnvelopingRequest,
} from '../TestUtils'
import { BigNumber, constants } from 'ethers'
import {
  EnvelopingTypes,
  UtilToken,
  IForwarder,
  CustomSmartWallet__factory,
  UtilToken__factory,
} from '@rsksmart/rif-relay-contracts'
import {
  FailureCustomLogic__factory,
  ProxyCustomLogic__factory,
  SuccessCustomLogic__factory,
  TestForwarderTarget,
} from '../../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

async function fillTokens(
  token: UtilToken,
  recipient: string,
  amount: string,
): Promise<void> {
  await token.mint(amount, recipient)
}

async function getTokenBalance(
  token: UtilToken,
  account: string,
): Promise<BigNumber> {
  return token.balanceOf(account)
}

function createRequest(
  request: Partial<IForwarder.ForwardRequestStruct>,
  relayData: Partial<EnvelopingTypes.RelayDataStruct>,
): EnvelopingTypes.RelayRequestStruct {
  const baseRequest: EnvelopingTypes.RelayRequestStruct = {
    request: {
      relayHub: constants.AddressZero,
      from: constants.AddressZero,
      to: constants.AddressZero,
      value: '0',
      gas: '1000000',
      nonce: '0',
      data: '0x',
      tokenContract: constants.AddressZero,
      tokenAmount: '1',
      tokenGas: '50000',
      validUntilTime: '0',
    },
    relayData: {
      gasPrice: '1',
      feesReceiver: constants.AddressZero,
      callForwarder: constants.AddressZero,
      callVerifier: constants.AddressZero,
    },
  }

  return {
    request: {
      ...baseRequest.request,
      ...request,
    },
    relayData: {
      ...baseRequest.relayData,
      ...relayData,
    },
  }
}

describe('Custom Smart Wallet using TestToken', function () {
  let recipient: TestForwarderTarget
  let recipientFunction: string
  let successCustomLogicFactory: SuccessCustomLogic__factory
  let proxyCustomLogicFactory: ProxyCustomLogic__factory
  let failureCustomLogicFactory: FailureCustomLogic__factory
  let customSmartWalletFactory: CustomSmartWallet__factory
  let utilTokenFactory: UtilToken__factory

  beforeEach(async function () {
    const testForwarderTargetFactory = await ethers.getContractFactory(
      'TestForwarderTarget',
    )
    recipient = await testForwarderTargetFactory.deploy()
    recipientFunction = recipient.interface.encodeFunctionData('emitMessage', [
      'hello',
    ])
    successCustomLogicFactory = await ethers.getContractFactory(
      'SuccessCustomLogic',
    )
    proxyCustomLogicFactory = await ethers.getContractFactory(
      'ProxyCustomLogic',
    )
    failureCustomLogicFactory = await ethers.getContractFactory(
      'FailureCustomLogic',
    )
    customSmartWalletFactory = await ethers.getContractFactory(
      'CustomSmartWallet',
    )
    utilTokenFactory = await ethers.getContractFactory('UtilToken')
  })
  describe('#verifyAndCall', function () {
    it('should call function with custom logic', async function () {
      const customLogic = await successCustomLogicFactory.deploy()
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [otherAccount, worker] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
      ]
      const wallet = ethers.Wallet.createRandom()

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner: wallet,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')
      const relayData = {
        callForwarder: smartWallet.address,
      }

      const initialWorkerTokenBalance = await getTokenBalance(
        token,
        worker.address,
      )
      const initialSWalletTokenBalance = await getTokenBalance(
        token,
        smartWallet.address,
      )
      const initialNonce = await smartWallet.nonce()

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: worker.address,
          tokenContract: token.address,
          from: wallet.address,
        },
        relayData,
      )
      const { signature, suffixData } = await signEnvelopingRequest(
        relayRequest,
        wallet,
      )

      await smartWallet
        .connect(worker)
        .execute(suffixData, relayRequest.request, worker?.address, signature)

      const eventFilter = customLogic.filters.LogicCalled()
      const successLogicLogs = await smartWallet.queryFilter(eventFilter)

      expect(successLogicLogs.length, 'Should call custom logic').equal(1)

      const tknBalance = await getTokenBalance(token, worker.address)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(
        tknBalance.sub(initialWorkerTokenBalance),
        'Incorrect new worker token balance',
      ).to.equal(BigNumber.from(1))
      expect(
        initialSWalletTokenBalance.sub(swTknBalance).toString(),
        'Incorrect new smart wallet token balance',
      ).to.equal(BigNumber.from(1))

      expect(
        await smartWallet.nonce(),
        'verifyAndCall should increment nonce',
      ).to.equal(initialNonce.add(BigNumber.from(1)))
    })

    it("should call function from custom logic with wallet's address", async function () {
      const customLogic = await proxyCustomLogicFactory.deploy()
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [otherAccount, worker] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
      ]
      const wallet = ethers.Wallet.createRandom()

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner: wallet,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')
      const relayData = {
        callForwarder: smartWallet.address,
      }

      const initialWorkerTokenBalance = await getTokenBalance(
        token,
        worker?.address,
      )
      const initialSWalletTokenBalance = await getTokenBalance(
        token,
        smartWallet.address,
      )
      const initialNonce = await smartWallet.nonce()

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: worker.address,
          tokenContract: token.address,
          from: wallet.address,
        },
        relayData,
      )
      const { signature, suffixData } = await signEnvelopingRequest(
        relayRequest,
        wallet,
      )

      await smartWallet
        .connect(worker)
        .execute(suffixData, relayRequest.request, worker.address, signature)

      const logicCalledEventFilter = customLogic.filters.LogicCalled()
      const proxyLogicLogs = await smartWallet.queryFilter(
        logicCalledEventFilter,
      )

      expect(proxyLogicLogs.length, 'Should call custom logic').equal(1)

      const eventFilter = recipient.filters.TestForwarderMessage()
      const logs = await recipient.queryFilter(eventFilter)

      expect(logs.length, 'TestRecipient should emit').to.equal(1)
      expect(
        logs[0]?.args.origin,
        'test "from" account is the tx.origin',
      ).to.equal(worker.address)
      expect(
        logs[0]?.args.msgSender,
        'msg.sender must be the smart wallet address',
      ).to.equal(smartWallet.address)

      const tknBalance = await getTokenBalance(token, worker.address)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(
        tknBalance.sub(initialWorkerTokenBalance),
        'Incorrect new worker token balance',
      ).to.equal(BigNumber.from(1))
      expect(
        initialSWalletTokenBalance.sub(swTknBalance).toString(),
        'Incorrect new smart wallet token balance',
      ).to.equal(BigNumber.from(1))

      expect(
        await smartWallet.nonce(),
        'verifyAndCall should increment nonce',
      ).to.equal(initialNonce.add(BigNumber.from(1)))
    })

    it('should revert if logic revert', async function () {
      const customLogic = await failureCustomLogicFactory.deploy()
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [otherAccount, worker] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
      ]
      const wallet = ethers.Wallet.createRandom()

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner: wallet,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')
      const relayData = {
        callForwarder: smartWallet.address,
      }

      const testSmartWalletFactory = await ethers.getContractFactory(
        'TestSmartWallet',
      )
      const caller = await testSmartWalletFactory.deploy()

      const initialWorkerTokenBalance = await getTokenBalance(
        token,
        worker.address,
      )
      const initialSWalletTokenBalance = await getTokenBalance(
        token,
        smartWallet.address,
      )
      const initialNonce = await smartWallet.nonce()

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: caller.address,
          tokenContract: token.address,
          from: wallet.address,
        },
        relayData,
      )
      const { signature, suffixData } = await signEnvelopingRequest(
        relayRequest,
        wallet,
      )

      await caller
        .connect(worker)
        .callExecute(
          smartWallet.address,
          relayRequest.request,
          worker.address,
          suffixData,
          signature,
        )

      const resultFilter = caller.filters.Result()
      const logs = await caller.queryFilter(resultFilter)

      expect(logs[0]?.args.error, 'Incorrect message').to.equal('always fail')
      expect(logs[0]?.args.success, 'Should have failed').to.be.false

      const tknBalance = await getTokenBalance(token, worker.address)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(
        tknBalance.sub(initialWorkerTokenBalance),
        'Incorrect new worker token balance',
      ).to.equal(BigNumber.from(1))
      expect(
        initialSWalletTokenBalance.sub(swTknBalance).toString(),
        'Incorrect new smart wallet token balance',
      ).to.equal(BigNumber.from(1))

      expect(
        await smartWallet.nonce(),
        'verifyAndCall should increment nonce',
      ).to.equal(initialNonce.add(BigNumber.from(1)))
    })

    it('should not be able to re-submit after revert', async function () {
      const customLogic = await failureCustomLogicFactory.deploy()
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [otherAccount, worker] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
      ]
      const wallet = ethers.Wallet.createRandom()

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner: wallet,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const utilTokenFactory = await ethers.getContractFactory('UtilToken')
      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')
      const relayData = {
        callForwarder: smartWallet.address,
      }

      const testSmartWalletFactory = await ethers.getContractFactory(
        'TestSmartWallet',
      )
      const caller = await testSmartWalletFactory.deploy()

      const initialWorkerTokenBalance = await getTokenBalance(
        token,
        worker.address,
      )
      const initialSWalletTokenBalance = await getTokenBalance(
        token,
        smartWallet.address,
      )
      const initialNonce = await smartWallet.nonce()

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: caller.address,
          tokenContract: token.address,
          from: wallet.address,
        },
        relayData,
      )
      const { signature, suffixData } = await signEnvelopingRequest(
        relayRequest,
        wallet,
      )

      await caller
        .connect(worker)
        .callExecute(
          smartWallet.address,
          relayRequest.request,
          worker.address,
          suffixData,
          signature,
        )

      const resultFilter = caller.filters.Result()
      const logs = await caller.queryFilter(resultFilter)

      expect(logs[0]?.args.error, 'Incorrect message').to.equal('always fail')
      expect(logs[0]?.args.success, 'Should have failed').to.be.false

      const tknBalance = await getTokenBalance(token, worker.address)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(
        tknBalance.sub(initialWorkerTokenBalance),
        'Incorrect new worker token balance',
      ).to.equal(BigNumber.from(1))
      expect(
        initialSWalletTokenBalance.sub(swTknBalance).toString(),
        'Incorrect new smart wallet token balance',
      ).to.equal(BigNumber.from(1))

      await expect(
        caller
          .connect(worker)
          .callExecute(
            smartWallet.address,
            relayRequest.request,
            worker.address,
            suffixData,
            signature,
          ),
      ).to.be.revertedWith('nonce mismatch')

      const tknBalance2 = await getTokenBalance(token, worker.address)
      const swTknBalance2 = await getTokenBalance(token, smartWallet.address)

      expect(tknBalance2, 'Incorrect new worker token balance').to.equal(
        tknBalance,
      )
      expect(
        swTknBalance2,
        'Incorrect new smart wallet token balance',
      ).to.equal(swTknBalance)

      expect(
        await smartWallet.nonce(),
        'verifyAndCall should increment nonce',
      ).to.equal(initialNonce.add(BigNumber.from(1)))
    })
  })

  describe('verifyAndCallByOwner', function () {
    let recipient: TestForwarderTarget
    let recipientFunction: string

    beforeEach(async function () {
      const testForwarderTargetFactory = await ethers.getContractFactory(
        'TestForwarderTarget',
      )
      recipient = await testForwarderTargetFactory.deploy()
      recipientFunction = recipient.interface.encodeFunctionData(
        'emitMessage',
        ['hello'],
      )
    })

    it('should call function with custom logic', async function () {
      const successCustomLogicFactory = await ethers.getContractFactory(
        'SuccessCustomLogic',
      )
      const customLogic = await successCustomLogicFactory.deploy()

      const customSmartWalletFactory = await ethers.getContractFactory(
        'CustomSmartWallet',
      )
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [
        otherAccount,
        worker,
        fundedAccount,
      ] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
        SignerWithAddress,
      ]
      const owner = ethers.Wallet.createRandom().connect(ethers.provider)

      //Fund the owner
      await fundedAccount.sendTransaction({
        to: owner.address,
        value: ethers.utils.parseEther('1'),
      })

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const utilTokenFactory = await ethers.getContractFactory('UtilToken')
      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')

      const initialWorkerTokenBalance = await getTokenBalance(
        token,
        worker.address,
      )
      const initialSWalletTokenBalance = await getTokenBalance(
        token,
        smartWallet.address,
      )
      const initialNonce = await smartWallet.nonce()

      await smartWallet
        .connect(owner)
        .directExecute(recipient.address, recipientFunction)

      const eventFilter = customLogic.filters.LogicCalled()
      const successLogicLogs = await smartWallet.queryFilter(eventFilter)

      expect(successLogicLogs.length, 'Should call custom logic').equal(1)

      const tknBalance = await getTokenBalance(token, worker.address)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(
        tknBalance.sub(initialWorkerTokenBalance),
        'worker token balance should not change',
      ).to.equal(BigNumber.from(0))
      expect(
        initialSWalletTokenBalance.sub(swTknBalance).toString(),
        'smart wallet token balance should not change',
      ).to.equal(BigNumber.from(0))

      expect(
        await smartWallet.nonce(),
        'direct execute should NOT increment nonce',
      ).to.equal(initialNonce)
    })

    it('should revert if logic revert', async function () {
      const failureCustomLogicFactory = await ethers.getContractFactory(
        'FailureCustomLogic',
      )
      const customLogic = await failureCustomLogicFactory.deploy()

      const customSmartWalletFactory = await ethers.getContractFactory(
        'CustomSmartWallet',
      )
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [otherAccount, fundedAccount] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
      ]
      const owner = ethers.Wallet.createRandom().connect(ethers.provider)

      //Fund the owner
      await fundedAccount.sendTransaction({
        to: owner.address,
        value: ethers.utils.parseEther('1'),
      })

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const utilTokenFactory = await ethers.getContractFactory('UtilToken')
      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')

      await smartWallet
        .connect(owner)
        .directExecute(recipient.address, recipientFunction)

      const result = await smartWallet
        .connect(owner)
        .callStatic.directExecute(recipient.address, recipientFunction)
      expect(result.success, 'should revert').to.be.false
    })

    it("should call function from custom logic with wallet's address", async function () {
      const successCustomLogicFactory = await ethers.getContractFactory(
        'ProxyCustomLogic',
      )
      const customLogic = await successCustomLogicFactory.deploy()

      const customSmartWalletFactory = await ethers.getContractFactory(
        'CustomSmartWallet',
      )
      const template = await customSmartWalletFactory.deploy()

      const factory = await createSmartWalletFactory(template, true)

      const [
        otherAccount,
        worker,
        fundedAccount,
      ] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
        SignerWithAddress,
      ]
      const owner = ethers.Wallet.createRandom().connect(ethers.provider)

      //Fund the owner
      await fundedAccount.sendTransaction({
        to: owner.address,
        value: ethers.utils.parseEther('1'),
      })

      const smartWallet = await createSmartWallet({
        relayHub: otherAccount.address,
        owner,
        factory,
        logicAddr: customLogic.address,
        isCustomSmartWallet: true,
      })

      const utilTokenFactory = await ethers.getContractFactory('UtilToken')
      const token = await utilTokenFactory.deploy()

      await fillTokens(token, smartWallet.address, '1000')

      const initialWorkerTokenBalance = await getTokenBalance(
        token,
        worker.address,
      )
      const initialSWalletTokenBalance = await getTokenBalance(
        token,
        smartWallet.address,
      )
      const initialNonce = await smartWallet.nonce()

      await smartWallet
        .connect(owner)
        .directExecute(recipient.address, recipientFunction)

      const eventFilter = customLogic.filters.LogicCalled()
      const successLogicLogs = await smartWallet.queryFilter(eventFilter)

      expect(successLogicLogs.length, 'Should call custom logic').equal(1)

      const testForwarderMessageFilter = recipient.filters.TestForwarderMessage()
      const logs = await recipient.queryFilter(testForwarderMessageFilter)

      expect(logs.length, 'TestRecipient should emit').to.equal(1)
      expect(
        logs[0]?.args.origin,
        'test "from" account is the tx.origin',
      ).to.equal(owner.address)
      expect(
        logs[0]?.args.msgSender,
        'msg.sender must be the smart wallet address',
      ).to.equal(smartWallet.address)

      const tknBalance = await getTokenBalance(token, worker.address)
      const swTknBalance = await getTokenBalance(token, smartWallet.address)

      expect(
        tknBalance.sub(initialWorkerTokenBalance),
        'worker token balance should not change',
      ).to.equal(BigNumber.from(0))
      expect(
        initialSWalletTokenBalance.sub(swTknBalance).toString(),
        'smart wallet token balance should not change',
      ).to.equal(BigNumber.from(0))

      expect(
        await smartWallet.nonce(),
        'direct execute should NOT increment nonce',
      ).to.equal(initialNonce)
    })
  })
})

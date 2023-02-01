import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  createSmartWalletFactory,
  createSupportedSmartWallet,
  getSuffixDataAndSignature,
  RSK_URL,
} from '../utils/TestUtils';
import { BigNumber, Wallet, constants, providers } from 'ethers';
import {
  EnvelopingTypes,
  UtilToken,
  IForwarder,
  CustomSmartWallet__factory,
  UtilToken__factory,
  CustomSmartWallet,
  CustomSmartWalletFactory,
  SmartWalletFactory,
  IWalletCustomLogic,
} from '@rsksmart/rif-relay-contracts';
import {
  FailureCustomLogic,
  FailureCustomLogic__factory,
  ProxyCustomLogic,
  ProxyCustomLogic__factory,
  SuccessCustomLogic,
  SuccessCustomLogic__factory,
  TestForwarderTarget,
} from '../../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { INTERNAL_TRANSACTION_ESTIMATED_CORRECTION } from '@rsksmart/rif-relay-client';

async function fillTokens(
  token: UtilToken,
  recipient: string,
  amount: string
): Promise<void> {
  await token.mint(amount, recipient);
}

async function getTokenBalance(
  token: UtilToken,
  account: string
): Promise<BigNumber> {
  return token.balanceOf(account);
}

function createRequest(
  request: Partial<IForwarder.ForwardRequestStruct>,
  relayData: Partial<EnvelopingTypes.RelayDataStruct>
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
  };

  return {
    request: {
      ...baseRequest.request,
      ...request,
    },
    relayData: {
      ...baseRequest.relayData,
      ...relayData,
    },
  };
}

describe('Custom Smart Wallet using TestToken', function () {
  let recipient: TestForwarderTarget;
  let recipientFunction: string;
  let recipientEstimatedGas: BigNumber;
  let successCustomLogicFactory: SuccessCustomLogic__factory;
  let proxyCustomLogicFactory: ProxyCustomLogic__factory;
  let failureCustomLogicFactory: FailureCustomLogic__factory;
  let customSmartWalletFactory: CustomSmartWallet__factory;
  let template: CustomSmartWallet;
  let successCustomLogic: SuccessCustomLogic;
  let failureCustomLogic: FailureCustomLogic;
  let proxyCustomLogic: ProxyCustomLogic;
  let factory: CustomSmartWalletFactory | SmartWalletFactory;
  let utilTokenFactory: UtilToken__factory;
  let token: UtilToken;
  let owner: Wallet;
  let fundedAccount: SignerWithAddress;
  let relayHub: SignerWithAddress;
  let worker: SignerWithAddress;

  beforeEach(async function () {
    const testForwarderTargetFactory = await ethers.getContractFactory(
      'TestForwarderTarget'
    );
    recipient = await testForwarderTargetFactory.deploy();
    recipientFunction = recipient.interface.encodeFunctionData('emitMessage', [
      'hello',
    ]);
    recipientEstimatedGas = (
      await recipient.estimateGas.emitMessage('hello')
    ).sub(INTERNAL_TRANSACTION_ESTIMATED_CORRECTION);
    successCustomLogicFactory = await ethers.getContractFactory(
      'SuccessCustomLogic'
    );
    proxyCustomLogicFactory = await ethers.getContractFactory(
      'ProxyCustomLogic'
    );
    failureCustomLogicFactory = await ethers.getContractFactory(
      'FailureCustomLogic'
    );
    customSmartWalletFactory = await ethers.getContractFactory(
      'CustomSmartWallet'
    );
    utilTokenFactory = await ethers.getContractFactory('UtilToken');

    template = await customSmartWalletFactory.deploy();
    successCustomLogic = await successCustomLogicFactory.deploy();
    failureCustomLogic = await failureCustomLogicFactory.deploy();
    proxyCustomLogic = await proxyCustomLogicFactory.deploy();

    const provider = new providers.JsonRpcProvider(RSK_URL);
    owner = Wallet.createRandom().connect(provider);

    [relayHub, worker, fundedAccount] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress
    ];

    //Fund the owner
    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    });

    factory = await createSmartWalletFactory(template, true, owner);
    token = await utilTokenFactory.deploy();
  });

  async function createCustomSmartWallet(customLogic: IWalletCustomLogic) {
    const smartWallet = (await createSupportedSmartWallet({
      relayHub: relayHub.address,
      owner,
      sender: relayHub,
      factory,
      logicAddr: customLogic.address,
      isCustomSmartWallet: true,
    })) as CustomSmartWallet;

    await fillTokens(token, smartWallet.address, '1000');

    const relayData = {
      callForwarder: smartWallet.address,
    };

    return { smartWallet, relayData };
  }

  async function getTokenBalancesAndNonce(smartWallet: CustomSmartWallet) {
    const workerTokenBalance = await getTokenBalance(token, worker.address);
    const smartWalletTokenBalance = await getTokenBalance(
      token,
      smartWallet.address
    );
    const nonce = await smartWallet.nonce();

    return {
      workerTokenBalance,
      smartWalletTokenBalance,
      nonce,
    };
  }

  describe('#verifyAndCallByRelayHub', function () {
    it('should call function with custom logic', async function () {
      const { smartWallet, relayData } = await createCustomSmartWallet(
        successCustomLogic
      );

      const {
        workerTokenBalance: initialWorkerTokenBalance,
        smartWalletTokenBalance: initialSWalletTokenBalance,
        nonce: initialNonce,
      } = await getTokenBalancesAndNonce(smartWallet);

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: relayHub.address,
          tokenContract: token.address,
          from: owner.address,
          gas: recipientEstimatedGas.toString()
        },
        relayData
      );

      const { signature, suffixData } = await getSuffixDataAndSignature(
        smartWallet,
        relayRequest,
        owner
      );

      const connectedSmartWallet = smartWallet.connect(relayHub);
      const estimatedGas = await connectedSmartWallet.estimateGas.execute(suffixData, relayRequest.request, worker?.address, signature);
      // We need to add more gas than estimated otherwise the tx fails
      const gasLimit =  estimatedGas.add(2000);
      await connectedSmartWallet.execute(suffixData, relayRequest.request, worker?.address, signature, {gasLimit});

      const eventFilter = successCustomLogic.filters.LogicCalled();
      const successLogicLogs = await smartWallet.queryFilter(eventFilter);

      expect(successLogicLogs.length).equal(1, 'Should call custom logic');

      const {
        workerTokenBalance: tknBalance,
        smartWalletTokenBalance: swTknBalance,
      } = await getTokenBalancesAndNonce(smartWallet);

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.equal(
        BigNumber.from(1),
        'Incorrect new worker token balance'
      );
      expect(initialSWalletTokenBalance.sub(swTknBalance).toString()).to.equal(
        BigNumber.from(1),
        'Incorrect new smart wallet token balance'
      );

      expect(await smartWallet.nonce()).to.equal(
        initialNonce.add(BigNumber.from(1)),
        'verifyAndCall should increment nonce'
      );
    });

    it("should call function from custom logic with wallet's address", async function () {
      const { smartWallet, relayData } = await createCustomSmartWallet(
        proxyCustomLogic
      );

      const {
        workerTokenBalance: initialWorkerTokenBalance,
        smartWalletTokenBalance: initialSWalletTokenBalance,
        nonce: initialNonce,
      } = await getTokenBalancesAndNonce(smartWallet);

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: worker.address,
          tokenContract: token.address,
          from: owner.address,
          gas: recipientEstimatedGas.toString()
        },
        relayData
      );
      const { signature, suffixData } = await getSuffixDataAndSignature(
        smartWallet,
        relayRequest,
        owner
      );

      await smartWallet
        .connect(worker)
        .execute(suffixData, relayRequest.request, worker.address, signature);

      const logicCalledEventFilter = proxyCustomLogic.filters.LogicCalled();
      const proxyLogicLogs = await smartWallet.queryFilter(
        logicCalledEventFilter
      );

      expect(proxyLogicLogs.length).equal(1, 'Should call custom logic');

      const eventFilter = recipient.filters.TestForwarderMessage();
      const logs = await recipient.queryFilter(eventFilter);

      expect(logs.length).to.equal(1, 'TestRecipient should emit');
      expect(logs[0]?.args.origin).to.equal(
        worker.address,
        'test "from" account is the tx.origin'
      );
      expect(logs[0]?.args.msgSender).to.equal(
        smartWallet.address,
        'msg.sender must be the smart wallet address'
      );

      const {
        workerTokenBalance: tknBalance,
        smartWalletTokenBalance: swTknBalance,
      } = await getTokenBalancesAndNonce(smartWallet);

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.equal(
        BigNumber.from(1),
        'Incorrect new worker token balance'
      );
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.equal(
        BigNumber.from(1),
        'Incorrect new smart wallet token balance'
      );

      expect(await smartWallet.nonce()).to.equal(
        initialNonce.add(BigNumber.from(1)),
        'verifyAndCall should increment nonce'
      );
    });

    it('should revert if logic revert', async function () {
      const { smartWallet, relayData } = await createCustomSmartWallet(
        failureCustomLogic
      );

      const testSmartWalletFactory = await ethers.getContractFactory(
        'TestSmartWallet'
      );
      const caller = await testSmartWalletFactory.deploy();

      const {
        workerTokenBalance: initialWorkerTokenBalance,
        smartWalletTokenBalance: initialSWalletTokenBalance,
        nonce: initialNonce,
      } = await getTokenBalancesAndNonce(smartWallet);

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: caller.address,
          tokenContract: token.address,
          from: owner.address,
          gas: recipientEstimatedGas.toString()
        },
        relayData
      );
      const { signature, suffixData } = await getSuffixDataAndSignature(
        smartWallet,
        relayRequest,
        owner
      );

      await caller
        .connect(worker)
        .callExecute(
          smartWallet.address,
          relayRequest.request,
          worker.address,
          suffixData,
          signature
        );

      const resultFilter = caller.filters.Result();
      const logs = await caller.queryFilter(resultFilter);

      expect(logs[0]?.args.error).to.equal('always fail', 'Incorrect message');
      expect(logs[0]?.args.success).to.be.equal(false, 'Incorrect message');

      const {
        workerTokenBalance: tknBalance,
        smartWalletTokenBalance: swTknBalance,
      } = await getTokenBalancesAndNonce(smartWallet);

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.equal(
        BigNumber.from(1),
        'Incorrect new worker token balance'
      );
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.equal(
        BigNumber.from(1),
        'Incorrect new smart wallet token balance'
      );

      expect(await smartWallet.nonce()).to.equal(
        initialNonce.add(BigNumber.from(1)),
        'verifyAndCall should increment nonce'
      );
    });

    it('should not be able to re-submit after revert', async function () {
      const { smartWallet, relayData } = await createCustomSmartWallet(
        failureCustomLogic
      );

      const testSmartWalletFactory = await ethers.getContractFactory(
        'TestSmartWallet'
      );
      const caller = await testSmartWalletFactory.deploy();

      const {
        workerTokenBalance: initialWorkerTokenBalance,
        smartWalletTokenBalance: initialSWalletTokenBalance,
        nonce: initialNonce,
      } = await getTokenBalancesAndNonce(smartWallet);

      const relayRequest = createRequest(
        {
          data: recipientFunction,
          to: recipient.address,
          nonce: initialNonce.toString(),
          relayHub: caller.address,
          tokenContract: token.address,
          from: owner.address,
          gas: recipientEstimatedGas.toString()
        },
        relayData
      );
      const { signature, suffixData } = await getSuffixDataAndSignature(
        smartWallet,
        relayRequest,
        owner
      );

      await caller
        .connect(worker)
        .callExecute(
          smartWallet.address,
          relayRequest.request,
          worker.address,
          suffixData,
          signature
        );

      const resultFilter = caller.filters.Result();
      const logs = await caller.queryFilter(resultFilter);

      expect(logs[0]?.args.error).to.equal('always fail', 'Incorrect message');
      expect(logs[0]?.args.success).to.equal(false, 'Should have failed');

      const {
        workerTokenBalance: tknBalance,
        smartWalletTokenBalance: swTknBalance,
      } = await getTokenBalancesAndNonce(smartWallet);

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.equal(
        BigNumber.from(1),
        'Incorrect new worker token balance'
      );
      expect(initialSWalletTokenBalance.sub(swTknBalance).toString()).to.equal(
        BigNumber.from(1),
        'Incorrect new smart wallet token balance'
      );

      await expect(
        caller
          .connect(worker)
          .callExecute(
            smartWallet.address,
            relayRequest.request,
            worker.address,
            suffixData,
            signature
          )
      ).to.be.rejectedWith('nonce mismatch');

      const tknBalance2 = await getTokenBalance(token, worker.address);
      const swTknBalance2 = await getTokenBalance(token, smartWallet.address);

      expect(tknBalance2).to.equal(
        tknBalance,
        'Incorrect new worker token balance'
      );
      expect(swTknBalance2).to.equal(
        swTknBalance,
        'Incorrect new smart wallet token balance'
      );

      expect(await smartWallet.nonce()).to.equal(
        initialNonce.add(BigNumber.from(1)),
        'verifyAndCall should increment nonce'
      );
    });
  });

  describe('verifyAndCallByOwner', function () {
    it('should call function with custom logic', async function () {
      const { smartWallet } = await createCustomSmartWallet(successCustomLogic);

      const {
        workerTokenBalance: initialWorkerTokenBalance,
        smartWalletTokenBalance: initialSWalletTokenBalance,
        nonce: initialNonce,
      } = await getTokenBalancesAndNonce(smartWallet);

      await smartWallet
        .connect(owner)
        .directExecute(recipient.address, recipientFunction);

      const eventFilter = successCustomLogic.filters.LogicCalled();
      const successLogicLogs = await smartWallet.queryFilter(eventFilter);

      expect(successLogicLogs.length).equal(1, 'Should call custom logic');

      const {
        workerTokenBalance: tknBalance,
        smartWalletTokenBalance: swTknBalance,
      } = await getTokenBalancesAndNonce(smartWallet);

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.equal(
        BigNumber.from(0),
        'worker token balance should not change'
      );
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.equal(
        BigNumber.from(0),
        'smart wallet token balance should not change'
      );

      expect(await smartWallet.nonce()).to.equal(
        initialNonce,
        'direct execute should NOT increment nonce'
      );
    });

    it('should revert if logic revert', async function () {
      const { smartWallet } = await createCustomSmartWallet(failureCustomLogic);

      await smartWallet
        .connect(owner)
        .directExecute(recipient.address, recipientFunction);

      const result = await smartWallet
        .connect(owner)
        .directExecute.call(this, recipient.address, recipientFunction);

      const receipt = await result.wait();

      expect(receipt.logs[0]).to.equal(undefined, 'should revert');
    });

    it("should call function from custom logic with wallet's address", async function () {
      const { smartWallet } = await createCustomSmartWallet(proxyCustomLogic);

      const {
        workerTokenBalance: initialWorkerTokenBalance,
        smartWalletTokenBalance: initialSWalletTokenBalance,
        nonce: initialNonce,
      } = await getTokenBalancesAndNonce(smartWallet);

      await smartWallet
        .connect(owner)
        .directExecute(recipient.address, recipientFunction);

      const eventFilter = proxyCustomLogic.filters.LogicCalled();
      const successLogicLogs = await smartWallet.queryFilter(eventFilter);

      expect(successLogicLogs.length).equal(1, 'Should call custom logic');

      const testForwarderMessageFilter =
        recipient.filters.TestForwarderMessage();
      const logs = await recipient.queryFilter(testForwarderMessageFilter);

      expect(logs.length).to.equal(1, 'TestRecipient should emit');
      expect(logs[0]?.args.origin).to.equal(
        owner.address,
        'test "from" account is the tx.origin'
      );
      expect(logs[0]?.args.msgSender).to.equal(
        smartWallet.address,
        'msg.sender must be the smart wallet address'
      );

      const {
        workerTokenBalance: tknBalance,
        smartWalletTokenBalance: swTknBalance,
      } = await getTokenBalancesAndNonce(smartWallet);

      expect(tknBalance.sub(initialWorkerTokenBalance)).to.equal(
        BigNumber.from(0),
        'worker token balance should not change'
      );
      expect(initialSWalletTokenBalance.sub(swTknBalance)).to.equal(
        BigNumber.from(0),
        'smart wallet token balance should not change'
      );

      expect(await smartWallet.nonce()).to.equal(
        initialNonce,
        'direct execute should NOT increment nonce'
      );
    });
  });
});

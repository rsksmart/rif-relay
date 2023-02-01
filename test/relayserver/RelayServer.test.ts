import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  createEnvelopingTxRequest,
  createEnvelopingRequest,
  getServerInstance,
  getInitiatedServer,
} from './ServerTestEnvironments';
import {
  DeployVerifier,
  RelayHub,
  RelayVerifier,
} from '@rsksmart/rif-relay-contracts';
import {
  buildServerUrl,
  createSupportedSmartWallet,
  deployRelayHub,
  SupportedSmartWallet,
  evmMineMany,
  deploySmartWalletContracts,
} from '../utils/TestUtils';
import config from 'config';
import {
  AppConfig,
  BlockchainConfig,
  defaultEnvironment,
  RelayServer,
  SendTransactionDetails,
  ServerAction,
  ServerConfigParams,
  SignedTransactionDetails,
} from '@rsksmart/rif-relay-server';
import {
  AccountManager,
  estimateInternalCallGas,
  estimateTokenTransferGas,
  HubInfo,
  RelayClient,
  RelayRequest,
  RelayRequestBody,
  setEnvelopingConfig,
  UserDefinedRelayRequest,
} from '@rsksmart/rif-relay-client';
import { BigNumber, constants, Wallet } from 'ethers';
import { spy, match } from 'sinon';
import {
  TestDeployVerifierConfigurableMisbehavior,
  TestRecipient,
  TestVerifierConfigurableMisbehavior,
} from '../../typechain-types';
import {
  assertEventHub,
  getTotalTxCosts,
  loadConfiguration,
  stringifyEnvelopingTx,
} from './ServerTestUtils';
import { mintTokens, prepareToken } from '../smartwallet/utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sleep } from '@rsksmart/rif-relay-server';

const SERVER_WORK_DIR = './tmp/enveloping/test/server';

const basicAppConfig: Partial<AppConfig> = {
  checkInterval: 10,
  logLevel: 5,
  workdir: SERVER_WORK_DIR,
};

const originalConfig = config.util.toObject(config) as ServerConfigParams;

describe('RelayServer', function () {
  describe('init', function () {
    beforeEach(async function () {
      const relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
      });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('should initialize relay params (chainId, networkId, gasPrice)', async function () {
      const [relayOwner] = await ethers.getSigners();

      const { chainId } = ethers.provider.network;

      const server = getServerInstance({ relayOwner: relayOwner! });

      expect(server.chainId).to.not.be.equal(chainId);

      await server.init();

      expect(server.chainId).to.be.equal(chainId);
    });
  });

  describe('validation', function () {
    let relayHub: RelayHub;
    let relayServer: RelayServer;
    let relayClient: RelayClient;
    let recipient: TestRecipient;
    let hubInfo: HubInfo;
    let owner: Wallet;
    let encodedData: string;

    beforeEach(async function () {
      const fakeDeployVerifier = ethers.Wallet.createRandom();
      const fakeRelayVerifier = ethers.Wallet.createRandom();
      relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          deployVerifierAddress: fakeDeployVerifier.address,
          relayVerifierAddress: fakeRelayVerifier.address,
        },
      });
      const testRecipientFactory = await ethers.getContractFactory(
        'TestRecipient'
      );
      recipient = await testRecipientFactory.deploy();
      const { chainId } = ethers.provider.network;
      const serverUrl = buildServerUrl();
      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: fakeDeployVerifier.address,
        relayVerifierAddress: fakeRelayVerifier.address,
      });
      relayClient = new RelayClient();
      const [relayOwner] = await ethers.getSigners();
      relayServer = await getInitiatedServer({ relayOwner: relayOwner! });
      hubInfo = relayServer.getChainInfo();
      owner = ethers.Wallet.createRandom();
      AccountManager.getInstance().addAccount(owner);
      encodedData = recipient.interface.encodeFunctionData('emitMessage', [
        'hello',
      ]);
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    describe('validateInputTypes', function () {
      it('should throw on undefined data', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
          },
          relayData: {
            callForwarder: constants.AddressZero,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        envelopingTxRequest.metadata.relayHubAddress = undefined;

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Cannot read properties of undefined'
        );
      });
    });

    describe('validateInput', function () {
      it('should throw on wrong hub address', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
            relayHub: constants.AddressZero,
          },
          relayData: {
            callForwarder: constants.AddressZero,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Wrong hub address.'
        );
      });

      it('should throw on wrong fees receiver address', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
          },
          relayData: {
            callForwarder: constants.AddressZero,
          },
        };

        hubInfo.feesReceiver = ethers.Wallet.createRandom().address;

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Wrong fees receiver address'
        );
      });

      it('should throw on unacceptable gas price', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
          },
          relayData: {
            callForwarder: constants.AddressZero,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        envelopingTxRequest.relayRequest.relayData.gasPrice = 0;

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Unacceptable gasPrice'
        );
      });

      it('should throw on request expired (or too close)', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
            validUntilTime: Math.round(Date.now() / 1000),
          },
          relayData: {
            callForwarder: constants.AddressZero,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Request expired (or too close)'
        );
      });
    });

    describe('isTrustedVerifier', function () {
      it('should not validate if the verifier is trusted', function () {
        const wrongVerifier = ethers.Wallet.createRandom();

        expect(relayServer.isTrustedVerifier(wrongVerifier.address)).to.be
          .false;
      });

      it('should validate if the verifier is trusted', function () {
        const [verifier] = relayServer.verifierHandler().trustedVerifiers;

        expect(relayServer.isTrustedVerifier(verifier!)).to.be.true;
      });
    });

    describe('validateVerifier', function () {
      it('should validate verifier in enveloping request', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
          },
          relayData: {
            callForwarder: constants.AddressZero,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        const trustedVerifierSpy = spy(relayServer, 'isTrustedVerifier');

        relayServer.validateVerifier(envelopingTxRequest);

        const {
          relayRequest: {
            relayData: { callVerifier },
          },
        } = envelopingTxRequest;

        expect(trustedVerifierSpy.calledOnce).to.be.true;
        expect(trustedVerifierSpy.calledWith(callVerifier.toString())).to.be
          .true;
      });

      it('should throw if wrong verifier in enveloping request', async function () {
        const wrongVerifier = ethers.Wallet.createRandom();

        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 1,
          },
          relayData: {
            callForwarder: constants.AddressZero,
            callVerifier: wrongVerifier.address,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        expect(() =>
          relayServer.validateVerifier(envelopingTxRequest)
        ).to.throw('Invalid verifier');
      });
    });

    describe('validateMaxNonce', function () {
      beforeEach(async function () {
        const receipt = ethers.Wallet.createRandom();
        const { relayWorkerAddress } = hubInfo;
        await relayServer.transactionManager.sendTransaction({
          signer: relayWorkerAddress,
          serverAction: ServerAction.VALUE_TRANSFER,
          gasLimit: BigNumber.from(defaultEnvironment?.minTxGasCost),
          destination: receipt.address,
          creationBlockNumber: 0,
        });
      });

      it('should not throw with relayMaxNonce above current nonce', async function () {
        const pollNonceSpy = spy(relayServer.transactionManager, 'pollNonce');

        const nonceValidation = relayServer.validateMaxNonce('1000');

        await expect(nonceValidation).to.be.fulfilled;
        expect(pollNonceSpy.calledOnce).to.be.true;
      });

      it('should throw exception with relayMaxNonce below current nonce', async function () {
        const nonceValidation = relayServer.validateMaxNonce('0');

        await expect(nonceValidation).to.be.rejectedWith(
          'Unacceptable relayMaxNonce'
        );
      });
    });
  });

  describe('relayTransaction', function () {
    let relayHub: RelayHub;
    let relayServer: RelayServer;
    let relayClient: RelayClient;
    let recipient: TestRecipient;
    let owner: Wallet;
    let smartWallet: SupportedSmartWallet;
    let hubInfo: HubInfo;
    let encodedData: string;

    beforeEach(async function () {
      const fakeDeployVerifier = ethers.Wallet.createRandom();
      const fakeRelayVerifier = ethers.Wallet.createRandom();
      relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          deployVerifierAddress: fakeDeployVerifier.address,
          relayVerifierAddress: fakeRelayVerifier.address,
        },
      });
      const testRecipientFactory = await ethers.getContractFactory(
        'TestRecipient'
      );
      recipient = await testRecipientFactory.deploy();
      const { chainId } = ethers.provider.network;
      const serverUrl = buildServerUrl();
      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: fakeDeployVerifier.address,
        relayVerifierAddress: fakeRelayVerifier.address,
      });
      relayClient = new RelayClient();
      const [worker, fundedAccount, relayOwner] = await ethers.getSigners();
      relayServer = await getInitiatedServer({ relayOwner: relayOwner! });
      owner = ethers.Wallet.createRandom();
      hubInfo = relayServer.getChainInfo();
      AccountManager.getInstance().addAccount(owner);
      encodedData = recipient.interface.encodeFunctionData('emitMessage', [
        'hello',
      ]);

      const { smartWalletFactory } = await deploySmartWalletContracts(
        fundedAccount!
      );
      smartWallet = await createSupportedSmartWallet({
        relayHub: worker!.address,
        sender: worker!,
        owner,
        factory: smartWalletFactory,
      });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    describe('maxPossibleGasWithViewCall', function () {
      it('should fail to relay rejected transaction', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            nonce: 0,
          },
          relayData: {
            callForwarder: smartWallet.address,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        const wrongEnvelopingTxRequest = await createEnvelopingTxRequest(
          {
            ...envelopingRequest,
            request: {
              ...envelopingRequest.request,
              gas: constants.Two,
            } as RelayRequestBody,
          },
          relayClient,
          hubInfo
        );

        const {
          metadata: { signature },
        } = wrongEnvelopingTxRequest;

        const method = await relayHub.populateTransaction.relayCall(
          envelopingTxRequest.relayRequest as RelayRequest,
          signature
        );

        await expect(
          relayServer.maxPossibleGasWithViewCall(
            method,
            envelopingTxRequest,
            BigNumber.from(2000000)
          )
        ).to.be.rejectedWith('revert Signature mismatch');
      });
    });

    describe('createRelayTransaction', function () {
      let gasPrice: BigNumber;

      beforeEach(function () {
        gasPrice = BigNumber.from(60000000);
      });

      it('should estimate the transaction max gas properly without token fee', async function () {
        const gas = await estimateInternalCallGas({
          from: smartWallet.address,
          to: recipient.address,
          gasPrice,
          data: encodedData,
        });

        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
            gas,
          },
          relayData: {
            callForwarder: smartWallet.address,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        const stringifyRequest = stringifyEnvelopingTx(envelopingTxRequest);

        const { maxPossibleGas } =
          await relayServer.validateRequestWithVerifier(stringifyRequest);

        const { txHash } = await relayServer.createRelayTransaction(
          stringifyRequest
        );

        const receipt = await ethers.provider.getTransactionReceipt(txHash);

        expect(maxPossibleGas).to.be.equal(
          receipt.cumulativeGasUsed,
          'Gas used in transaction is different from expected'
        );
      });

      it('should estimate the transaction max gas properly with token fee', async function () {
        const gas = await estimateInternalCallGas({
          from: smartWallet.address,
          to: recipient.address,
          gasPrice,
          data: encodedData,
        });

        const tokenName = 'TestToken';

        const token = await prepareToken(tokenName);
        await mintTokens(token, tokenName, 100, smartWallet.address);

        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: token.address,
            tokenAmount: 50,
            gas,
          },
          relayData: {
            callForwarder: smartWallet.address,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const tokenGas = await estimateTokenTransferGas({
          relayRequest: {
            ...envelopingRequest,
            relayData: {
              ...envelopingRequest.relayData,
              feesReceiver: hubInfo.feesReceiver,
            },
          },
        });

        const envelopingTxRequest = await createEnvelopingTxRequest(
          {
            ...envelopingRequest,
            request: {
              ...envelopingRequest.request,
              tokenGas,
            },
          },
          relayClient,
          hubInfo
        );

        const stringifyRequest = stringifyEnvelopingTx(envelopingTxRequest);

        const { maxPossibleGas } =
          await relayServer.validateRequestWithVerifier(stringifyRequest);

        const { txHash } = await relayServer.createRelayTransaction(
          stringifyRequest
        );

        const receipt = await ethers.provider.getTransactionReceipt(txHash);

        expect(maxPossibleGas).to.be.equal(
          receipt.cumulativeGasUsed,
          'Gas used in transaction is different from expected'
        );
      });

      it('should relay transaction', async function () {
        const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
          request: {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: constants.AddressZero,
          },
          relayData: {
            callForwarder: smartWallet.address,
          },
        };

        const envelopingRequest = await createEnvelopingRequest(
          userDefinedRelayRequestBody,
          relayClient
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          envelopingRequest,
          relayClient,
          hubInfo
        );

        await expect(
          relayServer.createRelayTransaction(
            stringifyEnvelopingTx(envelopingTxRequest)
          )
        ).to.be.fulfilled;
      });
    });
  });

  describe('relay workers/manager rebalancing', function () {
    let relayServer: RelayServer;
    let relayOwner: SignerWithAddress;
    const workerIndex = 0;

    beforeEach(async function () {
      relayOwner = (await ethers.getSigners()).at(0)!;
      loadConfiguration({
        app: basicAppConfig,
      });
      relayServer = getServerInstance({ relayOwner: relayOwner });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('should not replenish when all balances are sufficient', async function () {
      const { relayManagerAddress, relayWorkerAddress } =
        relayServer.getChainInfo();

      const { managerTargetBalance, workerTargetBalance } =
        config.get<BlockchainConfig>('blockchain');

      await relayOwner.sendTransaction({
        to: relayManagerAddress,
        value: managerTargetBalance,
      });

      await relayOwner.sendTransaction({
        to: relayWorkerAddress,
        value: workerTargetBalance,
      });

      const currentBlockNumber = await ethers.provider.getBlockNumber();
      const receipts = await relayServer.replenishServer(workerIndex, 0);

      expect(receipts).to.be.deep.equal([]);
      expect(currentBlockNumber);
      expect(currentBlockNumber).to.be.equal(
        await ethers.provider.getBlockNumber()
      );
    });

    it('should use relay manager balance to fund workers', async function () {
      const { relayManagerAddress } = relayServer.getChainInfo();

      const { managerTargetBalance, workerTargetBalance } =
        config.get<BlockchainConfig>('blockchain');

      const refill =
        BigNumber.from(managerTargetBalance).add(workerTargetBalance);

      await relayOwner.sendTransaction({
        to: relayManagerAddress,
        value: refill,
      });

      const managerBalanceBefore = await relayServer.getManagerBalance();

      expect(
        managerBalanceBefore.gt(managerTargetBalance),
        'manager RBTC balance should be greater than target'
      ).to.be.true;

      const receipts = await relayServer.replenishServer(workerIndex, 0);

      const gasPrice = await ethers.provider.getGasPrice();

      const totalTxCosts = await getTotalTxCosts(receipts, gasPrice);

      const workerBalance = await relayServer.getWorkerBalance(workerIndex);

      expect(
        workerBalance.eq(workerTargetBalance),
        'worker balance is different from worker target balance'
      ).to.be.true;

      const managerBalanceAfter = await relayServer.getManagerBalance();

      expect(
        managerBalanceAfter.eq(
          managerBalanceBefore.sub(managerTargetBalance).sub(totalTxCosts)
        ),
        'manager balance should increase by hub balance minus txs costs'
      ).to.be.true;
    });

    it("should emit 'funding needed' when both rbtc and hub balances are too low", async function () {
      const managerBalance = await relayServer.getManagerBalance();

      const { workerTargetBalance, managerMinBalance } =
        config.get<BlockchainConfig>('blockchain');

      const refill = BigNumber.from(workerTargetBalance).sub(
        relayServer.workerBalanceRequired.currentValue
      );

      expect(
        refill.lt(managerBalance.sub(managerMinBalance)),
        'manager has balance to replenish'
      ).to.be.false;

      let fundingNeededEmitted = false;
      relayServer.on('fundingNeeded', () => {
        fundingNeededEmitted = true;
      });

      await relayServer.replenishServer(workerIndex, 0);

      expect(fundingNeededEmitted, 'fundingNeeded not emitted').to.be.true;
    });
  });

  describe('server keepalive re-registration', function () {
    const registrationBlockRate = 100;
    const refreshStateTimeoutBlocks = 1;
    let relayServer: RelayServer;

    beforeEach(async function () {
      const relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
        blockchain: {
          registrationBlockRate,
          refreshStateTimeoutBlocks,
          // workerTargetBalance: 0.6e18 verify this with the team
        },
      });
      const [relayOwner] = await ethers.getSigners();
      relayServer = await getInitiatedServer({ relayOwner: relayOwner! });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('should re-register server only if registrationBlockRate passed from any tx', async function () {
      const handlePastEventsSpy = spy(
        relayServer.registrationManager,
        'handlePastEvents'
      );

      let latestBlock = await ethers.provider.getBlock('latest');
      let receipts = await relayServer._worker(latestBlock.number);
      const receipts2 = await relayServer._worker(latestBlock.number + 1);

      expect(
        receipts.length,
        'should not re-register if already registered'
      ).to.be.equal(0);

      expect(
        receipts2.length,
        'should not re-register if already registered'
      ).to.be.equal(0);

      expect(
        handlePastEventsSpy.calledWith(match.any, match.any, match.any, false)
      ).to.be.true;

      await evmMineMany(registrationBlockRate);

      latestBlock = await ethers.provider.getBlock('latest');
      receipts = await relayServer._worker(latestBlock.number);

      expect(
        handlePastEventsSpy.calledWith(match.any, match.any, match.any, true)
      ).to.be.true;

      await assertEventHub('RelayServerRegistered', receipts);
    });
  });

  describe('Function testing', function () {
    let relayServer: RelayServer;

    beforeEach(async function () {
      loadConfiguration({
        app: basicAppConfig,
      });
      const [relayOwner] = await ethers.getSigners();
      relayServer = getServerInstance({ relayOwner: relayOwner! });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('_workerSemaphore', async function () {
      expect(
        relayServer._workerSemaphoreOn,
        '_workerSemaphoreOn should be false first'
      ).to.be.false;

      const workerOrig = relayServer['_worker'];

      let shouldRun = true;
      try {
        relayServer._worker = async function (): Promise<string[]> {
          while (shouldRun) {
            await sleep(200);
          }

          return [];
        };

        const latestBlock = await ethers.provider.getBlock('latest');
        // eslint-disable-next-line
        relayServer._workerSemaphore(latestBlock.number);
        expect(
          relayServer._workerSemaphoreOn,
          '_workerSemaphoreOn should be true after'
        ).to.be.true;
        shouldRun = false;
        await sleep(200);
        expect(
          relayServer._workerSemaphoreOn,
          '_workerSemaphoreOn should be false after'
        ).to.be.false;
      } finally {
        relayServer._worker = workerOrig;
      }
    });
  });

  describe('alerted state as griefing mitigation', function () {
    const alertedBlockDelay = 100;
    const refreshStateTimeoutBlocks = 1;
    let rejectingRelayVerifier: TestVerifierConfigurableMisbehavior;
    let rejectingDeployVerifier: TestDeployVerifierConfigurableMisbehavior;
    let relayHub: RelayHub;
    let relayServer: RelayServer;
    let relayClient: RelayClient;
    let recipient: TestRecipient;
    let encodedData: string;
    let owner: Wallet;
    let smartWallet: SupportedSmartWallet;

    beforeEach(async function () {
      const relayVerifierFactory = await ethers.getContractFactory(
        'TestVerifierConfigurableMisbehavior'
      );
      rejectingRelayVerifier = await relayVerifierFactory.deploy();
      const deployVerifierFactory = await ethers.getContractFactory(
        'TestDeployVerifierConfigurableMisbehavior'
      );
      rejectingDeployVerifier = await deployVerifierFactory.deploy();

      relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          deployVerifierAddress: rejectingDeployVerifier.address,
          relayVerifierAddress: rejectingRelayVerifier.address,
        },
        blockchain: {
          alertedBlockDelay,
          refreshStateTimeoutBlocks,
          minAlertedDelayMS: 300,
          maxAlertedDelayMS: 350,
        },
      });
      const testRecipientFactory = await ethers.getContractFactory(
        'TestRecipient'
      );
      recipient = await testRecipientFactory.deploy();
      const [worker, fundedAccount, relayOwner] = await ethers.getSigners();
      const { chainId } = ethers.provider.network;
      const serverUrl = buildServerUrl();
      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: rejectingDeployVerifier.address,
        relayVerifierAddress: rejectingRelayVerifier.address,
      });
      relayClient = new RelayClient();
      relayServer = await getInitiatedServer({ relayOwner: relayOwner! });
      owner = ethers.Wallet.createRandom();
      AccountManager.getInstance().addAccount(owner);
      const { smartWalletFactory } = await deploySmartWalletContracts(
        fundedAccount!
      );
      smartWallet = await createSupportedSmartWallet({
        relayHub: worker!.address,
        sender: worker!,
        owner,
        factory: smartWalletFactory,
      });
      await attackTheServer(relayServer);
    });

    afterEach(function () {
      relayServer.transactionManager._initNonces();
      config.util.extendDeep(config, originalConfig);
    });

    async function attackTheServer(server: RelayServer): Promise<void> {
      const sendTransactionOrigin =
        server.transactionManager['sendTransaction'];

      server.transactionManager.sendTransaction = async function ({
        signer,
        method,
        destination,
        value = constants.Zero,
        gasLimit,
        gasPrice,
        creationBlockNumber,
        serverAction,
      }: SendTransactionDetails): Promise<SignedTransactionDetails> {
        await recipient.setNextRevert();

        return await sendTransactionOrigin.call(server.transactionManager, {
          signer,
          method,
          destination,
          value,
          gasLimit,
          gasPrice,
          creationBlockNumber,
          serverAction,
        });
      };

      encodedData = recipient.interface.encodeFunctionData('testNextRevert');

      const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
        request: {
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          tokenContract: constants.AddressZero,
        },
        relayData: {
          callForwarder: smartWallet.address,
        },
      };

      const envelopingRequest = await createEnvelopingRequest(
        userDefinedRelayRequestBody,
        relayClient
      );

      const hubInfo = server.getChainInfo();

      const envelopingTxRequest = await createEnvelopingTxRequest(
        envelopingRequest,
        relayClient,
        hubInfo
      );

      await relayServer.createRelayTransaction(
        stringifyEnvelopingTx(envelopingTxRequest)
      );

      const currentBlock = await ethers.provider.getBlock('latest');

      await server._worker(currentBlock.number);
      expect(server.alertedBlock).to.be.equal(
        currentBlock.number,
        'server alerted block incorrect'
      );
    }

    it('should delay transactions in alerted state', async function () {
      const timeBefore = Date.now();

      const userDefinedRelayRequestBody: UserDefinedRelayRequest = {
        request: {
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          tokenContract: constants.AddressZero,
        },
        relayData: {
          callForwarder: smartWallet.address,
        },
      };

      const envelopingRequest = await createEnvelopingRequest(
        userDefinedRelayRequestBody,
        relayClient
      );

      const hubInfo = relayServer.getChainInfo();

      const envelopingTxRequest = await createEnvelopingTxRequest(
        envelopingRequest,
        relayClient,
        hubInfo
      );

      await relayServer.createRelayTransaction(
        stringifyEnvelopingTx(envelopingTxRequest)
      );

      const timeAfter = Date.now();

      expect(timeAfter - timeBefore > 300, 'checking that enough time passed')
        .to.be.true;
    });

    it('should exit alerted state after the configured blocks delay', async function () {
      const { alertedBlockDelay } = config.get<BlockchainConfig>('blockchain');
      type RelayServerExposed = {
        alerted: boolean;
      };

      const localServer = relayServer as unknown as RelayServerExposed;

      await evmMineMany(alertedBlockDelay - 1);
      let latestBlock = await ethers.provider.getBlock('latest');
      await relayServer._worker(latestBlock.number);
      expect(localServer.alerted).to.be.true;
      await evmMineMany(2);
      latestBlock = await ethers.provider.getBlock('latest');
      await relayServer._worker(latestBlock.number);
      expect(localServer.alerted).to.be.false;
    });
  });

  describe('Custom replenish function', function () {
    let relayServer: RelayServer;
    const workerIndex = 0;

    beforeEach(async function () {
      const [relayOwner] = await ethers.getSigners();
      loadConfiguration({
        app: { ...basicAppConfig, customReplenish: true },
      });
      relayServer = getServerInstance({ relayOwner: relayOwner! });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('should throw an errror if there is no custom replenish function', async function () {
      await expect(
        relayServer.replenishServer(workerIndex, 0)
      ).to.be.rejectedWith(
        'No custom replenish function found, to remove this error please add the custom replenish implementation here deleting this line.'
      );
    });
  });

  describe('tokenHandler', function () {
    let relayServer: RelayServer;
    let deployVerifier: DeployVerifier;
    let relayVerifier: RelayVerifier;

    beforeEach(async function () {
      const [relayOwner, fundedAccount] = await ethers.getSigners();
      const relayHub = await deployRelayHub();

      ({ deployVerifier, relayVerifier } = await deploySmartWalletContracts(
        fundedAccount!
      ));

      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          relayVerifierAddress: relayVerifier.address,
          deployVerifierAddress: deployVerifier.address,
        },
      });
      relayServer = await getInitiatedServer({ relayOwner: relayOwner! });
    });

    afterEach(function () {
      config.util.extendDeep(config, originalConfig);
    });

    it('should return empty if there are no trusted verifiers', async function () {
      relayServer.trustedVerifiers.clear();
      const verifiers = await relayServer.tokenHandler();

      expect(verifiers).to.be.empty;
    });

    it('should return error if verifier is not trusted', async function () {
      const wrongVerifier = ethers.Wallet.createRandom();

      await expect(
        relayServer.tokenHandler(wrongVerifier.address)
      ).to.be.rejectedWith('supplied verifier is not trusted');
    });

    it('should return no tokens for verifiers when none were allowed', async function () {
      const verifiers = await relayServer.tokenHandler();

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [],
        [relayVerifier.address]: [],
      });
    });

    it('should return allowed tokens for one trusted verifier', async function () {
      const token1 = await prepareToken('TestToken');
      await deployVerifier.acceptToken(token1.address);

      let verifiers = await relayServer.tokenHandler(deployVerifier.address);

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address],
      });

      const token2 = await prepareToken('TestToken');
      await deployVerifier.acceptToken(token2.address);

      verifiers = await relayServer.tokenHandler(deployVerifier.address);
      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address, token2.address],
      });
    });

    it('should return allowed tokens for all trusted verifiers', async function () {
      const token1 = await prepareToken('TestToken');
      await deployVerifier.acceptToken(token1.address);
      await relayVerifier.acceptToken(token1.address);

      let verifiers = await relayServer.tokenHandler();

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address],
        [relayVerifier.address]: [token1.address],
      });

      const token2 = await prepareToken('TestToken');
      await deployVerifier.acceptToken(token2.address);
      await relayVerifier.acceptToken(token2.address);

      verifiers = await relayServer.tokenHandler();
      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address, token2.address],
        [relayVerifier.address]: [token1.address, token2.address],
      });
    });
  });
});

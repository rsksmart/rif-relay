import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  createEnvelopingTxRequest,
  getServerInstance,
  getInitiatedServer,
} from './ServerTestEnvironments';
import {
  DeployVerifier,
  PromiseOrValue,
  RelayHub,
  RelayVerifier,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  createSupportedSmartWallet,
  deployRelayHub,
  SupportedSmartWallet,
  evmMineMany,
  createSmartWalletFactory,
  deployVerifiers,
  generateRandomAddress,
  createUserDefinedRequest,
  deployContract,
} from '../utils/TestUtils';
import config from 'config';
import {
  AppConfig,
  BlockchainConfig,
  defaultEnvironment,
  getServerConfig,
  RelayServer,
  SendTransactionDetails,
  ServerAction,
  ServerConfigParams,
  SignedTransactionDetails,
} from '@rsksmart/rif-relay-server';
import {
  AccountManager,
  estimateInternalCallGas,
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
  deployTestRecipient,
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

const IS_DEPLOY_REQUEST = false;

const provider = ethers.provider;

describe('RelayServer', function () {
  type RelayServerExposed = {
    _alerted: boolean;
    _workerSemaphoreOn: boolean;
  };

  let originalConfig: ServerConfigParams;

  before(function () {
    originalConfig = config.util.toObject(config) as ServerConfigParams;
  });

  afterEach(function () {
    config.util.extendDeep(config, originalConfig);
  });

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

    it('should initialize relay params (chainId, networkId)', async function () {
      const [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];

      const { chainId } = provider.network;
      const networkId = Number(await provider.send('net_version', []));

      const server = getServerInstance({ relayOwner });

      expect(server.chainId).to.not.be.equal(chainId);
      expect(server.networkId).to.not.be.equal(networkId);

      await server.init();

      expect(server.chainId).to.be.equal(chainId);
      expect(server.networkId).to.be.equal(networkId);
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
      const fakeDeployVerifierAddress = generateRandomAddress();
      const fakeRelayVerifierAddress = generateRandomAddress();
      relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          deployVerifierAddress: fakeDeployVerifierAddress,
          relayVerifierAddress: fakeRelayVerifierAddress,
        },
      });
      recipient = await deployTestRecipient();
      const { chainId } = provider.network;
      const {
        app: { url: serverUrl },
      } = getServerConfig();

      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: fakeDeployVerifierAddress,
        relayVerifierAddress: fakeRelayVerifierAddress,
        logLevel: 5,
      });
      relayClient = new RelayClient();
      const [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];
      relayServer = await getInitiatedServer({ relayOwner });
      hubInfo = relayServer.getChainInfo();
      owner = ethers.Wallet.createRandom();
      AccountManager.getInstance().addAccount(owner);
      encodedData = recipient.interface.encodeFunctionData('emitMessage', [
        'hello',
      ]);
    });

    describe('validateInputTypes', function () {
      it('should throw if relayHub is undefined', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );
        envelopingTxRequest.metadata.relayHubAddress =
          undefined as unknown as PromiseOrValue<string>;

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Cannot read properties of undefined'
        );
      });
    });

    describe('validateInput', function () {
      it('should throw on wrong hub address', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
            relayHub: constants.AddressZero,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Wrong hub address.'
        );
      });

      it('should throw on wrong fees receiver address', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
          }
        );

        hubInfo.feesReceiver = generateRandomAddress();

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Wrong fees receiver address'
        );
      });

      it('should throw if gas price is equal to zero', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        envelopingTxRequest.relayRequest.relayData.gasPrice = 0;

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Unacceptable gasPrice'
        );
      });

      it('should throw on request expired', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
            validUntilTime: 1000,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Request expired (or too close)'
        );
      });

      it('should throw on request too close', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
            validUntilTime: Math.round(Date.now() / 1000),
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        expect(() => relayServer.validateInput(envelopingTxRequest)).to.throw(
          'Request expired (or too close)'
        );
      });
    });

    describe('isTrustedVerifier', function () {
      it('should not validate if the verifier is not trusted', function () {
        const wrongVerifierAddress = generateRandomAddress();

        expect(relayServer.isTrustedVerifier(wrongVerifierAddress)).to.be.false;
      });

      it('should validate if the verifier is trusted', function () {
        const [verifier] = relayServer.verifierHandler().trustedVerifiers as [
          string
        ];

        expect(relayServer.isTrustedVerifier(verifier)).to.be.true;
      });
    });

    describe('validateVerifier', function () {
      it('should validate verifier in enveloping request', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
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
        const wrongVerifierAddress = generateRandomAddress();

        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 1,
          },
          {
            callVerifier: wrongVerifierAddress,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
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
        const receiptAddress = generateRandomAddress();
        const { relayWorkerAddress } = hubInfo;
        await relayServer.transactionManager.sendTransaction({
          signer: relayWorkerAddress,
          serverAction: ServerAction.VALUE_TRANSFER,
          gasLimit: BigNumber.from(defaultEnvironment?.minTxGasCost),
          destination: receiptAddress,
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
      const fakeDeployVerifierAddress = generateRandomAddress();
      const fakeRelayVerifierAddress = generateRandomAddress();
      relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          deployVerifierAddress: fakeDeployVerifierAddress,
          relayVerifierAddress: fakeRelayVerifierAddress,
        },
      });
      recipient = await deployTestRecipient();
      const { chainId } = provider.network;
      const {
        app: { url: serverUrl },
      } = getServerConfig();
      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: fakeDeployVerifierAddress,
        relayVerifierAddress: fakeRelayVerifierAddress,
        logLevel: 5,
      });
      relayClient = new RelayClient();
      const [worker, fundedAccount, relayOwner] =
        (await ethers.getSigners()) as [
          SignerWithAddress,
          SignerWithAddress,
          SignerWithAddress
        ];
      relayServer = await getInitiatedServer({ relayOwner });
      owner = ethers.Wallet.createRandom();
      hubInfo = relayServer.getChainInfo();
      AccountManager.getInstance().addAccount(owner);
      encodedData = recipient.interface.encodeFunctionData('emitMessage', [
        'hello',
      ]);
      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        false,
        fundedAccount
      );
      smartWallet = await createSupportedSmartWallet({
        relayHub: worker.address,
        sender: worker,
        owner,
        factory: smartWalletFactory,
      });
    });

    describe('maxPossibleGasWithViewCall', function () {
      it('should fail to relay rejected transaction', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 0,
          },
          {
            callForwarder: smartWallet.address,
          }
        ) as UserDefinedRelayRequest;

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        const wrongEnvelopingTxRequest = await createEnvelopingTxRequest(
          {
            ...userDefinedRelayRequest,
            request: {
              ...userDefinedRelayRequest.request,
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

        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            gas,
          },
          {
            callForwarder: smartWallet.address,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        const stringifyRequest = stringifyEnvelopingTx(envelopingTxRequest);

        const maxPossibleGas = await relayServer.getMaxPossibleGas(
          stringifyRequest
        );

        const { txHash } = await relayServer.createRelayTransaction(
          stringifyRequest
        );

        const receipt = await provider.getTransactionReceipt(txHash);

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

        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            tokenContract: token.address,
            tokenAmount: 50,
            gas,
          },
          {
            callForwarder: smartWallet.address,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        const stringifyRequest = stringifyEnvelopingTx(envelopingTxRequest);

        const maxPossibleGas = await relayServer.getMaxPossibleGas(
          stringifyRequest
        );

        const { txHash } = await relayServer.createRelayTransaction(
          stringifyRequest
        );

        const receipt = await provider.getTransactionReceipt(txHash);

        expect(maxPossibleGas).to.be.equal(
          receipt.cumulativeGasUsed,
          'Gas used in transaction is different from expected'
        );
      });

      it('should relay transaction', async function () {
        const userDefinedRelayRequest = createUserDefinedRequest(
          IS_DEPLOY_REQUEST,
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
          },
          {
            callForwarder: smartWallet.address,
          }
        );

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
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
      [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];
      loadConfiguration({
        app: basicAppConfig,
      });
      relayServer = getServerInstance({ relayOwner: relayOwner });
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

      const currentBlockNumber = await provider.getBlockNumber();
      const receipts = await relayServer.replenishServer(workerIndex, 0);

      expect(receipts).to.be.deep.equal([]);
      expect(currentBlockNumber);
      expect(currentBlockNumber).to.be.equal(await provider.getBlockNumber());
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

      const gasPrice = await provider.getGasPrice();

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
          workerTargetBalance: (0.6e18).toString(),
        },
      });
      const [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];
      relayServer = await getInitiatedServer({ relayOwner });
    });

    it('should re-register server only if registrationBlockRate passed from any tx', async function () {
      const handlePastEventsSpy = spy(
        relayServer.registrationManager,
        'handlePastEvents'
      );

      let latestBlock = await provider.getBlock('latest');
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

      latestBlock = await provider.getBlock('latest');
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
      const [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];
      relayServer = getServerInstance({ relayOwner });
    });

    it('_workerSemaphore', async function () {
      const localServer = relayServer as unknown as RelayServerExposed;

      expect(
        localServer._workerSemaphoreOn,
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

        const latestBlock = await provider.getBlock('latest');
        // eslint-disable-next-line
        relayServer._workerSemaphore(latestBlock.number);

        expect(
          localServer._workerSemaphoreOn,
          '_workerSemaphoreOn should be true after'
        ).to.be.true;

        shouldRun = false;
        await sleep(200);

        expect(
          localServer._workerSemaphoreOn,
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
      rejectingRelayVerifier = await deployContract(
        'TestVerifierConfigurableMisbehavior'
      );
      rejectingDeployVerifier = await deployContract(
        'TestDeployVerifierConfigurableMisbehavior'
      );

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
      recipient = await deployTestRecipient();
      const [worker, fundedAccount, relayOwner] =
        (await ethers.getSigners()) as [
          SignerWithAddress,
          SignerWithAddress,
          SignerWithAddress
        ];
      const { chainId } = provider.network;
      const {
        app: { url: serverUrl },
      } = getServerConfig();
      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: rejectingDeployVerifier.address,
        relayVerifierAddress: rejectingRelayVerifier.address,
        logLevel: 5,
      });
      relayClient = new RelayClient();
      relayServer = await getInitiatedServer({ relayOwner });
      owner = ethers.Wallet.createRandom();
      AccountManager.getInstance().addAccount(owner);
      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        false,
        fundedAccount
      );
      smartWallet = await createSupportedSmartWallet({
        relayHub: worker.address,
        sender: worker,
        owner,
        factory: smartWalletFactory,
      });
      await attackTheServer(relayServer);
    });

    afterEach(function () {
      relayServer.transactionManager._initNonces();
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

      const userDefinedRelayRequest = createUserDefinedRequest(
        IS_DEPLOY_REQUEST,
        {
          from: owner.address,
          to: recipient.address,
          data: encodedData,
        },
        {
          callForwarder: smartWallet.address,
        }
      );

      const hubInfo = server.getChainInfo();

      const envelopingTxRequest = await createEnvelopingTxRequest(
        userDefinedRelayRequest,
        relayClient,
        hubInfo
      );

      await relayServer.createRelayTransaction(
        stringifyEnvelopingTx(envelopingTxRequest)
      );

      const currentBlock = await provider.getBlock('latest');

      await server._worker(currentBlock.number);

      expect(server.alertedBlock).to.be.equal(
        currentBlock.number,
        'server alerted block incorrect'
      );
    }

    it('should delay transactions in alerted state', async function () {
      const timeBefore = Date.now();

      const userDefinedRelayRequest = createUserDefinedRequest(
        IS_DEPLOY_REQUEST,
        {
          from: owner.address,
          to: recipient.address,
          data: encodedData,
        },
        {
          callForwarder: smartWallet.address,
        }
      );

      const hubInfo = relayServer.getChainInfo();

      const envelopingTxRequest = await createEnvelopingTxRequest(
        userDefinedRelayRequest,
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

      const localServer = relayServer as unknown as RelayServerExposed;

      await evmMineMany(alertedBlockDelay - 1);
      let latestBlock = await provider.getBlock('latest');
      await relayServer._worker(latestBlock.number);

      expect(localServer._alerted).to.be.true;

      await evmMineMany(2);
      latestBlock = await provider.getBlock('latest');
      await relayServer._worker(latestBlock.number);

      expect(localServer._alerted).to.be.false;
    });
  });

  describe('Custom replenish function', function () {
    let relayServer: RelayServer;
    const workerIndex = 0;

    beforeEach(async function () {
      const [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];
      loadConfiguration({
        app: { ...basicAppConfig, customReplenish: true },
      });
      relayServer = getServerInstance({ relayOwner });
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
      const [relayOwner, fundedAccount] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress
      ];
      const relayHub = await deployRelayHub();
      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        false,
        fundedAccount
      );
      ({ deployVerifier, relayVerifier } = await deployVerifiers(
        smartWalletFactory
      ));

      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          relayVerifierAddress: relayVerifier.address,
          deployVerifierAddress: deployVerifier.address,
        },
      });
      relayServer = await getInitiatedServer({ relayOwner });
    });

    it('should return empty if there are no trusted verifiers', async function () {
      relayServer.trustedVerifiers.clear();
      const verifiers = await relayServer.tokenHandler();

      expect(verifiers).to.be.empty;
    });

    it('should return error if verifier is not trusted', async function () {
      const wrongVerifierAddress = generateRandomAddress();

      await expect(
        relayServer.tokenHandler(wrongVerifierAddress)
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

import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  createEnvelopingTxRequest,
  getServerInstance,
  getInitiatedServer,
} from './ServerTestEnvironments';
import {
  DeployVerifier,
  RelayHub,
  RelayVerifier,
  SmartWallet,
  SmartWalletFactory,
  BoltzDeployVerifier,
  BoltzSmartWalletFactory,
  MinimalBoltzDeployVerifier,
  MinimalBoltzSmartWalletFactory,
  BoltzRelayVerifier,
  BoltzSmartWallet,
  MinimalBoltzSmartWallet,
  CustomSmartWalletFactory,
  CustomSmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  createSupportedSmartWallet,
  deployRelayHub,
  SupportedSmartWallet,
  evmMineMany,
  createSmartWalletFactory,
  deployVerifiers,
  generateRandomAddress,
  deployContract,
  SupportedType,
  SupportedSmartWalletFactory,
  SupportedDeployVerifier,
  createRelayUserDefinedRequest,
  createDeployUserDefinedRequest,
  getSmartWalletTemplate,
  addSwapHash,
} from '../utils/TestUtils';
import config from 'config';
import {
  AppConfig,
  BlockchainConfig,
  defaultEnvironment,
  getServerConfig,
  RelayServer,
  replenishStrategy,
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
  RelayTxOptions,
  setEnvelopingConfig,
} from '@rsksmart/rif-relay-client';
import { BigNumber, constants, utils, Wallet } from 'ethers';
import { spy, match } from 'sinon';
import {
  SuccessCustomLogic,
  TestBoltzDeployVerifierEverythingAccepted,
  TestDeployVerifierConfigurableMisbehavior,
  TestDeployVerifierEverythingAccepted,
  TestRecipient,
  TestSwap,
  TestVerifierConfigurableMisbehavior,
  TestVerifierEverythingAccepted,
} from '../../typechain-types';
import {
  assertEventHub,
  createAndStringifyEnvelopingTxRequest,
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

const provider = ethers.provider;

const TYPE_OF_ESTIMATIONS: RelayTxOptions[] = [
  {
    serverSignature: true,
  },
  {
    serverSignature: false,
  },
];

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
      recipient = await deployContract('TestRecipient');
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
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
        });

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        httpEnvelopingTxRequest.metadata.relayHubAddress =
          undefined as unknown as string;

        await expect(
          relayServer.validateInput(httpEnvelopingTxRequest)
        ).to.be.rejectedWith('Cannot read properties of undefined');
      });
    });

    describe('validateInput', function () {
      it('should throw on wrong hub address', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
          relayHub: constants.AddressZero,
        });

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        await expect(
          relayServer.validateInput(httpEnvelopingTxRequest)
        ).to.be.rejectedWith('Wrong hub address.');
      });

      it('should throw on wrong fees receiver address', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
        });

        hubInfo.feesReceiver = generateRandomAddress();

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        await expect(
          relayServer.validateInput(httpEnvelopingTxRequest)
        ).to.be.rejectedWith('Wrong fees receiver address');
      });

      it('should throw if gas price is equal to zero', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
        });

        const envelopingTxRequest = await createEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        envelopingTxRequest.relayRequest.relayData.gasPrice = 0;

        const httpEnvelopingTxRequest =
          stringifyEnvelopingTx(envelopingTxRequest);

        await expect(
          relayServer.validateInput(httpEnvelopingTxRequest)
        ).to.be.rejectedWith('Unacceptable gasPrice');
      });

      it('should throw on request expired', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
          validUntilTime: 1000,
        });

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        await expect(
          relayServer.validateInput(httpEnvelopingTxRequest)
        ).to.be.rejectedWith('Request expired (or too close)');
      });

      it('should throw on request too close', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
          validUntilTime: Math.round(Date.now() / 1000),
        });

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        await expect(
          relayServer.validateInput(httpEnvelopingTxRequest)
        ).to.be.rejectedWith('Request expired (or too close)');
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
        const userDefinedRelayRequest = createRelayUserDefinedRequest({
          from: owner.address,
          to: recipient.address,
          data: encodedData,
          nonce: 1,
        });

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        const trustedVerifierSpy = spy(relayServer, 'isTrustedVerifier');

        relayServer.validateVerifier(httpEnvelopingTxRequest);

        const {
          relayRequest: {
            relayData: { callVerifier },
          },
        } = httpEnvelopingTxRequest;

        expect(trustedVerifierSpy.calledOnce).to.be.true;
        expect(trustedVerifierSpy.calledWith(callVerifier.toString())).to.be
          .true;
      });

      it('should throw if wrong verifier in enveloping request', async function () {
        const wrongVerifierAddress = generateRandomAddress();

        const userDefinedRelayRequest = createRelayUserDefinedRequest(
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

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        expect(() =>
          relayServer.validateVerifier(httpEnvelopingTxRequest)
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
    let smartWalletFactory: SmartWalletFactory;
    let boltzVerifier: BoltzDeployVerifier;
    let boltzFactory: BoltzSmartWalletFactory;
    let minimalBoltzVerifier: MinimalBoltzDeployVerifier;
    let minimalBoltzFactory: MinimalBoltzSmartWalletFactory;

    async function prepareVerifier<
      F extends SupportedSmartWalletFactory,
      V extends SupportedDeployVerifier
    >(
      fundedAccount: SignerWithAddress,
      type: SupportedType
    ): Promise<{ factory: F; verifier: V }> {
      const smartWalletTemplate: SupportedSmartWallet = await deployContract(
        getSmartWalletTemplate(type)
      );
      const factory = await createSmartWalletFactory<F>(
        smartWalletTemplate,
        fundedAccount,
        'Boltz'
      );
      const verifierFactory = await ethers.getContractFactory(
        'BoltzDeployVerifier'
      );
      const verifier = (await verifierFactory.deploy(factory.address)) as V;

      return { factory, verifier };
    }

    beforeEach(async function () {
      const [worker, fundedAccount, relayOwner] =
        (await ethers.getSigners()) as [
          SignerWithAddress,
          SignerWithAddress,
          SignerWithAddress
        ];
      const fakeDeployVerifierAddress = generateRandomAddress();
      const fakeRelayVerifierAddress = generateRandomAddress();
      relayHub = await deployRelayHub();
      recipient = await deployContract('TestRecipient');

      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        fundedAccount
      );

      ({ factory: boltzFactory, verifier: boltzVerifier } =
        await prepareVerifier<BoltzSmartWalletFactory, BoltzDeployVerifier>(
          fundedAccount,
          'Boltz'
        ));
      ({ factory: minimalBoltzFactory, verifier: minimalBoltzVerifier } =
        await prepareVerifier<
          MinimalBoltzSmartWalletFactory,
          MinimalBoltzDeployVerifier
        >(fundedAccount, 'Boltz'));

      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
          trustedVerifiers: [
            fakeDeployVerifierAddress,
            fakeRelayVerifierAddress,
            boltzVerifier.address,
            minimalBoltzVerifier.address,
          ],
        },
      });
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
      relayServer = await getInitiatedServer({ relayOwner });
      owner = ethers.Wallet.createRandom();
      hubInfo = relayServer.getChainInfo();
      AccountManager.getInstance().addAccount(owner);
      encodedData = recipient.interface.encodeFunctionData('emitMessage', [
        'hello',
      ]);
      smartWallet = await createSupportedSmartWallet({
        relayHub: worker.address,
        sender: worker,
        owner,
        factory: smartWalletFactory,
      });
    });

    describe('maxPossibleGasWithViewCall', function () {
      it('should fail to relay rejected transaction', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest(
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
            nonce: 0,
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

        const httpEnvelopingTxRequest =
          stringifyEnvelopingTx(envelopingTxRequest);

        await expect(
          relayServer.maxPossibleGasWithViewCall(
            method,
            httpEnvelopingTxRequest,
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

        const userDefinedRelayRequest = createRelayUserDefinedRequest(
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

        const httpEnvelopingTxRequest =
          await createAndStringifyEnvelopingTxRequest(
            userDefinedRelayRequest,
            relayClient,
            hubInfo
          );

        const { maxPossibleGasWithFee } = await relayServer.getMaxPossibleGas(
          httpEnvelopingTxRequest
        );

        const { txHash } = await relayServer.createRelayTransaction(
          httpEnvelopingTxRequest
        );

        const receipt = await provider.getTransactionReceipt(txHash);

        expect(maxPossibleGasWithFee).to.be.equal(
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

        const userDefinedRelayRequest = createRelayUserDefinedRequest(
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

        const stringifyRequest = await createAndStringifyEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        const { maxPossibleGasWithFee } = await relayServer.getMaxPossibleGas(
          stringifyRequest
        );

        const { txHash } = await relayServer.createRelayTransaction(
          stringifyRequest
        );

        const receipt = await provider.getTransactionReceipt(txHash);

        expect(maxPossibleGasWithFee).to.be.equal(
          receipt.cumulativeGasUsed,
          'Gas used in transaction is different from expected'
        );
      });

      it('should relay transaction', async function () {
        const userDefinedRelayRequest = createRelayUserDefinedRequest(
          {
            from: owner.address,
            to: recipient.address,
            data: encodedData,
          },
          {
            callForwarder: smartWallet.address,
          }
        );

        const stringifyRequest = await createAndStringifyEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

        await expect(relayServer.createRelayTransaction(stringifyRequest)).to.be
          .fulfilled;
      });

      describe('with boltz verifier', function () {
        let swap: TestSwap;
        let index = 1;

        beforeEach(async function () {
          index++;
          swap = await deployContract<TestSwap>('TestSwap');
          const smartWalletAddress = await boltzFactory.getSmartWalletAddress(
            owner.address,
            constants.AddressZero,
            index
          );
          encodedData = await addSwapHash({
            swap,
            amount: ethers.utils.parseEther('0.5'),
            claimAddress: smartWalletAddress,
            refundAddress: Wallet.createRandom().address,
          });
          await boltzVerifier.acceptContract(swap.address);
        });

        it('should relay deploy transaction with contract execution', async function () {
          const userDefinedRelayRequest = createDeployUserDefinedRequest(
            {
              from: owner.address,
              to: swap.address,
              data: encodedData,
              index,
            },
            {
              callForwarder: boltzFactory.address,
              callVerifier: boltzVerifier.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo
            );

          await expect(
            relayServer.createRelayTransaction(httpEnvelopingTxRequest)
          ).to.be.fulfilled;
        });

        it('should fail if verifier throws error', async function () {
          const userDefinedRelayRequest = createDeployUserDefinedRequest(
            {
              from: owner.address,
              to: swap.address,
              data: encodedData,
              tokenGas: 5000,
              tokenAmount: ethers.utils.parseEther('5'),
              index,
            },
            {
              callForwarder: boltzFactory.address,
              callVerifier: boltzVerifier.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo
            );

          await expect(
            relayServer.createRelayTransaction(httpEnvelopingTxRequest)
          ).to.be.rejectedWith('Native balance too low');
        });

        it('should fail if destination contract throws error', async function () {
          encodedData = swap.interface.encodeFunctionData(
            'claim(bytes32,uint256,address,uint256)',
            [constants.HashZero, 0, constants.AddressZero, 0]
          );
          const userDefinedRelayRequest = createDeployUserDefinedRequest(
            {
              from: owner.address,
              to: swap.address,
              data: encodedData,
              index,
            },
            {
              callForwarder: boltzFactory.address,
              callVerifier: boltzVerifier.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo
            );

          await expect(
            relayServer.createRelayTransaction(httpEnvelopingTxRequest)
          ).to.be.rejectedWith('NativeSwap: swap has no RBTC');
        });
      });

      describe('with minimal boltz verifier', function () {
        let swap: TestSwap;
        let index = 1;

        beforeEach(async function () {
          swap = await deployContract<TestSwap>('TestSwap');
          const smartWalletAddress =
            await minimalBoltzFactory.getSmartWalletAddress(
              owner.address,
              constants.AddressZero,
              index
            );
          const claimedValue = ethers.utils.parseEther('0.5');
          encodedData = await addSwapHash({
            swap,
            amount: claimedValue,
            claimAddress: smartWalletAddress,
            refundAddress: Wallet.createRandom().address,
          });
          await minimalBoltzVerifier.acceptContract(swap.address);
          index++;
        });

        it('should relay deploy transaction with contract execution', async function () {
          const userDefinedRelayRequest = createDeployUserDefinedRequest(
            {
              from: owner.address,
              to: swap.address,
              data: encodedData,
              index,
            },
            {
              callForwarder: minimalBoltzFactory.address,
              callVerifier: minimalBoltzVerifier.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo
            );

          await expect(
            relayServer.createRelayTransaction(httpEnvelopingTxRequest)
          ).to.be.fulfilled;
        });

        it('should fail if verifier throws error', async function () {
          const userDefinedRelayRequest = createDeployUserDefinedRequest(
            {
              from: owner.address,
              to: swap.address,
              data: encodedData,
              tokenGas: 5000,
              tokenAmount: ethers.utils.parseEther('5'),
              index,
            },
            {
              callForwarder: minimalBoltzFactory.address,
              callVerifier: minimalBoltzVerifier.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo
            );

          await expect(
            relayServer.createRelayTransaction(httpEnvelopingTxRequest)
          ).to.be.rejectedWith('Native balance too low');
        });
      });
    });
  });

  describe('estimateRelayTransaction', function () {
    let relayHub: RelayHub;
    let relayServer: RelayServer;
    let hubInfo: HubInfo;
    let relayClient: RelayClient;
    let owner: Wallet;
    let feesReceiverAddress: string;
    let boltzDeployVerifier: TestBoltzDeployVerifierEverythingAccepted;
    let deployVerifier: TestDeployVerifierEverythingAccepted;
    let relayVerifier: TestVerifierEverythingAccepted;

    beforeEach(async function () {
      const [, relayOwner] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress
      ];
      boltzDeployVerifier = await deployContract(
        'TestBoltzDeployVerifierEverythingAccepted'
      );
      deployVerifier = await deployContract(
        'TestDeployVerifierEverythingAccepted'
      );
      relayVerifier = await deployContract('TestVerifierEverythingAccepted');
      relayHub = await deployRelayHub();
      owner = ethers.Wallet.createRandom();
      feesReceiverAddress = ethers.Wallet.createRandom().address;
      await relayOwner.sendTransaction({
        to: feesReceiverAddress,
        value: 1,
      });
      loadConfiguration({
        app: { ...basicAppConfig, disableSponsoredTx: true },
        contracts: {
          relayHubAddress: relayHub.address,
          trustedVerifiers: [
            boltzDeployVerifier.address,
            deployVerifier.address,
            relayVerifier.address,
          ],
          feesReceiver: feesReceiverAddress,
        },
      });
      relayServer = await getInitiatedServer({ relayOwner });
      hubInfo = relayServer.getChainInfo();
      AccountManager.getInstance().addAccount(owner);
      const { chainId } = provider.network;
      const {
        app: { url: serverUrl },
      } = getServerConfig();
      setEnvelopingConfig({
        preferredRelays: [serverUrl],
        chainId,
        relayHubAddress: relayHub.address,
        deployVerifierAddress: deployVerifier.address,
        relayVerifierAddress: relayVerifier.address,
        logLevel: 1,
      });
      relayClient = new RelayClient();
    });
    for (const options of TYPE_OF_ESTIMATIONS) {
      // Using [dynamically generated tests](https://mochajs.org/#dynamically-generating-tests)
      // we needs the mocha/no-setup-in-describe rule to be disabled
      // see: https://github.com/lo1tuma/eslint-plugin-mocha/blob/main/docs/rules/no-setup-in-describe.md#disallow-setup-in-describe-blocks-mochano-setup-in-describe
      /* eslint-disable  mocha/no-setup-in-describe */
      describe(`with${
        options.serverSignature ? '' : 'out'
      } serverSignature`, function () {
        /* eslint-enable */
        describe('with boltz smart wallet', function () {
          let smartWalletFactory: BoltzSmartWalletFactory;
          let recipient: TestRecipient;
          let encodedData: string;

          beforeEach(async function () {
            const [, fundedAccount] = (await ethers.getSigners()) as [
              SignerWithAddress,
              SignerWithAddress
            ];
            const smartWalletTemplate: BoltzSmartWallet = await deployContract(
              'BoltzSmartWallet'
            );
            smartWalletFactory = await createSmartWalletFactory(
              smartWalletTemplate,
              fundedAccount,
              'Boltz'
            );
            recipient = await deployContract('TestRecipient');
            encodedData = recipient.interface.encodeFunctionData(
              'emitMessage',
              ['hello']
            );
          });

          describe('relay transaction', function () {
            let smartWallet: BoltzSmartWallet;

            beforeEach(async function () {
              const [worker] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];
              smartWallet = await createSupportedSmartWallet({
                relayHub: worker.address,
                sender: worker,
                owner,
                factory: smartWalletFactory,
                type: 'Boltz',
              });
            });

            it('should estimate paying with native', async function () {
              const [fundedAccount] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];

              await fundedAccount.sendTransaction({
                to: smartWallet.address,
                value: utils.parseEther('10'),
              });

              const userDefinedRelayRequest = createRelayUserDefinedRequest(
                {
                  from: owner.address,
                  to: recipient.address,
                  data: encodedData,
                  tokenContract: constants.AddressZero,
                },
                {
                  callForwarder: smartWallet.address,
                  callVerifier: relayVerifier.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await provider.getBalance(
                feesReceiverAddress
              );

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await provider.getBalance(
                feesReceiverAddress
              );

              expect(balanceAfter).to.be.equal(
                balanceBefore.add(estimation.requiredTokenAmount)
              );
            });

            it('should estimate paying with erc20 token', async function () {
              const [fundedAccount] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];

              await fundedAccount.sendTransaction({
                to: smartWallet.address,
                value: utils.parseEther('10'),
              });

              const token = await prepareToken('TestToken');

              await mintTokens(
                token,
                'TestToken',
                utils.parseEther('10'),
                smartWallet.address
              );

              const userDefinedRelayRequest = createRelayUserDefinedRequest(
                {
                  from: owner.address,
                  to: recipient.address,
                  data: encodedData,
                  tokenContract: token.address,
                },
                {
                  callForwarder: smartWallet.address,
                  callVerifier: relayVerifier.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await token.balanceOf(smartWallet.address);

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await token.balanceOf(smartWallet.address);

              expect(balanceAfter).to.be.equal(
                balanceBefore.sub(estimation.requiredTokenAmount)
              );
            });
          });

          describe('deploy transaction', function () {
            const minIndex = 1;
            const maxIndex = 1000000000;
            let nextWalletIndex: number;
            let smartWalletAddress: string;

            beforeEach(async function () {
              nextWalletIndex = Math.floor(
                Math.random() * (maxIndex - minIndex + 1) + minIndex
              );
              smartWalletAddress =
                await smartWalletFactory.getSmartWalletAddress(
                  owner.address,
                  constants.AddressZero,
                  nextWalletIndex
                );
            });

            it('should estimate paying with native', async function () {
              const [fundedAccount] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];

              await fundedAccount.sendTransaction({
                to: smartWalletAddress,
                value: utils.parseEther('10'),
              });

              const userDefinedRelayRequest = createDeployUserDefinedRequest(
                {
                  from: owner.address,
                  tokenContract: constants.AddressZero,
                  index: nextWalletIndex,
                },
                {
                  callForwarder: smartWalletFactory.address,
                  callVerifier: boltzDeployVerifier.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await provider.getBalance(
                feesReceiverAddress
              );

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await provider.getBalance(
                feesReceiverAddress
              );

              expect(balanceAfter).to.be.equal(
                balanceBefore.add(estimation.requiredTokenAmount)
              );
            });

            it('should estimate paying with erc20 token', async function () {
              const [fundedAccount] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];

              await fundedAccount.sendTransaction({
                to: smartWalletAddress,
                value: utils.parseEther('10'),
              });
              const token = await prepareToken('TestToken');

              await mintTokens(
                token,
                'TestToken',
                utils.parseEther('100'),
                smartWalletAddress
              );

              const userDefinedRelayRequest = createDeployUserDefinedRequest(
                {
                  from: owner.address,
                  tokenContract: token.address,
                  index: nextWalletIndex,
                },
                {
                  callForwarder: smartWalletFactory.address,
                  callVerifier: boltzDeployVerifier.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await token.balanceOf(smartWalletAddress);

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await token.balanceOf(smartWalletAddress);

              expect(balanceAfter).to.be.equal(
                balanceBefore.sub(estimation.requiredTokenAmount)
              );
            });

            describe('with contract execution', function () {
              it('should estimate paying with native', async function () {
                const [fundedAccount] = (await ethers.getSigners()) as [
                  SignerWithAddress
                ];

                await fundedAccount.sendTransaction({
                  to: smartWalletAddress,
                  value: utils.parseEther('10'),
                });

                const userDefinedRelayRequest = createDeployUserDefinedRequest(
                  {
                    from: owner.address,
                    to: recipient.address,
                    data: encodedData,
                    tokenContract: constants.AddressZero,
                    index: nextWalletIndex,
                  },
                  {
                    callForwarder: smartWalletFactory.address,
                    callVerifier: boltzDeployVerifier.address,
                  }
                );

                const httpEnvelopingTxRequest =
                  await createAndStringifyEnvelopingTxRequest(
                    userDefinedRelayRequest,
                    relayClient,
                    hubInfo,
                    options
                  );

                const estimation = await relayServer.estimateMaxPossibleGas(
                  httpEnvelopingTxRequest
                );

                const httpEnvelopingTxRequestWithEstimation =
                  await createAndStringifyEnvelopingTxRequest(
                    {
                      ...userDefinedRelayRequest,
                      request: {
                        ...userDefinedRelayRequest.request,
                        tokenAmount: estimation.requiredTokenAmount,
                      },
                    },
                    relayClient,
                    hubInfo
                  );

                const balanceBefore = await provider.getBalance(
                  feesReceiverAddress
                );

                await expect(
                  relayServer.createRelayTransaction(
                    httpEnvelopingTxRequestWithEstimation
                  )
                ).to.be.fulfilled;

                const balanceAfter = await provider.getBalance(
                  feesReceiverAddress
                );

                expect(balanceAfter).to.be.equal(
                  balanceBefore.add(estimation.requiredTokenAmount)
                );
              });

              it('should estimate paying with erc20 token', async function () {
                const token = await prepareToken('TestToken');

                await mintTokens(
                  token,
                  'TestToken',
                  utils.parseEther('100'),
                  smartWalletAddress
                );

                const userDefinedRelayRequest = createDeployUserDefinedRequest(
                  {
                    from: owner.address,
                    to: recipient.address,
                    data: encodedData,
                    tokenContract: token.address,
                    index: nextWalletIndex,
                  },
                  {
                    callForwarder: smartWalletFactory.address,
                    callVerifier: boltzDeployVerifier.address,
                  }
                );

                const httpEnvelopingTxRequest =
                  await createAndStringifyEnvelopingTxRequest(
                    userDefinedRelayRequest,
                    relayClient,
                    hubInfo,
                    options
                  );

                const estimation = await relayServer.estimateMaxPossibleGas(
                  httpEnvelopingTxRequest
                );

                const httpEnvelopingTxRequestWithEstimation =
                  await createAndStringifyEnvelopingTxRequest(
                    {
                      ...userDefinedRelayRequest,
                      request: {
                        ...userDefinedRelayRequest.request,
                        tokenAmount: estimation.requiredTokenAmount,
                      },
                    },
                    relayClient,
                    hubInfo
                  );

                const balanceBefore = await token.balanceOf(smartWalletAddress);

                await expect(
                  relayServer.createRelayTransaction(
                    httpEnvelopingTxRequestWithEstimation
                  )
                ).to.be.fulfilled;

                const balanceAfter = await token.balanceOf(smartWalletAddress);

                expect(balanceAfter).to.be.equal(
                  balanceBefore.sub(estimation.requiredTokenAmount)
                );
              });
            });
          });
        });

        describe('with minimal boltz smart wallet', function () {
          let smartWalletFactory: MinimalBoltzSmartWalletFactory;

          beforeEach(async function () {
            const [, fundedAccount] = (await ethers.getSigners()) as [
              SignerWithAddress,
              SignerWithAddress
            ];
            const smartWalletTemplate: MinimalBoltzSmartWallet =
              await deployContract('MinimalBoltzSmartWallet');
            smartWalletFactory = await createSmartWalletFactory(
              smartWalletTemplate,
              fundedAccount,
              'MinimalBoltz'
            );
          });

          describe('deploy transaction', function () {
            const minIndex = 1;
            const maxIndex = 1000000000;
            let nextWalletIndex: number;
            let smartWalletAddress: string;
            let recipient: TestSwap;
            let encodedData: string;

            beforeEach(async function () {
              nextWalletIndex = Math.floor(
                Math.random() * (maxIndex - minIndex + 1) + minIndex
              );
              smartWalletAddress =
                await smartWalletFactory.getSmartWalletAddress(
                  owner.address,
                  constants.AddressZero,
                  nextWalletIndex
                );
              recipient = await deployContract<TestSwap>('TestSwap');
              encodedData = await addSwapHash({
                swap: recipient,
                amount: ethers.utils.parseEther('10'),
                claimAddress: smartWalletAddress,
                refundAddress: smartWalletAddress,
              });
            });

            it('should estimate paying with native', async function () {
              const [fundedAccount] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];

              await fundedAccount.sendTransaction({
                to: recipient.address,
                value: utils.parseEther('10'),
              });

              const userDefinedRelayRequest = createDeployUserDefinedRequest(
                {
                  from: owner.address,
                  to: recipient.address,
                  data: encodedData,
                  tokenContract: constants.AddressZero,
                  index: nextWalletIndex,
                },
                {
                  callForwarder: smartWalletFactory.address,
                  callVerifier: boltzDeployVerifier.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await provider.getBalance(
                feesReceiverAddress
              );

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await provider.getBalance(
                feesReceiverAddress
              );

              expect(balanceAfter).to.be.equal(
                balanceBefore.add(estimation.requiredTokenAmount)
              );
            });
          });
        });

        describe('with smart wallet', function () {
          let smartWalletFactory: SmartWalletFactory;
          let recipient: TestRecipient;
          let encodedData: string;

          beforeEach(async function () {
            const [, fundedAccount] = (await ethers.getSigners()) as [
              SignerWithAddress,
              SignerWithAddress
            ];
            const smartWalletTemplate: SmartWallet = await deployContract(
              'SmartWallet'
            );
            smartWalletFactory = await createSmartWalletFactory(
              smartWalletTemplate,
              fundedAccount,
              'Default'
            );
            recipient = await deployContract('TestRecipient');
            encodedData = recipient.interface.encodeFunctionData(
              'emitMessage',
              ['hello']
            );
          });

          describe('relay transaction', function () {
            let smartWallet: SmartWallet;

            beforeEach(async function () {
              const [worker] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];
              smartWallet = await createSupportedSmartWallet({
                relayHub: worker.address,
                sender: worker,
                owner,
                factory: smartWalletFactory,
                type: 'Default',
              });
            });

            it('should estimate paying with erc20 token', async function () {
              const [fundedAccount] = (await ethers.getSigners()) as [
                SignerWithAddress
              ];

              await fundedAccount.sendTransaction({
                to: smartWallet.address,
                value: utils.parseEther('10'),
              });

              const token = await prepareToken('TestToken');

              await mintTokens(
                token,
                'TestToken',
                utils.parseEther('10'),
                smartWallet.address
              );

              const userDefinedRelayRequest = createRelayUserDefinedRequest(
                {
                  from: owner.address,
                  to: recipient.address,
                  data: encodedData,
                  tokenContract: token.address,
                },
                {
                  callForwarder: smartWallet.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await token.balanceOf(smartWallet.address);

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await token.balanceOf(smartWallet.address);

              expect(balanceAfter).to.be.equal(
                balanceBefore.sub(estimation.requiredTokenAmount)
              );
            });
          });

          describe('deploy transaction', function () {
            const minIndex = 1;
            const maxIndex = 1000000000;
            let nextWalletIndex: number;
            let smartWalletAddress: string;

            beforeEach(async function () {
              nextWalletIndex = Math.floor(
                Math.random() * (maxIndex - minIndex + 1) + minIndex
              );
              smartWalletAddress =
                await smartWalletFactory.getSmartWalletAddress(
                  owner.address,
                  constants.AddressZero,
                  nextWalletIndex
                );
            });

            it('should estimate paying with erc20 token', async function () {
              const token = await prepareToken('TestToken');

              await mintTokens(
                token,
                'TestToken',
                utils.parseEther('100'),
                smartWalletAddress
              );

              const userDefinedRelayRequest = createDeployUserDefinedRequest(
                {
                  from: owner.address,
                  tokenContract: token.address,
                  index: nextWalletIndex,
                },
                {
                  callForwarder: smartWalletFactory.address,
                }
              );

              const httpEnvelopingTxRequest =
                await createAndStringifyEnvelopingTxRequest(
                  userDefinedRelayRequest,
                  relayClient,
                  hubInfo,
                  options
                );

              const estimation = await relayServer.estimateMaxPossibleGas(
                httpEnvelopingTxRequest
              );

              const httpEnvelopingTxRequestWithEstimation =
                await createAndStringifyEnvelopingTxRequest(
                  {
                    ...userDefinedRelayRequest,
                    request: {
                      ...userDefinedRelayRequest.request,
                      tokenAmount: estimation.requiredTokenAmount,
                    },
                  },
                  relayClient,
                  hubInfo
                );

              const balanceBefore = await token.balanceOf(smartWalletAddress);

              await expect(
                relayServer.createRelayTransaction(
                  httpEnvelopingTxRequestWithEstimation
                )
              ).to.be.fulfilled;

              const balanceAfter = await token.balanceOf(smartWalletAddress);

              expect(balanceAfter).to.be.equal(
                balanceBefore.sub(estimation.requiredTokenAmount)
              );
            });
          });
        });
      });
    }

    describe('with custom smart wallet', function () {
      let smartWalletFactory: CustomSmartWalletFactory;
      let recipient: TestRecipient;
      let customLogic: SuccessCustomLogic;
      let encodedData: string;

      beforeEach(async function () {
        const [, fundedAccount] = (await ethers.getSigners()) as [
          SignerWithAddress,
          SignerWithAddress
        ];
        const smartWalletTemplate: CustomSmartWallet = await deployContract(
          'CustomSmartWallet'
        );
        smartWalletFactory = await createSmartWalletFactory(
          smartWalletTemplate,
          fundedAccount,
          'Custom'
        );
        recipient = await deployContract('TestRecipient');
        customLogic = await deployContract('SuccessCustomLogic');
        encodedData = recipient.interface.encodeFunctionData('emitMessage', [
          'hello',
        ]);
      });

      describe('relay transaction', function () {
        let smartWallet: CustomSmartWallet;

        beforeEach(async function () {
          const [worker] = (await ethers.getSigners()) as [SignerWithAddress];
          smartWallet = await createSupportedSmartWallet({
            relayHub: worker.address,
            sender: worker,
            owner,
            factory: smartWalletFactory,
            logicAddr: customLogic.address,
            type: 'Custom',
          });
        });

        it('should estimate paying with erc20 token', async function () {
          const token = await prepareToken('TestToken');

          await mintTokens(
            token,
            'TestToken',
            utils.parseEther('10'),
            smartWallet.address
          );

          const userDefinedRelayRequest = createRelayUserDefinedRequest(
            {
              from: owner.address,
              to: recipient.address,
              data: encodedData,
              tokenContract: token.address,
            },
            {
              callForwarder: smartWallet.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo,
              { isCustom: true }
            );

          const estimation = await relayServer.estimateMaxPossibleGas(
            httpEnvelopingTxRequest
          );

          const httpEnvelopingTxRequestWithEstimation =
            await createAndStringifyEnvelopingTxRequest(
              {
                ...userDefinedRelayRequest,
                request: {
                  ...userDefinedRelayRequest.request,
                  tokenAmount: estimation.requiredTokenAmount,
                },
              },
              relayClient,
              hubInfo
            );

          const balanceBefore = await token.balanceOf(smartWallet.address);

          await expect(
            relayServer.createRelayTransaction(
              httpEnvelopingTxRequestWithEstimation
            )
          ).to.be.fulfilled;

          const balanceAfter = await token.balanceOf(smartWallet.address);

          expect(balanceAfter).to.be.equal(
            balanceBefore.sub(estimation.requiredTokenAmount)
          );
        });
      });

      describe('deploy transaction', function () {
        const minIndex = 1;
        const maxIndex = 1000000000;
        let nextWalletIndex: number;
        let smartWalletAddress: string;

        beforeEach(async function () {
          nextWalletIndex = Math.floor(
            Math.random() * (maxIndex - minIndex + 1) + minIndex
          );
          smartWalletAddress = await smartWalletFactory.getSmartWalletAddress(
            owner.address,
            constants.AddressZero,
            customLogic.address,
            utils.keccak256('0x00'),
            nextWalletIndex
          );
        });

        it('should estimate paying with erc20 token', async function () {
          const token = await prepareToken('TestToken');

          await mintTokens(
            token,
            'TestToken',
            utils.parseEther('100'),
            smartWalletAddress
          );

          const userDefinedRelayRequest = createDeployUserDefinedRequest(
            {
              from: owner.address,
              tokenContract: token.address,
              index: nextWalletIndex,
              to: customLogic.address,
            },
            {
              callForwarder: smartWalletFactory.address,
            }
          );

          const httpEnvelopingTxRequest =
            await createAndStringifyEnvelopingTxRequest(
              userDefinedRelayRequest,
              relayClient,
              hubInfo,
              {
                isCustom: true,
              }
            );

          const estimation = await relayServer.estimateMaxPossibleGas(
            httpEnvelopingTxRequest
          );

          const httpEnvelopingTxRequestWithEstimation =
            await createAndStringifyEnvelopingTxRequest(
              {
                ...userDefinedRelayRequest,
                request: {
                  ...userDefinedRelayRequest.request,
                  tokenAmount: estimation.requiredTokenAmount,
                },
              },
              relayClient,
              hubInfo,
              { isCustom: true }
            );

          const balanceBefore = await token.balanceOf(smartWalletAddress);

          await expect(
            relayServer.createRelayTransaction(
              httpEnvelopingTxRequestWithEstimation
            )
          ).to.be.fulfilled;

          const balanceAfter = await token.balanceOf(smartWalletAddress);

          expect(balanceAfter).to.be.equal(
            balanceBefore.sub(estimation.requiredTokenAmount)
          );
        });
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
      const receipts = await replenishStrategy(relayServer, workerIndex, 0);

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

      const receipts = await replenishStrategy(relayServer, workerIndex, 0);

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

      await replenishStrategy(relayServer, workerIndex, 0);

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
      recipient = await deployContract('TestRecipient');
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

      const userDefinedRelayRequest = createRelayUserDefinedRequest(
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

      const httpEnvelopingTxRequest =
        await createAndStringifyEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

      await relayServer.createRelayTransaction(httpEnvelopingTxRequest);

      const currentBlock = await provider.getBlock('latest');

      await server._worker(currentBlock.number);

      expect(server.alertedBlock).to.be.equal(
        currentBlock.number,
        'server alerted block incorrect'
      );
    }

    it('should delay transactions in alerted state', async function () {
      const timeBefore = Date.now();

      const userDefinedRelayRequest = createRelayUserDefinedRequest(
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

      const httpEnvelopingTxRequest =
        await createAndStringifyEnvelopingTxRequest(
          userDefinedRelayRequest,
          relayClient,
          hubInfo
        );

      await relayServer.createRelayTransaction(httpEnvelopingTxRequest);

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

    it('should throw an error if there is no custom replenish function', async function () {
      await expect(
        replenishStrategy(relayServer, workerIndex, 0)
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
        fundedAccount
      );
      ({ deployVerifier, relayVerifier } = await deployVerifiers<
        DeployVerifier,
        RelayVerifier
      >(smartWalletFactory));

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
      ).to.be.rejectedWith('Supplied verifier is not trusted');
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

  describe('destinationContractHandler', function () {
    let relayServer: RelayServer;
    let deployVerifier: BoltzDeployVerifier;
    let relayVerifier: BoltzRelayVerifier;

    beforeEach(async function () {
      const [relayOwner, fundedAccount] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress
      ];
      const relayHub = await deployRelayHub();
      const smartWalletTemplate: BoltzSmartWallet = await deployContract(
        'BoltzSmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        fundedAccount,
        'Boltz'
      );
      ({ deployVerifier, relayVerifier } = await deployVerifiers<
        BoltzDeployVerifier,
        BoltzRelayVerifier
      >(smartWalletFactory, 'Boltz'));

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
      const verifiers = await relayServer.destinationContractHandler();

      expect(verifiers).to.be.empty;
    });

    it('should return error if verifier is not trusted', async function () {
      const wrongVerifierAddress = generateRandomAddress();

      await expect(
        relayServer.destinationContractHandler(wrongVerifierAddress)
      ).to.be.rejectedWith('Supplied verifier is not trusted');
    });

    it('should return no contracts for verifiers when none were allowed', async function () {
      const verifiers = await relayServer.destinationContractHandler();

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [],
        [relayVerifier.address]: [],
      });
    });

    it('should return allowed contracts for one trusted verifier', async function () {
      const token1 = await prepareToken('TestToken');
      await deployVerifier.acceptContract(token1.address);

      let verifiers = await relayServer.destinationContractHandler(
        deployVerifier.address
      );

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address],
      });

      const token2 = await prepareToken('TestToken');
      await deployVerifier.acceptContract(token2.address);

      verifiers = await relayServer.destinationContractHandler(
        deployVerifier.address
      );

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address, token2.address],
      });
    });

    it('should return allowed contracts for all trusted verifiers', async function () {
      const token1 = await prepareToken('TestToken');
      await deployVerifier.acceptContract(token1.address);
      await relayVerifier.acceptContract(token1.address);

      let verifiers = await relayServer.destinationContractHandler();

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address],
        [relayVerifier.address]: [token1.address],
      });

      const token2 = await prepareToken('TestToken');
      await deployVerifier.acceptContract(token2.address);
      await relayVerifier.acceptContract(token2.address);

      verifiers = await relayServer.destinationContractHandler();

      expect(verifiers).to.deep.eq({
        [deployVerifier.address]: [token1.address, token2.address],
        [relayVerifier.address]: [token1.address, token2.address],
      });
    });
  });
});

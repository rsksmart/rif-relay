import { expect } from 'chai';
import {
  addSwapHash,
  assertLog,
  createSmartWalletFactory,
  createSupportedSmartWallet,
  deployContract,
  deployRelayHub,
  RSK_URL,
  SupportedSmartWallet,
} from '../utils/TestUtils';
import {
  RelayHub,
  TestDeployVerifierEverythingAccepted,
  TestRecipient,
  TestSwap,
  TestVerifierEverythingAccepted,
  UtilToken,
} from 'typechain-types';
import {
  RelayClient,
  AccountManager,
  UserDefinedRelayRequest,
  setEnvelopingConfig,
  setProvider,
  estimateInternalCallGas,
  UserDefinedDeployRequest,
  EnvelopingEvent,
  EnvelopingTxRequest,
  HttpClient,
  HttpWrapper,
} from '@rsksmart/rif-relay-client';
import { constants, Wallet } from 'ethers';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { loadConfiguration } from '../relayserver/ServerTestUtils';
import { getInitiatedServer } from '../relayserver/ServerTestEnvironments';
import {
  AppConfig,
  getServerConfig,
  HttpServer,
  RelayServer,
  ServerConfigParams,
} from '@rsksmart/rif-relay-server';
import {
  BoltzSmartWallet,
  BoltzSmartWalletFactory,
  SmartWallet,
  SmartWalletFactory,
} from '@rsksmart/rif-relay-contracts';
import { Server } from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import config from 'config';

const SERVER_WORK_DIR = './tmp/enveloping/test/server';

const serverPort = 8095;

const basicAppConfig: Partial<AppConfig> = {
  url: `http://localhost:${serverPort}`,
  port: serverPort,
  devMode: true,
  logLevel: 5,
  workdir: SERVER_WORK_DIR,
};

const provider = ethers.provider;

class MockHttpClient extends HttpClient {
  constructor(readonly mockPort: number, httpWrapper: HttpWrapper) {
    super(httpWrapper);
  }

  override async relayTransaction(
    relayUrl: string,
    envelopingTx: EnvelopingTxRequest
  ): Promise<string> {
    return await super.relayTransaction(this.mapUrl(relayUrl), envelopingTx);
  }

  private mapUrl(relayUrl: string): string {
    return relayUrl.replace(`:${serverPort}`, `:${this.mockPort}`);
  }
}

describe('RelayClient', function () {
  let relayClient: RelayClient;
  let relayServer: RelayServer;
  let httpServer: HttpServer;
  let relayHub: RelayHub;
  let relayVerifier: TestVerifierEverythingAccepted;
  let deployVerifier: TestDeployVerifierEverythingAccepted;
  let token: UtilToken;
  let gaslessAccount: Wallet;
  let relayWorker: SignerWithAddress;
  let relayOwner: SignerWithAddress;
  let fundedAccount: SignerWithAddress;
  let chainId: number;
  const amountToPay = 100;

  let originalConfig: ServerConfigParams;

  before(async function () {
    originalConfig = config.util.toObject(config) as ServerConfigParams;
    gaslessAccount = Wallet.createRandom();
    [relayWorker, relayOwner, fundedAccount] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress
    ];
    relayHub = await deployRelayHub();
    relayVerifier = await deployContract('TestVerifierEverythingAccepted');
    deployVerifier = await deployContract(
      'TestDeployVerifierEverythingAccepted'
    );
    loadConfiguration({
      app: basicAppConfig,
      contracts: {
        relayHubAddress: relayHub.address,
        relayVerifierAddress: relayVerifier.address,
        deployVerifierAddress: deployVerifier.address,
      },
      blockchain: {
        workerTargetBalance: (0.6e18).toString(),
        rskNodeUrl: RSK_URL,
        gasPriceFactor: 1,
      },
    });
    relayServer = await getInitiatedServer({ relayOwner });
    httpServer = new HttpServer(serverPort, relayServer);
    httpServer.start();
    ({ chainId } = provider.network);
    const {
      app: { url: serverUrl },
    } = getServerConfig();
    setProvider(provider);
    setEnvelopingConfig({
      preferredRelays: [serverUrl],
      chainId,
      relayHubAddress: relayHub.address,
      relayVerifierAddress: relayVerifier.address,
      deployVerifierAddress: deployVerifier.address,
      logLevel: 5,
    });

    relayClient = new RelayClient();
    AccountManager.getInstance().addAccount(gaslessAccount);
    token = await deployContract('UtilToken');
  });

  after(function () {
    config.util.extendDeep(config, originalConfig);
    httpServer.stop();
    httpServer.close();
  });

  describe('relayTransaction', function () {
    let smartWalletFactory: SmartWalletFactory;

    before(async function () {
      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        fundedAccount
      );
    });

    describe('should relay transaction', function () {
      let smartWallet: SupportedSmartWallet;
      let testRecipient: TestRecipient;
      let envelopingRelayRequest: UserDefinedRelayRequest;
      const message = 'hello world';

      before(async function () {
        smartWallet = await createSupportedSmartWallet({
          relayHub: relayWorker.address,
          sender: relayWorker,
          owner: gaslessAccount,
          factory: smartWalletFactory,
        });
        await token.mint(1000, smartWallet.address);
        testRecipient = await deployContract('TestRecipient');
        const encodeData = testRecipient.interface.encodeFunctionData(
          'emitMessage',
          [message]
        );
        envelopingRelayRequest = {
          request: {
            to: testRecipient.address,
            data: encodeData,
            from: gaslessAccount.address,
            tokenContract: token.address,
          },
          relayData: {
            callForwarder: smartWallet.address,
            callVerifier: relayVerifier.address,
          },
        };
      });

      it('without gasLimit estimation - gasPrice', async function () {
        const { hash, to } = await relayClient.relayTransaction(
          envelopingRelayRequest
        );

        const filter = testRecipient.filters.SampleRecipientEmitted();
        await assertLog({
          filter,
          hash,
          contract: testRecipient,
          index: 0,
          value: message,
        });

        expect(to).to.be.equal(relayHub.address);
      });

      it('with tokenGas estimation(not sponsored)', async function () {
        const updatedRelayRequest = {
          ...envelopingRelayRequest,
          request: {
            ...envelopingRelayRequest.request,
            tokenGas: 55000,
            tokenAmount: amountToPay,
          },
        };

        const { relayWorkerAddress } = relayServer.getChainInfo();

        const initialWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const initialSwBalance = await token.balanceOf(smartWallet.address);

        const { hash, to } = await relayClient.relayTransaction(
          updatedRelayRequest
        );

        const finalWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const finalSwBalance = await token.balanceOf(smartWallet.address);
        const filter = testRecipient.filters.SampleRecipientEmitted();
        await assertLog({
          filter,
          hash,
          contract: testRecipient,
          index: 0,
          value: message,
        });

        expect(finalWorkerBalance).to.be.equal(
          initialWorkerBalance.add(amountToPay)
        );
        expect(finalSwBalance).to.be.equal(initialSwBalance.sub(amountToPay));
        expect(to).to.be.equal(relayHub.address);
      });

      it('without tokenGas estimation(not sponsored)', async function () {
        const updatedRelayRequest = {
          ...envelopingRelayRequest,
          request: {
            ...envelopingRelayRequest.request,
            tokenAmount: amountToPay,
          },
        };

        const { relayWorkerAddress } = relayServer.getChainInfo();
        const initialWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const initialSwBalance = await token.balanceOf(smartWallet.address);

        const { hash, to } = await relayClient.relayTransaction(
          updatedRelayRequest
        );

        const finalWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const finalSwBalance = await token.balanceOf(smartWallet.address);

        const filter = testRecipient.filters.SampleRecipientEmitted();
        await assertLog({
          filter,
          hash,
          contract: testRecipient,
          index: 0,
          value: message,
        });

        expect(finalWorkerBalance).to.be.equal(
          initialWorkerBalance.add(amountToPay)
        );
        expect(finalSwBalance).to.be.equal(initialSwBalance.sub(amountToPay));
        expect(to).to.be.equal(relayHub.address);
      });

      it('with gasLimit estimation', async function () {
        const { to: requestTo, data } = envelopingRelayRequest.request;

        const { callForwarder, gasPrice } = envelopingRelayRequest.relayData;

        const gasLimit = await estimateInternalCallGas({
          to: requestTo,
          data,
          from: callForwarder,
          gasPrice: (await gasPrice) ?? 0,
        });

        const updatedRelayRequest = {
          ...envelopingRelayRequest,
          request: {
            ...envelopingRelayRequest.request,
            gas: gasLimit,
          },
        };

        const { hash, to } = await relayClient.relayTransaction(
          updatedRelayRequest
        );

        const filter = testRecipient.filters.SampleRecipientEmitted();
        await assertLog({
          filter,
          hash,
          contract: testRecipient,
          index: 0,
          value: message,
        });

        expect(to).to.be.equal(relayHub.address);
      });

      it('with gasPrice', async function () {
        const forceGasPrice = 200000;

        const updatedRelayRequest = {
          ...envelopingRelayRequest,
          relayData: {
            ...envelopingRelayRequest.relayData,
            gasPrice: forceGasPrice,
          },
        };

        const { gasPrice, to, hash } = await relayClient.relayTransaction(
          updatedRelayRequest
        );

        const filter = testRecipient.filters.SampleRecipientEmitted();
        await assertLog({
          filter,
          hash,
          contract: testRecipient,
          index: 0,
          value: message,
        });

        expect(to).to.be.equal(relayHub.address);
        expect(gasPrice?.eq(forceGasPrice)).to.be.true;
      });
    });

    describe('should deploy transaction', function () {
      let envelopingDeployRequest: UserDefinedDeployRequest;
      const minIndex = 0;
      const maxIndex = 1000000000;
      let nextWalletIndex: number;
      let deployClient: RelayClient;
      let smartWalletAddress: string;

      before(function () {
        const {
          app: { url: serverUrl },
        } = getServerConfig();
        setEnvelopingConfig({
          preferredRelays: [serverUrl],
          chainId,
          relayHubAddress: relayHub.address,
          relayVerifierAddress: relayVerifier.address,
          deployVerifierAddress: deployVerifier.address,
          smartWalletFactoryAddress: smartWalletFactory.address,
          logLevel: 5,
        });
        deployClient = new RelayClient();
      });

      beforeEach(async function () {
        nextWalletIndex = Math.floor(
          Math.random() * (maxIndex - minIndex + 1) + minIndex
        );
        envelopingDeployRequest = {
          request: {
            from: gaslessAccount.address,
            tokenContract: token.address,
            index: nextWalletIndex,
          },
        };
        smartWalletAddress = await smartWalletFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          nextWalletIndex
        );
        await token.mint(1000, smartWalletAddress);
      });

      it('without gasLimit estimation - gasPrice - callForwarder', async function () {
        const { hash, to } = await deployClient.relayTransaction(
          envelopingDeployRequest
        );

        const filter = smartWalletFactory.filters.Deployed();
        await assertLog({
          filter,
          hash,
          contract: smartWalletFactory,
          index: 0,
          value: smartWalletAddress,
        });

        expect(to).to.be.equal(relayHub.address);
      });

      it('with tokenGas estimation(not sponsored)', async function () {
        const updatedDeployRequest = {
          ...envelopingDeployRequest,
          request: {
            ...envelopingDeployRequest.request,
            tokenGas: 55000,
            tokenAmount: amountToPay,
          },
        };

        const { relayWorkerAddress } = relayServer.getChainInfo();
        const initialWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const initialSwBalance = await token.balanceOf(smartWalletAddress);

        const { hash, to } = await deployClient.relayTransaction(
          updatedDeployRequest
        );

        const filter = smartWalletFactory.filters.Deployed();
        await assertLog({
          filter,
          hash,
          contract: smartWalletFactory,
          index: 0,
          value: smartWalletAddress,
        });

        const finalWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const finalSwBalance = await token.balanceOf(smartWalletAddress);

        expect(finalWorkerBalance).to.be.equal(
          initialWorkerBalance.add(amountToPay)
        );
        expect(finalSwBalance).to.be.equal(initialSwBalance.sub(amountToPay));
        expect(to).to.be.equal(relayHub.address);
      });

      it('without tokenGas estimation(not sponsored)', async function () {
        const updatedDeployRequest = {
          ...envelopingDeployRequest,
          request: {
            ...envelopingDeployRequest.request,
            tokenAmount: amountToPay,
          },
        };

        const { relayWorkerAddress } = relayServer.getChainInfo();
        const initialWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const initialSwBalance = await token.balanceOf(smartWalletAddress);

        const { hash, to } = await deployClient.relayTransaction(
          updatedDeployRequest
        );

        const filter = smartWalletFactory.filters.Deployed();
        await assertLog({
          filter,
          hash,
          contract: smartWalletFactory,
          index: 0,
          value: smartWalletAddress,
        });
        const finalWorkerBalance = await token.balanceOf(relayWorkerAddress);
        const finalSwBalance = await token.balanceOf(smartWalletAddress);

        expect(finalWorkerBalance).to.be.equal(
          initialWorkerBalance.add(amountToPay)
        );
        expect(finalSwBalance).to.be.equal(initialSwBalance.sub(amountToPay));

        expect(to).to.be.equal(relayHub.address);
      });

      it('with gasPrice', async function () {
        const forceGasPrice = 200000;

        const updatedDeployRequest = {
          ...envelopingDeployRequest,
          relayData: {
            ...envelopingDeployRequest.relayData,
            gasPrice: forceGasPrice,
          },
        };

        const { gasPrice, to, hash } = await deployClient.relayTransaction(
          updatedDeployRequest
        );

        const filter = smartWalletFactory.filters.Deployed();
        await assertLog({
          filter,
          hash,
          contract: smartWalletFactory,
          index: 0,
          value: smartWalletAddress,
        });

        expect(to).to.be.equal(relayHub.address);
        expect(gasPrice?.eq(forceGasPrice)).to.be.true;
      });

      it('with callForwarder', async function () {
        const updatedDeployRequest = {
          ...envelopingDeployRequest,
          relayData: {
            ...envelopingDeployRequest.relayData,
            callForwarder: smartWalletFactory.address,
          },
        };

        const { to, hash } = await deployClient.relayTransaction(
          updatedDeployRequest
        );

        const filter = smartWalletFactory.filters.Deployed();
        await assertLog({
          filter,
          hash,
          contract: smartWalletFactory,
          index: 0,
          value: smartWalletAddress,
        });
        expect(to).to.be.equal(relayHub.address);
      });

      describe('with contract execution', function () {
        let data: string;
        let swap: TestSwap;
        let boltzFactory: BoltzSmartWalletFactory;

        beforeEach(async function () {
          swap = await deployContract<TestSwap>('TestSwap');
          const smartWalletTemplate = await deployContract<BoltzSmartWallet>(
            'BoltzSmartWallet'
          );
          boltzFactory = await createSmartWalletFactory(
            smartWalletTemplate,
            fundedAccount,
            'Boltz'
          );
          smartWalletAddress = await boltzFactory.getSmartWalletAddress(
            gaslessAccount.address,
            constants.AddressZero,
            nextWalletIndex
          );
          const claimedValue = ethers.utils.parseEther('0.5');
          data = await addSwapHash({
            swap,
            amount: claimedValue,
            claimAddress: smartWalletAddress,
            refundAddress: Wallet.createRandom().address,
          });
        });

        it('without tokenGas', async function () {
          await fundedAccount.sendTransaction({
            to: swap.address,
            value: ethers.utils.parseEther('1'),
          });

          const updatedDeployRequest = {
            ...envelopingDeployRequest,
            request: {
              ...envelopingDeployRequest.request,
              to: swap.address,
              data,
              tokenContract: constants.AddressZero,
              tokenAmount: ethers.utils.parseEther('0.1'),
            },
            relayData: {
              ...envelopingDeployRequest.relayData,
              callForwarder: boltzFactory.address,
            },
          };

          const { hash, to } = await deployClient.relayTransaction(
            updatedDeployRequest
          );

          const filter = boltzFactory.filters.Deployed();
          await assertLog({
            filter,
            hash,
            contract: boltzFactory,
            index: 0,
            value: smartWalletAddress,
          });

          expect(to).to.be.equal(relayHub.address);
        });
      });
    });
  });

  describe('event handling', function () {
    let relayEvents: EnvelopingEvent[];
    let smartWallet: SupportedSmartWallet;
    let testRecipient: TestRecipient;
    let envelopingRelayRequest: UserDefinedRelayRequest;
    const message = 'hello world';

    function eventsHandler(event: EnvelopingEvent, ..._args: unknown[]): void {
      relayEvents.push(event);
    }

    before(async function () {
      const smartWalletTemplate = await deployContract<SmartWallet>(
        'SmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        fundedAccount
      );
      smartWallet = await createSupportedSmartWallet({
        relayHub: relayWorker.address,
        sender: relayWorker,
        owner: gaslessAccount,
        factory: smartWalletFactory,
      });
      testRecipient = await deployContract<TestRecipient>('TestRecipient');
      const encodeData = testRecipient.interface.encodeFunctionData(
        'emitMessage',
        [message]
      );
      envelopingRelayRequest = {
        request: {
          to: testRecipient.address,
          data: encodeData,
          from: gaslessAccount.address,
          tokenContract: token.address,
        },
        relayData: {
          callForwarder: smartWallet.address,
          callVerifier: relayVerifier.address,
        },
      };
    });

    beforeEach(function () {
      relayEvents = [];
    });

    it('should handle events when register', async function () {
      relayClient.registerEventListener(eventsHandler);
      const { hash, to } = await relayClient.relayTransaction(
        envelopingRelayRequest
      );

      const filter = testRecipient.filters.SampleRecipientEmitted();
      await assertLog({
        filter,
        hash,
        contract: testRecipient,
        index: 0,
        value: message,
      });

      expect(to).to.be.equal(relayHub.address);
      expect(relayEvents).to.include.members([
        'init',
        'sign-request',
        'validate-request',
        'send-to-relayer',
        'relayer-response',
      ]);
    });

    it('should not handle events when not register', async function () {
      relayClient.unregisterEventListener(eventsHandler);
      const { hash, to } = await relayClient.relayTransaction(
        envelopingRelayRequest
      );

      const filter = testRecipient.filters.SampleRecipientEmitted();
      await assertLog({
        filter,
        hash,
        contract: testRecipient,
        index: 0,
        value: message,
      });

      expect(to).to.be.equal(relayHub.address);
      expect(relayEvents.length).to.be.equal(0);
    });
  });

  describe('isSmartWalletOwner', function () {
    let smartWallet: SupportedSmartWallet;

    before(async function () {
      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        fundedAccount
      );
      smartWallet = await createSupportedSmartWallet({
        relayHub: relayWorker.address,
        sender: relayWorker,
        owner: gaslessAccount,
        factory: smartWalletFactory,
      });
    });

    it('shoud return true if the EOA is the owner of the SW', async function () {
      const isOwner = await relayClient.isSmartWalletOwner(
        smartWallet.address,
        gaslessAccount.address
      );

      expect(isOwner).to.be.true;
    });

    it('should return false if the EOA is not the owner of the SW', async function () {
      const otherGaslessAccount = Wallet.createRandom();
      const isOwner = await relayClient.isSmartWalletOwner(
        smartWallet.address,
        otherGaslessAccount.address
      );

      expect(isOwner).to.be.false;
    });
  });

  describe('relay server', function () {
    let badServer: Server;
    const mockServerPort = 8096;
    let localClient: RelayClient;
    let smartWallet: SupportedSmartWallet;
    let testRecipient: TestRecipient;
    let envelopingRelayRequest: UserDefinedRelayRequest;

    before(async function () {
      const smartWalletTemplate: SmartWallet = await deployContract(
        'SmartWallet'
      );
      const smartWalletFactory = await createSmartWalletFactory(
        smartWalletTemplate,
        fundedAccount
      );
      const mockServer = express();

      mockServer.use(bodyParser.urlencoded({ extended: false }));
      mockServer.use(bodyParser.json());

      const hubInfo = relayServer.getChainInfo();

      mockServer.get('/chain-info', (_, res) => {
        res.send({
          ...hubInfo,
        });
      });

      mockServer.post('/relay', () => {
        console.log('== got relay.. ignoring');
        // don't answer... keeping client in limbo
      });

      badServer = mockServer.listen(mockServerPort);

      setEnvelopingConfig({
        preferredRelays: [`http://localhost:${mockServerPort}`],
        chainId,
        relayHubAddress: relayHub.address,
        relayVerifierAddress: relayVerifier.address,
        deployVerifierAddress: deployVerifier.address,
        smartWalletFactoryAddress: smartWalletFactory.address,
        logLevel: 5,
      });

      localClient = new RelayClient(
        new MockHttpClient(mockServerPort, new HttpWrapper({ timeout: 100 }))
      );

      smartWallet = await createSupportedSmartWallet({
        relayHub: relayWorker.address,
        sender: relayWorker,
        owner: gaslessAccount,
        factory: smartWalletFactory,
      });
      testRecipient = await deployContract('TestRecipient');
      const encodeData = testRecipient.interface.encodeFunctionData(
        'emitMessage',
        ['hello world']
      );
      envelopingRelayRequest = {
        request: {
          to: testRecipient.address,
          data: encodeData,
          from: gaslessAccount.address,
          tokenContract: token.address,
        },
        relayData: {
          callForwarder: smartWallet.address,
          callVerifier: relayVerifier.address,
        },
      };
    });

    after(function () {
      badServer.close();
    });

    it('should skip timed-out server', async function () {
      await expect(
        localClient.relayTransaction(envelopingRelayRequest)
      ).to.be.rejectedWith('Timeout');
    });

    // test is pending since the way of handling error with the server will be updated
    // TODO update once updated
    it.skip('should return error from server', async function () {
      await localClient.relayTransaction(envelopingRelayRequest);
    });
  });
});

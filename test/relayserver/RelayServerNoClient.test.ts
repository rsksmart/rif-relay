import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  BoltzSmartWallet,
  BoltzSmartWalletFactory,
  RelayHub,
} from '@rsksmart/rif-relay-contracts';
import {
  AppConfig,
  HttpServer,
  RelayServer,
  ServerConfigParams,
  getProvider,
  getServerConfig,
} from '@rsksmart/rif-relay-server';
import axios, { AxiosResponse } from 'axios';
import { expect } from 'chai';
import config from 'config';
import { Wallet, constants, utils } from 'ethers';
import { ethers } from 'hardhat';
import {
  EnvelopingRequestOptional,
  getEnvelopingRequestDetails,
  prepareHttpRequest,
} from '../../test/utils/NoClient';
import {
  MinimalBoltzSmartWallet,
  MinimalBoltzSmartWalletFactory,
  TestDeployVerifierEverythingAccepted,
  TestSwap,
  TestVerifierEverythingAccepted,
} from 'typechain-types';
import {
  RSK_URL,
  assertLog,
  createSmartWalletFactory,
  deployContract,
  deployRelayHub,
} from '../../test/utils/TestUtils';
import { getInitiatedServer } from './ServerTestEnvironments';
import { loadConfiguration } from './ServerTestUtils';

const SERVER_WORK_DIR = './tmp/enveloping/test/server';

const serverPort = 8095;

const basicAppConfig: Partial<AppConfig> = {
  url: `http://localhost:${serverPort}`,
  port: serverPort,
  devMode: true,
  logLevel: 0,
  workdir: SERVER_WORK_DIR,
};

describe('RelayServerNoClient', function () {
  let relayServer: RelayServer;
  let httpServer: HttpServer;
  let relayHub: RelayHub;
  let relayVerifier: TestVerifierEverythingAccepted;
  let deployVerifier: TestDeployVerifierEverythingAccepted;
  let gaslessAccount: Wallet;
  let relayOwner: SignerWithAddress;
  let fundedAccount: SignerWithAddress;

  let originalConfig: ServerConfigParams;
  let serverConfig: ServerConfigParams;

  before(async function () {
    originalConfig = config.util.toObject(config) as ServerConfigParams;
    gaslessAccount = Wallet.createRandom();
    [, relayOwner, fundedAccount] = (await ethers.getSigners()) as [
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
    serverConfig = getServerConfig();
  });

  after(function () {
    config.util.extendDeep(config, originalConfig);
    httpServer.stop();
    httpServer.close();
  });

  it('should get the server config', async function () {
    const {
      contracts,
      app: { url: serverUrl },
    } = serverConfig;
    const serverConfigResponse = await axios
      .get(`${serverUrl}/chain-info`)
      .then((response: AxiosResponse<ServerConfigParams>) => response.data);

    const expectedProperties = [
      'relayWorkerAddress',
      'feesReceiver',
      'relayManagerAddress',
      'relayHubAddress',
      'minGasPrice',
      'chainId',
      'networkId',
      'ready',
      'version',
    ];
    expectedProperties.forEach((property) => {
      expect(serverConfigResponse).to.have.property(property);
    });
    expect(serverConfigResponse).to.have.property(
      'relayHubAddress',
      contracts.relayHubAddress
    );
  });

  describe('with contract execution', function () {
    let data: string;
    let swap: TestSwap;

    before(async function () {
      swap = await deployContract<TestSwap>('TestSwap');
      await fundedAccount.sendTransaction({
        to: swap.address,
        value: ethers.utils.parseEther('1'),
      });
    });

    async function prepareRequest(options: EnvelopingRequestOptional) {
      const { feesReceiver, workerAddress: relayWorkerAddress } = relayServer;

      // TODO: Parameters should be better defined
      const envelopingRequest: EnvelopingRequestOptional = {
        ...options,
        request: {
          ...options.request,
          to: swap.address, // destination contract that will be called
          data,
        },
        relayData: {
          ...options.relayData,
        },
      };

      const completeRequest = await getEnvelopingRequestDetails({
        envelopingRequest,
        provider: getProvider(),
      });
      const request = await prepareHttpRequest({
        feesReceiver,
        relayWorkerAddress,
        relayHubAddress: relayHub.address,
        request: completeRequest,
        signerWallet: gaslessAccount,
      });

      return request;
    }

    describe('using the complete Boltz Smart Wallet', function () {
      let boltzFactory: BoltzSmartWalletFactory;

      let baseRequestFields: EnvelopingRequestOptional;

      beforeEach(async function () {
        const smartWalletTemplate = await deployContract<BoltzSmartWallet>(
          'BoltzSmartWallet'
        );
        boltzFactory = await createSmartWalletFactory(
          smartWalletTemplate,
          fundedAccount,
          'Boltz'
        );
        const smartWalletAddress = await boltzFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          0
        );
        const claimedValue = ethers.utils.parseEther('0.5');
        const refundAddress = Wallet.createRandom().address;
        const timelock = 500;
        const preimageHash = utils.soliditySha256(
          ['bytes32'],
          [constants.HashZero]
        );
        data = swap.interface.encodeFunctionData(
          'claim(bytes32,uint256,address,address,uint256)',
          [
            constants.HashZero,
            claimedValue,
            smartWalletAddress,
            refundAddress,
            timelock,
          ]
        );
        const hash = await swap.hashValues(
          preimageHash,
          claimedValue,
          smartWalletAddress,
          refundAddress,
          timelock
        );
        await swap.addSwap(hash);

        baseRequestFields = {
          request: {
            from: gaslessAccount.address, // smart wallet owner
            index: 0, // index of the smart wallet being created
            tokenContract: constants.AddressZero, // token contract to use for payment, 0x00..00 for RBTC
            tokenAmount: ethers.utils.parseEther('0.1'), // token amount to pay for the transaction
            relayHub: relayHub.address,
          },
          relayData: {
            callForwarder: boltzFactory.address, // factory address for a smart wallet deployment, otherwise the smart wallet address
            callVerifier: deployVerifier.address,
          },
        };
      });

      it('should estimate the max possible gas', async function () {
        const request = await prepareRequest(baseRequestFields);
        const maxPossibleGasResponse = await axios
          .post(`${serverConfig.app.url}/estimate`, request)
          .then(
            (response: AxiosResponse<{ maxPossibleGas: string }>) =>
              response.data
          );

        // TODO: Here the expectation should be better defined
        expect(maxPossibleGasResponse).not.to.be.undefined;
      });

      it('should deploy a smart wallet', async function () {
        const index = 0;
        const request = await prepareRequest(baseRequestFields);
        const { txHash: hash } = await axios
          .post(`${serverConfig.app.url}/relay`, request)
          .then((response: AxiosResponse<{ txHash: string }>) => response.data);

        const expectedSmartWalletAddress =
          await boltzFactory.getSmartWalletAddress(
            gaslessAccount.address,
            constants.AddressZero,
            index
          );

        await assertLog({
          filter: boltzFactory.filters.Deployed(),
          hash,
          contract: boltzFactory,
          index: 0,
          value: expectedSmartWalletAddress,
        });
      });
    });

    describe('using the minimalistic Boltz Smart Wallet', function () {
      let boltzFactory: MinimalBoltzSmartWalletFactory;

      let baseRequestFields: EnvelopingRequestOptional;

      beforeEach(async function () {
        const smartWalletTemplate =
          await deployContract<MinimalBoltzSmartWallet>(
            'MinimalBoltzSmartWallet'
          );
        boltzFactory = await createSmartWalletFactory(
          smartWalletTemplate,
          fundedAccount,
          'MinimalBoltz'
        );
        const smartWalletAddress = await boltzFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          0
        );
        const claimedValue = ethers.utils.parseEther('0.5');
        const refundAddress = Wallet.createRandom().address;
        const timelock = 500;
        const preimageHash = utils.soliditySha256(
          ['bytes32'],
          [constants.HashZero]
        );
        data = swap.interface.encodeFunctionData(
          'claim(bytes32,uint256,address,address,uint256)',
          [
            constants.HashZero,
            claimedValue,
            smartWalletAddress,
            refundAddress,
            timelock,
          ]
        );
        const hash = await swap.hashValues(
          preimageHash,
          claimedValue,
          smartWalletAddress,
          refundAddress,
          timelock
        );
        await swap.addSwap(hash);

        baseRequestFields = {
          request: {
            from: gaslessAccount.address, // smart wallet owner
            index: 0, // index of the smart wallet being created
            tokenContract: constants.AddressZero, // token contract to use for payment, 0x00..00 for RBTC
            tokenAmount: ethers.utils.parseEther('0.1'), // token amount to pay for the transaction
            relayHub: relayHub.address,
          },
          relayData: {
            callForwarder: boltzFactory.address, // factory address for a smart wallet deployment, otherwise the smart wallet address
            callVerifier: deployVerifier.address,
          },
        };
      });

      it('should estimate the max possible gas', async function () {
        const request = await prepareRequest(baseRequestFields);
        const maxPossibleGasResponse = await axios
          .post(`${serverConfig.app.url}/estimate`, request)
          .then(
            (response: AxiosResponse<{ maxPossibleGas: string }>) =>
              response.data
          );

        // TODO: Here the expectation should be better defined
        expect(maxPossibleGasResponse).not.to.be.undefined;
      });

      it('should deploy a smart wallet', async function () {
        const index = 0;
        const request = await prepareRequest(baseRequestFields);
        const { txHash: hash } = await axios
          .post(`${serverConfig.app.url}/relay`, request)
          .then((response: AxiosResponse<{ txHash: string }>) => response.data);

        const expectedSmartWalletAddress =
          await boltzFactory.getSmartWalletAddress(
            gaslessAccount.address,
            constants.AddressZero,
            index
          );

        await assertLog({
          filter: boltzFactory.filters.Deployed(),
          hash,
          contract: boltzFactory,
          index: 0,
          value: expectedSmartWalletAddress,
        });
      });
    });
  });
});

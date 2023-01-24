import childProcess, { ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BigNumberish, constants, utils, Wallet } from 'ethers';
import chaiAsPromised from 'chai-as-promised';
import { expect, use } from 'chai';
import config from 'config';

import {
  RelayHub,
  SmartWalletFactory,
  CustomSmartWalletFactory,
  IForwarder,
  RelayHub__factory,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  AppConfig,
  defaultEnvironment,
  RelayHubConfiguration,
  ServerConfigParams,
  sleep,
} from '@rsksmart/rif-relay-server';
import {
  DeployRequestBody,
  deployRequestType,
  EnvelopingRequest,
  EnvelopingRequestData,
  getEnvelopingRequestDataV4Field,
  HttpClient,
  HttpWrapper,
  HubInfo,
  isDeployRequest,
  RelayRequestBody,
  relayRequestType,
} from '@rsksmart/rif-relay-client';
import { ethers } from 'hardhat';
import { _TypedDataEncoder } from 'ethers/lib/utils';
import { CustomSmartWallet } from 'typechain-types';

use(chaiAsPromised);

const SERVER_WORK_DIR = '/tmp/enveloping/test/server';
const ATTEMPTS_GET_SERVER_STATUS = 3;
const ATTEMPTS_GET_SERVER_READY = 25;
const CHARS_PER_FIELD = 64;
const PREFIX_HEX = '0x';

type RifSmartWallet = SmartWallet | CustomSmartWallet;

type RifSmartWalletFactory = SmartWalletFactory | CustomSmartWalletFactory;

type StartRelayParams = {
  serverConfig: ServerConfigParams;
  delay?: number;
  stake?: BigNumberish;
  relayOwner: string;
  relayHubAddress: string;
};

type CreateSmartWalletParams = {
  relayHub: string;
  owner: Wallet;
  factory: RifSmartWalletFactory;
  tokenContract?: string;
  tokenAmount?: BigNumberish;
  tokenGas?: BigNumberish;
  recoverer?: string;
  index?: number;
  validUntilTime?: number;
  logicAddr?: string;
  initParams?: string;
  isCustomSmartWallet?: boolean;
};

type PrepareRelayTransactionParams = {
  relayHub: string;
  owner: Wallet;
  tokenContract: string;
  tokenAmount: BigNumberish;
  tokenGas: BigNumberish;
  validUntilTime: number;
  logicAddr: string;
  initParams: string;
  gas: BigNumberish;
  swAddress: string;
};

const { provider } = ethers;

const startRelay = async (options: StartRelayParams) => {
  const { serverConfig, delay, stake, relayOwner, relayHubAddress } = options;

  fs.rmSync(SERVER_WORK_DIR, { recursive: true, force: true });

  const originalConfig = { ...config };

  config.util.extendDeep(originalConfig, {
    ...serverConfig,
    contracts: {
      relayHubAddress,
    },
    app: {
      workdir: SERVER_WORK_DIR,
      devMode: true,
      checkInterval: 10,
      logLevel: 5,
    },
  });

  const url = buildServerUrl();

  const runServerPath = path.resolve(
    __dirname,
    '../node_modules/@rsksmart/rif-relay-server/dist/commands/Start.js'
  );

  const proc: ChildProcessWithoutNullStreams & { alreadyStarted?: number } =
    childProcess.spawn('node', [runServerPath]);

  const client = new HttpClient(new HttpWrapper(undefined, 'silent'));

  const { relayManagerAddress } = await doUntilDefined(
    () => getServerStatus(url, client),
    ATTEMPTS_GET_SERVER_STATUS,
    "can't ping server"
  );

  console.log('Relay Server Manager Address', relayManagerAddress);

  await provider.getSigner(relayOwner).sendTransaction({
    to: relayManagerAddress,
    value: utils.parseEther('2'),
  });

  const relayHub = RelayHub__factory.connect(relayHubAddress, provider);

  await relayHub.stakeForAddress(relayManagerAddress, delay || 2000, {
    from: relayOwner,
    value: stake || utils.parseEther('1'),
  });

  const { relayWorkerAddress } = await doUntilDefined(
    () => getServerReady(url, client),
    ATTEMPTS_GET_SERVER_READY,
    'timed out waiting for relay to get staked and registered'
  );

  return {
    proc,
    worker: relayWorkerAddress,
    manager: relayManagerAddress,
  };
};

const buildServerUrl = () => {
  const app = config.get<AppConfig>('app');

  const portFromUrl = app.url.match(/:(\d{0,5})$/);

  return !portFromUrl && app.port ? `${app.url}:${app.port}` : app.url;
};

const getServerStatus = async (
  url: string,
  client = new HttpClient(new HttpWrapper(undefined, 'silent'))
): Promise<HubInfo> => client.getChainInfo(url);

const getServerReady = async (
  url: string,
  client = new HttpClient(new HttpWrapper(undefined, 'silent'))
): Promise<HubInfo | undefined> => {
  const response = await getServerStatus(url, client);

  if (response.ready) {
    return response;
  }

  return undefined;
};

const doUntilDefined = async (
  functionToWait: () => Promise<HubInfo | undefined>,
  attempts: number,
  customErrorMessage?: string,
  interval = 1000
): Promise<HubInfo> => {
  for (let i = 0; i < attempts; i++) {
    try {
      console.log('sleep before cont.');
      await sleep(interval);
      const response = await functionToWait();

      if (!response) {
        continue;
      }

      return response;
    } catch (e) {
      console.log('getChainInfo failed');
    }
  }

  throw Error(customErrorMessage);
};

const stopRelay = (proc: ChildProcessWithoutNullStreams): void => {
  proc.kill();
};

const evmMine = async (): Promise<unknown> => {
  return provider.send('evm_mine', []);
};

const evmMineMany = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await evmMine();
  }
};

const increaseBlockchainTime = async (time: number): Promise<void> => {
  await provider.send('evm_increaseTime', [time]);
  await evmMine();
};

const createEvmSnapshot = async (): Promise<string> => {
  return (await provider.send('evm_snapshot', [])) as string;
};

const revertEvmSnapshot = async (snapshotId: string) => {
  return (await provider.send('evm_revert', [snapshotId])) as boolean;
};

// An existing account in RSKJ that have been depleted
const getExistingGaslessAccount = async (): Promise<Wallet> => {
  const gaslessAccount = new Wallet(
    '0x082f57b8084286a079aeb9f2d0e17e565ced44a2cb9ce4844e6d4b9d89f3f595',
    provider
  );

  const balance = await gaslessAccount.getBalance();
  if (!balance.gte(0)) {
    await gaslessAccount.sendTransaction({
      to: constants.AddressZero,
      gasPrice: 1,
      gasLimit: 21000,
      value: balance.sub(21000),
    });
  }

  await expect(
    gaslessAccount.getBalance(),
    'Gassless account should have no funds'
  ).to.be.eventually.eql(constants.Zero);

  return gaslessAccount;
};

const deployRelayHub = async (
  penalizer: string = constants.AddressZero,
  configOverride: Partial<RelayHubConfiguration>
): Promise<RelayHub> => {
  const relayHubConfiguration: RelayHubConfiguration = {
    ...defaultEnvironment!.relayHubConfiguration,
    ...configOverride,
  };

  const relayHubFactory = (await ethers.getContractFactory(
    'RelayHub'
  )) as RelayHub__factory;

  const {
    maxWorkerCount,
    minimumUnstakeDelay,
    minimumStake,
    minimumEntryDepositValue,
  } = relayHubConfiguration;

  return relayHubFactory.deploy(
    penalizer,
    maxWorkerCount,
    minimumUnstakeDelay,
    minimumStake,
    minimumEntryDepositValue
  );
};

const createSmartWalletFactory = async (
  template: IForwarder,
  isCustom = false
) => {
  const factory = isCustom
    ? await ethers.getContractFactory('CustomSmartWalletFactory')
    : await ethers.getContractFactory('SmartWalletFactory');

  return factory.deploy(template.address);
};

const createSmartWallet = async ({
  relayHub,
  owner,
  factory,
  tokenContract = constants.AddressZero,
  tokenAmount = 0,
  tokenGas = 0,
  recoverer = constants.AddressZero,
  index = 0,
  validUntilTime = 0,
  logicAddr = constants.AddressZero,
  initParams = '0x00',
  isCustomSmartWallet,
}: CreateSmartWalletParams): Promise<RifSmartWallet> => {
  const envelopingRequest = createEnvelopingRequest(
    true,
    {
      relayHub,
      from: owner.address,
      to: logicAddr,
      tokenContract,
      recoverer,
      tokenAmount,
      tokenGas,
      validUntilTime,
      index,
      data: initParams,
    },
    {
      callForwarder: factory.address,
    }
  );

  const { signature, suffixData } = await signEnvelopingRequest(
    envelopingRequest,
    owner
  );

  const transaction = await factory.relayedUserSmartWalletCreation(
    envelopingRequest.request as DeployRequestBody,
    suffixData,
    constants.AddressZero,
    signature
  );

  const receipt = await transaction.wait();

  console.log('Cost of deploying SmartWallet: ', receipt.cumulativeGasUsed);

  const isCustom =
    isCustomSmartWallet ?? (!!logicAddr && logicAddr !== constants.AddressZero);

  const swAddress = isCustom
    ? await (factory as CustomSmartWalletFactory).getSmartWalletAddress(
        owner.address,
        recoverer,
        logicAddr,
        initParams,
        index
      )
    : await (factory as SmartWalletFactory).getSmartWalletAddress(
        owner.address,
        recoverer,
        index
      );

  return isCustom
    ? ethers.getContractAt('CustomSmartWallet', swAddress)
    : ethers.getContractAt('SmartWallet', swAddress);
};

const prepareRelayTransaction = async ({
  relayHub,
  owner,
  tokenContract = constants.AddressZero,
  tokenAmount = 0,
  tokenGas = 0,
  validUntilTime = 0,
  logicAddr = constants.AddressZero,
  initParams = '0x00',
  gas = 0,
  swAddress,
}: PrepareRelayTransactionParams) => {
  const envelopingRequest = createEnvelopingRequest(
    true,
    {
      relayHub,
      from: owner.address,
      to: logicAddr,
      data: initParams,
      tokenContract,
      tokenAmount,
      tokenGas,
      validUntilTime,
      gas,
    },
    {
      callForwarder: swAddress,
    }
  );

  const { signature } = await signEnvelopingRequest(envelopingRequest, owner);

  return {
    envelopingRequest,
    signature,
  };
};

const signEnvelopingRequest = async (
  envelopingRequest: EnvelopingRequest,
  wallet: Wallet
) => {
  const {
    relayData: { callForwarder },
  } = envelopingRequest;

  const { chainId } = await provider.getNetwork();

  const requestTypes = isDeployRequest(envelopingRequest)
    ? deployRequestType
    : relayRequestType;

  const data = getEnvelopingRequestDataV4Field({
    chainId,
    verifier: callForwarder.toString(),
    requestTypes,
    envelopingRequest,
  });

  const { domain, types, value, primaryType } = data;

  const signature = await wallet._signTypedData(domain, types, value);

  const messageSize = Object.keys(requestTypes).length;

  const enconded = _TypedDataEncoder.from(types).encodeData(primaryType, value);

  const suffixData =
    PREFIX_HEX +
    enconded.slice(messageSize * CHARS_PER_FIELD + PREFIX_HEX.length);

  return {
    signature,
    suffixData,
  };
};

const baseRelayData: EnvelopingRequestData = {
  gasPrice: '1',
  feesReceiver: constants.AddressZero,
  callForwarder: constants.AddressZero,
  callVerifier: constants.AddressZero,
};

const baseDeployRequest: DeployRequestBody = {
  relayHub: constants.AddressZero,
  from: constants.AddressZero,
  to: constants.AddressZero,
  tokenContract: constants.AddressZero,
  recoverer: constants.AddressZero,
  value: '0',
  nonce: '0',
  tokenAmount: '0',
  tokenGas: '0',
  validUntilTime: '0',
  index: '0',
  data: '0x00',
};

const baseRelayRequest: RelayRequestBody = {
  relayHub: constants.AddressZero,
  from: constants.AddressZero,
  to: constants.AddressZero,
  value: '0',
  gas: '0',
  nonce: '0',
  data: '0x00',
  tokenContract: constants.AddressZero,
  tokenAmount: '0',
  validUntilTime: '0',
  tokenGas: '0',
};

const createEnvelopingRequest = (
  isDeploy: boolean,
  request?: Partial<RelayRequestBody> | Partial<DeployRequestBody>,
  relayData?: Partial<EnvelopingRequestData>
): EnvelopingRequest => {
  return isDeploy
    ? {
        request: {
          ...baseDeployRequest,
          ...request,
        } as DeployRequestBody,
        relayData: {
          ...baseRelayData,
          ...relayData,
        },
      }
    : {
        request: {
          ...baseRelayRequest,
          ...request,
        } as RelayRequestBody,
        relayData: {
          ...baseRelayData,
          ...relayData,
        },
      };
};

export {
  startRelay,
  stopRelay,
  evmMine,
  evmMineMany,
  increaseBlockchainTime,
  createEvmSnapshot,
  revertEvmSnapshot,
  getExistingGaslessAccount,
  createSmartWalletFactory,
  createSmartWallet,
  prepareRelayTransaction,
  signEnvelopingRequest,
  deployRelayHub,
  createEnvelopingRequest,
};

export type {
  RifSmartWallet,
  RifSmartWalletFactory,
  StartRelayParams,
  CreateSmartWalletParams,
  PrepareRelayTransactionParams,
};

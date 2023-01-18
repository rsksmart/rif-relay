import childProcess, { ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BigNumberish, constants, utils, Wallet } from 'ethers';
import { expect } from 'chai';
import config from 'config';

import {
  RelayHub,
  SmartWalletFactory,
  CustomSmartWalletFactory,
  IForwarder,
  RelayHub__factory,
} from '@rsksmart/rif-relay-contracts';
import {
  defaultEnvironment,
  RelayHubConfiguration,
  ServerConfigParams,
  sleep,
} from '@rsksmart/rif-relay-server';
import {
  DeployRequest,
  deployRequestType,
  EnvelopingRequest,
  getEnvelopingRequestDataV4Field,
  HttpClient,
  HttpWrapper,
  HubInfo,
  isDeployRequest,
  RelayRequest,
  relayRequestType,
} from '@rsksmart/rif-relay-client';
import { ethers as hardhat } from 'hardhat';
import { _TypedDataEncoder } from 'ethers/lib/utils';

const SERVER_WORK_DIR = '/tmp/enveloping/test/server';
const ONE_FIELD_IN_BYTES = 32;

type StartRelayParams = {
  serverConfig: ServerConfigParams;
  delay?: number;
  stake?: BigNumberish;
  relayOwner: string;
  relayHubAddress: string;
};

const provider = hardhat.provider;

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

  const url = config.get<string>('app.url');

  const runServerPath = path.resolve(
    __dirname,
    '../node_modules/@rsksmart/rif-relay-server/dist/commands/Start.js'
  );

  const proc: ChildProcessWithoutNullStreams & { alreadyStarted?: number } =
    childProcess.spawn('node', [runServerPath]);

  const { relayManagerAddress } = await verifyRelayServerStatus(url, 3);

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

  const { ready, relayWorkerAddress } = await verifyRelayServerStatus(
    url,
    25,
    500,
    true
  );

  expect(ready, 'Timed out waiting for relay to get staked and registered').is
    .ok;

  return {
    proc,
    worker: relayWorkerAddress,
    manager: relayManagerAddress,
  };
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

const createSnapshot = async (): Promise<string> => {
  return (await provider.send('evm_snapshot', [])) as string;
};

const revertSnapshot = async (snapshotId: string) => {
  return (await provider.send('evm_revert', [snapshotId])) as boolean;
};

const verifyRelayServerStatus = async (
  url: string,
  attempts: number,
  interval = 1000,
  isReady = false
): Promise<HubInfo> => {
  let response: HubInfo | undefined;
  const httpClient = new HttpClient(new HttpWrapper(undefined, 'silent'));

  for (let i = 0; i < attempts; i++) {
    try {
      console.log('sleep before cont.');
      await sleep(interval);
      response = await httpClient.getChainInfo(url);

      if (isReady && !response.ready) {
        continue;
      }

      return response;
    } catch (e) {
      /* empty */
    }
  }

  throw Error("can't ping server");
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

  const relayHubFactory = await hardhat.getContractFactory('RelayHub');

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
    ? await hardhat.getContractFactory('CustomSmartWalletFactory')
    : await hardhat.getContractFactory('SmartWalletFactory');

  return factory.deploy(template.address);
};

const createSmartWallet = async (
  relayHub: string,
  owner: string,
  factory: SmartWalletFactory | CustomSmartWalletFactory,
  wallet: Wallet,
  tokenContract = constants.AddressZero,
  tokenAmount = 0,
  tokenGas = 0,
  recoverer = constants.AddressZero,
  index: 0,
  validUntilTime: 0,
  logicAddr = constants.AddressZero,
  initParams = '0x00'
) => {
  const envelopingRequest: DeployRequest = {
    request: {
      relayHub,
      from: owner,
      to: logicAddr,
      value: 0,
      nonce: 0,
      data: initParams,
      tokenContract,
      tokenAmount,
      tokenGas,
      recoverer,
      index,
      validUntilTime,
    },
    relayData: {
      gasPrice: 1,
      feesReceiver: constants.AddressZero,
      callForwarder: factory.address,
      callVerifier: constants.AddressZero,
    },
  };

  const { signature, suffixData } = await signEnvelopingRequest(
    envelopingRequest,
    wallet
  );

  const transaction = await factory.relayedUserSmartWalletCreation(
    envelopingRequest.request,
    suffixData,
    constants.AddressZero,
    signature
  );

  const receipt = await transaction.wait();

  console.log('Cost of deploying SmartWallet: ', receipt.cumulativeGasUsed);

  const isCustom = !!logicAddr && logicAddr !== constants.AddressZero;

  const swAddress = isCustom
    ? await (factory as CustomSmartWalletFactory).getSmartWalletAddress(
        owner,
        recoverer,
        logicAddr,
        initParams,
        index
      )
    : await (factory as SmartWalletFactory).getSmartWalletAddress(
        owner,
        recoverer,
        index
      );

  return isCustom
    ? hardhat.getContractAt('CustomSmartWallet', swAddress)
    : hardhat.getContractAt('SmartWallet', swAddress);
};

const prepareRelayTransaction = async (
  relayHub: string,
  owner: string,
  wallet: Wallet,
  tokenContract = constants.AddressZero,
  tokenAmount = 0,
  tokenGas = 0,
  validUntilTime: 0,
  logicAddr = constants.AddressZero,
  initParams = '0x00',
  gas = 0,
  swAddress: string
) => {
  const envelopingRequest: RelayRequest = {
    request: {
      relayHub,
      from: owner,
      to: logicAddr,
      value: 0,
      nonce: 0,
      data: initParams,
      tokenContract,
      tokenAmount,
      tokenGas,
      validUntilTime,
      gas,
    },
    relayData: {
      gasPrice: 1,
      feesReceiver: constants.AddressZero,
      callForwarder: swAddress,
      callVerifier: constants.AddressZero,
    },
  };

  const { signature } = await signEnvelopingRequest(envelopingRequest, wallet);

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

  const isDeploy = isDeployRequest(envelopingRequest);

  const { chainId } = await provider.getNetwork();

  const data = getEnvelopingRequestDataV4Field({
    chainId,
    verifier: callForwarder.toString(),
    requestTypes: isDeploy ? deployRequestType : relayRequestType,
    envelopingRequest,
  });

  const { domain, types, value } = data;

  const signature = await wallet._signTypedData(domain, types, value);

  const messageSize = Object.keys(value).length;

  const enconded = _TypedDataEncoder.encode(domain, types, value);

  const suffixData = enconded.slice((1 + messageSize) * ONE_FIELD_IN_BYTES);

  return {
    signature,
    suffixData,
  };
};

export {
  startRelay,
  stopRelay,
  evmMine,
  evmMineMany,
  increaseBlockchainTime,
  createSnapshot,
  revertSnapshot,
  getExistingGaslessAccount,
  createSmartWalletFactory,
  createSmartWallet,
  prepareRelayTransaction,
  signEnvelopingRequest,
  deployRelayHub,
};

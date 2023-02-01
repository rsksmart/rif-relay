import childProcess, { ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BigNumberish, constants, utils, Wallet } from 'ethers';
import chaiAsPromised from 'chai-as-promised';
import { expect, use } from 'chai';
import {
  RelayHub,
  SmartWalletFactory,
  CustomSmartWalletFactory,
  IForwarder,
  RelayHub__factory,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  defaultEnvironment,
  getServerConfig,
  RelayHubConfiguration,
  ServerConfigParams,
  sleep,
} from '@rsksmart/rif-relay-server';
import {
  DeployRequestBody,
  EnvelopingRequest,
  EnvelopingRequestData,
  HttpClient,
  HttpWrapper,
  HubInfo,
  isDeployRequest,
  RelayRequest,
  RelayRequestBody,
} from '@rsksmart/rif-relay-client';
import { ethers } from 'hardhat';
import { keccak256 } from 'ethers/lib/utils';
import { CustomSmartWallet } from 'typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  SignTypedDataVersion,
  TypedDataUtils,
  TypedMessage,
  signTypedData,
} from '@metamask/eth-sig-util';
import {
  getLocalEip712Signature,
  TypedRequestData,
  TypedDeployRequestData,
  getLocalEip712DeploySignature,
  EnvelopingEIP712Types,
  getTypedRequestData,
} from '../utils/EIP712Utils';
import type { EnvelopingTypes } from '@rsksmart/rif-relay-contracts';

use(chaiAsPromised);

const ATTEMPTS_GET_SERVER_STATUS = 3;
const ATTEMPTS_GET_SERVER_READY = 25;
const ONE_FIELD_IN_BYTES = 32;

type RifSmartWallet = SmartWallet | CustomSmartWallet;

type RifSmartWalletFactory = SmartWalletFactory | CustomSmartWalletFactory;

type RelayRequest = EnvelopingTypes.RelayRequestStruct;

type StartRelayParams = {
  serverConfig: ServerConfigParams;
  delay?: number;
  stake?: BigNumberish;
  relayOwner: string;
  relayHubAddress: string;
};

type CreateSmartWalletParams = {
  relayHub: string;
  sender: SignerWithAddress;
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
  const { delay, stake, relayOwner } = options;

  const {
    app: { workdir },
  } = getServerConfig();

  fs.rmSync(workdir, { recursive: true, force: true });

  const url = buildServerUrl();

  const runServerPath = path.resolve(
    __dirname,
    '../node_modules/@rsksmart/rif-relay-server/dist/commands/Start.js'
  );

  const proc: ChildProcessWithoutNullStreams & { alreadyStarted?: number } =
    childProcess.spawn('node', [runServerPath]);

  const client = new HttpClient(new HttpWrapper(undefined, 'silent'));

  const { relayManagerAddress, relayHubAddress } = await doUntilDefined(
    () => client.getChainInfo(url),
    ATTEMPTS_GET_SERVER_STATUS
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
    'Server is not ready to relay transactions'
  );

  return {
    proc,
    worker: relayWorkerAddress,
    manager: relayManagerAddress,
  };
};

const buildServerUrl = () => {
  const { app } = getServerConfig();

  const portFromUrl = app.url.match(/:(\d{0,5})$/);

  return !portFromUrl && app.port ? `${app.url}:${app.port}` : app.url;
};

const getServerReady = async (
  url: string,
  client = new HttpClient(new HttpWrapper(undefined, 'silent'))
): Promise<HubInfo | undefined> => {
  const response = await client.getChainInfo(url);

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

  throw Error(
    `HubInfo poll expired: (${customErrorMessage ?? 'Server is not reachable'})`
  );
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
const getExistingGaslessAccount = async (): Promise<SignerWithAddress> => {
  const signers = await ethers.getSigners();
  const accountToBeDepleted = signers.at(9)!;

  const balance = await accountToBeDepleted.getBalance();
  if (!balance.gte(0)) {
    await accountToBeDepleted.sendTransaction({
      to: constants.AddressZero,
      gasPrice: 1,
      gasLimit: 21000,
      value: balance.sub(21000),
    });
  }

  await expect(
    accountToBeDepleted.getBalance(),
    'Gassless account should have no funds'
  ).to.be.eventually.eql(constants.Zero);

  return accountToBeDepleted;
};

const deployRelayHub = async (
  penalizer: string = constants.AddressZero,
  configOverride?: Partial<RelayHubConfiguration>
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
  isCustom = false,
  owner: Wallet
) => {
  const factory = isCustom
    ? await ethers.getContractFactory('CustomSmartWalletFactory')
    : await ethers.getContractFactory('SmartWalletFactory');

  return factory.connect(owner).deploy(template.address);
};

const createRifSmartWallet = async (
  isCustom: boolean,
  owner: Wallet,
  index: number,
  factory: RifSmartWalletFactory
) => {
  if (isCustom) {
    const dataTypesToSign = [
      'bytes2',
      'address',
      'address',
      'address',
      'uint256',
      'bytes',
    ];
    const valuesToSign = [
      '0x1910',
      owner.address,
      constants.AddressZero,
      constants.AddressZero,
      index,
      '0x',
    ];

    const signature = signData(dataTypesToSign, valuesToSign, owner);
    await (factory as CustomSmartWalletFactory).createUserSmartWallet(
      owner.address,
      constants.AddressZero,
      constants.AddressZero,
      index,
      '0x',
      signature
    );

    const customSmartWalletAddress = await (
      factory as CustomSmartWalletFactory
    ).getSmartWalletAddress(
      owner.address,
      constants.AddressZero,
      constants.AddressZero,
      keccak256('0x'),
      index
    );

    return await ethers.getContractAt(
      'CustomSmartWallet',
      customSmartWalletAddress
    );
  } else {
    const dataTypesToSign = ['bytes2', 'address', 'address', 'uint256'];
    const valuesToSign = [
      '0x1910',
      owner.address,
      constants.AddressZero,
      index,
    ];

    const signature = signData(dataTypesToSign, valuesToSign, owner);
    await (factory as SmartWalletFactory).createUserSmartWallet(
      owner.address,
      constants.AddressZero,
      index,
      signature
    );

    const smartWalletAddress = await (
      factory as SmartWalletFactory
    ).getSmartWalletAddress(owner.address, constants.AddressZero, index);

    return await ethers.getContractAt('SmartWallet', smartWalletAddress);
  }
};

//TODO: Replace new signature function here
// const prepareRelayTransaction = async ({
//   relayHub,
//   owner,
//   tokenContract = constants.AddressZero,
//   tokenAmount = 0,
//   tokenGas = 0,
//   validUntilTime = 0,
//   logicAddr = constants.AddressZero,
//   initParams = '0x00',
//   gas = 0,
//   swAddress,
// }: PrepareRelayTransactionParams) => {
//   const envelopingRequest = createEnvelopingRequest(
//     true,
//     {
//       relayHub,
//       from: owner.address,
//       to: logicAddr,
//       data: initParams,
//       tokenContract,
//       tokenAmount,
//       tokenGas,
//       validUntilTime,
//       gas,
//     },
//     {
//       callForwarder: swAddress,
//     }
//   );

//   // const { signature } = await signEnvelopingRequest(envelopingRequest, owner);
//   const { signature } = await getSuffixDataAndSignature(envelopingRequest, owner);

//   return {
//     envelopingRequest,
//     signature,
//   };
// };

const getSuffixDataAndSignature = async (
  rifSmartWallet: RifSmartWallet,
  relayRequest: RelayRequest,
  owner: Wallet
) => {
  const { chainId } = await provider.getNetwork();

  const typedRequestData = new TypedRequestData(
    chainId,
    rifSmartWallet.address,
    relayRequest
  );

  const privateKey = Buffer.from(owner.privateKey.substring(2, 66), 'hex');

  const suffixData = getSuffixData(typedRequestData);
  const signature = getLocalEip712Signature(typedRequestData, privateKey);

  return { suffixData, signature };
};

const getSuffixData = (typedRequestData: TypedRequestData): string => {
  const encoded = TypedDataUtils.encodeData(
    typedRequestData.primaryType,
    typedRequestData.message,
    typedRequestData.types,
    SignTypedDataVersion.V4
  );

  const messageSize = Object.keys(typedRequestData.message).length;

  return '0x' + encoded.slice(messageSize * ONE_FIELD_IN_BYTES).toString('hex');
};

const signData = (
  dataTypesToSign: Array<string>,
  valuesToSign: Array<string | number>,
  owner: Wallet
) => {
  const privateKey = Buffer.from(owner.privateKey.substring(2, 66), 'hex');
  const toSign = ethers.utils.solidityKeccak256(dataTypesToSign, valuesToSign);
  const toSignAsBinaryArray = ethers.utils.arrayify(toSign);
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const signature = signingKey.signDigest(toSignAsBinaryArray);

  return ethers.utils.joinSignature(signature);
};

const getSuffixDataAndSignature = async (
  rifSmartWallet: RifSmartWallet,
  relayRequest: RelayRequest,
  owner: Wallet
) => {
  const { chainId } = await provider.getNetwork();

  const typedRequestData = getTypedRequestData(
    chainId,
    rifSmartWallet.address,
    relayRequest
  );

  const privateKey = Buffer.from(owner.privateKey.substring(2, 66), 'hex');

  const suffixData = getSuffixData(typedRequestData);

  const signature = signTypedData({
    privateKey: privateKey,
    data: typedRequestData,
    version: SignTypedDataVersion.V4,
  });

  return { suffixData, signature };
};

const getSuffixData = (
  typedRequestData: TypedMessage<EnvelopingEIP712Types>
): string => {
  const encoded = TypedDataUtils.encodeData(
    typedRequestData.primaryType as string,
    typedRequestData.message,
    typedRequestData.types,
    SignTypedDataVersion.V4
  );

  const messageSize = Object.keys(typedRequestData.message).length;

  return '0x' + encoded.slice(messageSize * 32).toString('hex');
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
  // prepareRelayTransaction,
  deployRelayHub,
  createEnvelopingRequest,
  getSuffixData,
  signData,
  getSuffixDataAndSignature,
  createRifSmartWallet,
};

export type {
  RifSmartWallet,
  RifSmartWalletFactory,
  StartRelayParams,
  CreateSmartWalletParams,
  PrepareRelayTransactionParams,
};

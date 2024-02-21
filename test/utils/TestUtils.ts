import {
  BigNumberish,
  constants,
  Contract,
  ContractInterface,
  utils,
  Wallet,
} from 'ethers';
import chaiAsPromised from 'chai-as-promised';
import { expect, use } from 'chai';
import {
  RelayHub,
  SmartWalletFactory,
  CustomSmartWalletFactory,
  SmartWallet,
  BoltzSmartWalletFactory,
  DeployVerifier,
  CustomSmartWalletDeployVerifier,
  BoltzDeployVerifier,
  RelayVerifier,
  BoltzRelayVerifier,
  MinimalBoltzSmartWalletFactory,
  BoltzSmartWallet,
  CustomSmartWallet,
  MinimalBoltzDeployVerifier,
  MinimalBoltzRelayVerifier,
  MinimalBoltzSmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  defaultEnvironment,
  RelayHubConfiguration,
} from '@rsksmart/rif-relay-server';
import {
  DeployRequestBody,
  deployRequestType,
  EnvelopingRequest,
  EnvelopingRequestData,
  getEnvelopingRequestDataV4Field,
  isDeployRequest,
  RelayRequestBody,
  relayRequestType,
  SHA3_NULL_S,
  UserDefinedDeployData,
  UserDefinedDeployRequest,
  UserDefinedDeployRequestBody,
  UserDefinedRelayData,
  UserDefinedRelayRequest,
  UserDefinedRelayRequestBody,
} from '@rsksmart/rif-relay-client';
import { ethers } from 'hardhat';
import { keccak256, _TypedDataEncoder } from 'ethers/lib/utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util';
import {
  getLocalEip712Signature,
  TypedRequestData,
} from '../utils/EIP712Utils';
import nodeConfig from 'config';

import SmartWalletJson from '../../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/SmartWallet.sol/SmartWallet.json';
import CustomSmartWalletJson from '../../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/CustomSmartWallet.sol/CustomSmartWallet.json';
import BoltzSmartWalletJson from '../../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/BoltzSmartWallet.sol/BoltzSmartWallet.json';
import MinimalBoltzSmartWalletJson from '../../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/MinimalBoltzSmartWallet.sol/MinimalBoltzSmartWallet.json';

use(chaiAsPromised);

const ONE_FIELD_IN_BYTES = 32;
const CHARS_PER_FIELD = 64;
const PREFIX_HEX = '0x';

type SupportedSmartWalletName =
  | 'CustomSmartWallet'
  | 'SmartWallet'
  | 'BoltzSmartWallet'
  | 'MinimalBoltzSmartWallet';
type SupportedSmartWallet = CustomSmartWallet | SmartWallet | BoltzSmartWallet;
type SupportedSmartWalletFactory =
  | CustomSmartWalletFactory
  | SmartWalletFactory
  | BoltzSmartWalletFactory
  | MinimalBoltzSmartWalletFactory;
type SupportedType = 'Custom' | 'Boltz' | 'MinimalBoltz' | 'Default';
type SupportedDeployVerifier =
  | DeployVerifier
  | CustomSmartWalletDeployVerifier
  | BoltzDeployVerifier
  | MinimalBoltzDeployVerifier;

type CreateSmartWalletParams = {
  relayHub: string;
  sender: SignerWithAddress;
  owner: Wallet;
  factory: SupportedSmartWalletFactory;
  tokenContract?: string;
  tokenAmount?: BigNumberish;
  tokenGas?: BigNumberish;
  recoverer?: string;
  index?: number;
  validUntilTime?: number;
  logicAddr?: string;
  initParams?: string;
  type?: SupportedType;
  logGas?: boolean;
};

const CONFIG_BLOCKCHAIN = 'blockchain';
const CONFIG_RSK_URL = 'rskNodeUrl';

const RSK_URL = nodeConfig.get<string>(
  `${CONFIG_BLOCKCHAIN}.${CONFIG_RSK_URL}`
);

const { provider } = ethers;

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
  const accountToBeDepleted = signers.at(9) as SignerWithAddress;

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
    ...defaultEnvironment.relayHubConfiguration,
    ...configOverride,
  };

  const relayHubFactory = await ethers.getContractFactory('RelayHub');

  const {
    maxWorkerCount,
    minimumUnstakeDelay,
    minimumStake,
    minimumEntryDepositValue,
  } = relayHubConfiguration;

  return relayHubFactory.deploy(
    penalizer,
    maxWorkerCount,
    minimumEntryDepositValue,
    minimumUnstakeDelay,
    minimumStake
  );
};

const deployVerifiers = async <
  C1 extends SupportedDeployVerifier,
  C2 extends RelayVerifier | BoltzRelayVerifier | MinimalBoltzRelayVerifier
>(
  smartWalletFactory: SupportedSmartWalletFactory,
  type: SupportedType = 'Default'
): Promise<{
  deployVerifier: C1;
  relayVerifier: C2;
}> => {
  const deployVerifierFactory = await ethers.getContractFactory(
    `${type === 'Default' ? '' : type}DeployVerifier`
  );
  const deployVerifier = (await deployVerifierFactory.deploy(
    smartWalletFactory.address
  )) as C1;

  const relayVerifierFactory = await ethers.getContractFactory(
    `${type === 'Default' || type === 'Custom' ? '' : type}RelayVerifier`
  );
  const relayVerifier = (await relayVerifierFactory.deploy(
    smartWalletFactory.address
  )) as C2;

  return {
    deployVerifier,
    relayVerifier,
  };
};

const createSmartWalletFactory = async <T extends SupportedSmartWalletFactory>(
  template: SupportedSmartWallet | MinimalBoltzSmartWallet,
  owner: Wallet | SignerWithAddress,
  type: SupportedType = 'Default'
): Promise<T> => {
  const factory = await ethers.getContractFactory(
    `${type === 'Default' ? '' : type}SmartWalletFactory`
  );

  return (await factory.connect(owner).deploy(template.address)) as T;
};

const createSupportedSmartWallet = async <
  T extends SupportedSmartWallet | MinimalBoltzSmartWallet
>({
  relayHub,
  sender,
  owner,
  factory,
  tokenContract = constants.AddressZero,
  tokenAmount = 0,
  tokenGas = 0,
  recoverer = constants.AddressZero,
  index = 0,
  validUntilTime = 0,
  logicAddr = constants.AddressZero,
  initParams = SHA3_NULL_S,
  type = 'Default',
  logGas = false,
}: CreateSmartWalletParams): Promise<T> => {
  const envelopingRequest = createDeployEnvelopingRequest(
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

  const deployTransaction = await factory
    .connect(sender)
    .relayedUserSmartWalletCreation(
      envelopingRequest.request as DeployRequestBody,
      suffixData,
      constants.AddressZero,
      signature
    );

  if (logGas) {
    const deployReceipt = await deployTransaction.wait();
    console.log(
      `Smart Wallet Deployment Cumulative Gas Used: ${deployReceipt.gasUsed.toString()}\n`
    );
  }

  const swAddress = await getSmartWalletAddress({
    type,
    factory,
    owner,
    recoverer,
    logicAddr,
    initParams,
    index,
  });

  // We couldn't use ethers.at(...) because we couldn't retrieve the revert reason.
  const abis: Record<SupportedType, ContractInterface> = {
    Default: SmartWalletJson.abi,
    Custom: CustomSmartWalletJson.abi,
    Boltz: BoltzSmartWalletJson.abi,
    MinimalBoltz: MinimalBoltzSmartWalletJson.abi,
  };

  return new Contract(swAddress, abis[type], owner) as T;
};

export const signEnvelopingRequest = async (
  envelopingRequest: EnvelopingRequest,
  signer: Wallet
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

  const signature = await signer._signTypedData(domain, types, value);

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

const getSuffixDataAndSignature = async (
  forwarder: SupportedSmartWallet | SupportedSmartWalletFactory,
  relayRequest: EnvelopingRequest,
  owner: Wallet
) => {
  const { chainId } = await provider.getNetwork();

  const typedRequestData = new TypedRequestData(
    chainId,
    forwarder.address,
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

const generateRandomAddress = (): string => {
  return utils.hexlify(utils.randomBytes(20));
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

const createRelayEnvelopingRequest = (
  request?: Partial<RelayRequestBody> | Partial<DeployRequestBody>,
  relayData?: Partial<EnvelopingRequestData>
): EnvelopingRequest => {
  return {
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

const createDeployEnvelopingRequest = (
  request?: Partial<RelayRequestBody> | Partial<DeployRequestBody>,
  relayData?: Partial<EnvelopingRequestData>
): EnvelopingRequest => {
  return {
    request: {
      ...baseDeployRequest,
      ...request,
    } as DeployRequestBody,
    relayData: {
      ...baseRelayData,
      ...relayData,
    },
  };
};

const baseUserDefinedDeployBody: UserDefinedDeployRequestBody = {
  from: constants.AddressZero,
  index: 0,
  tokenContract: constants.AddressZero,
};

const baseUserDefinedRelayBody: UserDefinedRelayRequestBody = {
  from: constants.AddressZero,
  tokenContract: constants.AddressZero,
  data: '0x00',
  to: constants.AddressZero,
};

const baseUserDefinedRelayData: UserDefinedRelayData = {
  callForwarder: constants.AddressZero,
};

const createRelayUserDefinedRequest = (
  request?: Partial<UserDefinedRelayRequestBody>,
  relayData?: Partial<UserDefinedRelayData>
): UserDefinedRelayRequest => {
  return {
    request: {
      ...baseUserDefinedRelayBody,
      ...request,
    },
    relayData: {
      ...baseUserDefinedRelayData,
      ...relayData,
    },
  };
};

const createDeployUserDefinedRequest = (
  request?: Partial<UserDefinedDeployRequestBody>,
  relayData?: Partial<UserDefinedDeployData>
): UserDefinedDeployRequest => {
  return {
    request: {
      ...baseUserDefinedDeployBody,
      ...request,
    },
    relayData: {
      ...baseUserDefinedRelayData,
      ...relayData,
    },
  };
};

type GetSmartWalletAddressParams = {
  type: SupportedType;
  factory: SupportedSmartWalletFactory;
  owner: Wallet;
  recoverer: string;
  index: number;
  logicAddr?: string;
  initParams?: string;
};

async function getSmartWalletAddress({
  type,
  factory,
  owner,
  recoverer,
  index,
  logicAddr = constants.AddressZero,
  initParams = '0x',
}: GetSmartWalletAddressParams) {
  return type === 'Custom'
    ? await (factory as CustomSmartWalletFactory).getSmartWalletAddress(
        owner.address,
        recoverer,
        logicAddr,
        keccak256(initParams),
        index
      )
    : await (factory as SmartWalletFactory).getSmartWalletAddress(
        owner.address,
        recoverer,
        index
      );
}

async function deployContract<T>(contract: string) {
  const contractFactory = await ethers.getContractFactory(contract);

  return contractFactory.deploy() as T;
}

const getSmartWalletTemplate = (type: SupportedType) =>
  `${type === 'Default' ? '' : type}SmartWallet`;

export {
  evmMine,
  evmMineMany,
  increaseBlockchainTime,
  createEvmSnapshot,
  revertEvmSnapshot,
  getExistingGaslessAccount,
  createSmartWalletFactory,
  deployRelayHub,
  deployVerifiers,
  createRelayEnvelopingRequest,
  createDeployEnvelopingRequest,
  createRelayUserDefinedRequest,
  createDeployUserDefinedRequest,
  getSuffixData,
  signData,
  generateRandomAddress,
  getSuffixDataAndSignature,
  createSupportedSmartWallet,
  RSK_URL,
  deployContract,
  getSmartWalletAddress,
  getSmartWalletTemplate,
};

export type {
  CreateSmartWalletParams,
  SupportedSmartWalletName,
  SupportedSmartWallet,
  SupportedSmartWalletFactory,
  SupportedType,
  SupportedDeployVerifier,
};

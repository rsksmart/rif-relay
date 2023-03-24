import { BigNumberish, constants, Contract, utils, Wallet } from 'ethers';
import chaiAsPromised from 'chai-as-promised';
import { expect, use } from 'chai';
import {
  RelayHub,
  SmartWalletFactory,
  CustomSmartWalletFactory,
  IForwarder,
  SmartWallet,
  CustomSmartWalletDeployVerifier,
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
import { CustomSmartWallet, DeployVerifier } from 'typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util';
import {
  getLocalEip712Signature,
  TypedRequestData,
} from '../utils/EIP712Utils';
import nodeConfig from 'config';

import SmartWalletJson from '../../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/SmartWallet.sol/SmartWallet.json';
import CustomSmartWalletJson from '../../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/CustomSmartWallet.sol/CustomSmartWallet.json';

use(chaiAsPromised);

const ONE_FIELD_IN_BYTES = 32;
const CHARS_PER_FIELD = 64;
const PREFIX_HEX = '0x';

type SupportedSmartWallet = CustomSmartWallet | SmartWallet;
type SupportedSmartWalletFactory =
  | CustomSmartWalletFactory
  | SmartWalletFactory;

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
  isCustomSmartWallet?: boolean;
  logGas?: boolean;
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

const deployVerifiers = async (
  smartWalletFactory: SmartWalletFactory | CustomSmartWalletFactory,
  isCustom = false
) => {
  let deployVerifier: DeployVerifier | CustomSmartWalletDeployVerifier;

  if (isCustom) {
    const deployVerifierFactory = await ethers.getContractFactory(
      'CustomSmartWalletDeployVerifier'
    );
    deployVerifier = await deployVerifierFactory.deploy(
      smartWalletFactory.address
    );
  } else {
    const deployVerifierFactory = await ethers.getContractFactory(
      'DeployVerifier'
    );
    deployVerifier = await deployVerifierFactory.deploy(
      smartWalletFactory.address
    );
  }

  const relayVerifierFactory = await ethers.getContractFactory('RelayVerifier');
  const relayVerifier = await relayVerifierFactory.deploy(
    smartWalletFactory.address
  );

  return {
    deployVerifier,
    relayVerifier,
  };
};

const createSmartWalletFactory = async (
  template: IForwarder,
  isCustom = false,
  owner: Wallet | SignerWithAddress
) => {
  const factory = isCustom
    ? await ethers.getContractFactory('CustomSmartWalletFactory')
    : await ethers.getContractFactory('SmartWalletFactory');

  return factory.connect(owner).deploy(template.address);
};

const createSupportedSmartWallet = async ({
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
  isCustomSmartWallet,
  logGas = false,
}: CreateSmartWalletParams): Promise<SupportedSmartWallet> => {
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

  const isCustom =
    isCustomSmartWallet ?? (!!logicAddr && logicAddr !== constants.AddressZero);

  const swAddress = isCustom
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

  // We couldn't use ethers.at(...) because we couldn't retrieve the revert reason.
  return isCustom
    ? (new Contract(
        swAddress,
        CustomSmartWalletJson.abi,
        owner
      ) as CustomSmartWallet)
    : (new Contract(swAddress, SmartWalletJson.abi, owner) as SmartWallet);
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
  forwarder: SupportedSmartWallet | SmartWalletFactory,
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

const createUserDefinedRequest = (
  isDeploy: boolean,
  request?: Partial<UserDefinedDeployRequestBody | UserDefinedRelayRequestBody>,
  relayData?: Partial<UserDefinedDeployData | UserDefinedRelayData>
): UserDefinedRelayRequest | UserDefinedDeployRequest => {
  return isDeploy
    ? {
        request: {
          ...baseUserDefinedDeployBody,
          ...request,
        },
        relayData: {
          ...baseUserDefinedRelayData,
          ...relayData,
        },
      }
    : {
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

async function deployContract<T>(contract: string) {
  const contractFactory = await ethers.getContractFactory(contract);

  return contractFactory.deploy() as T;
}

export {
  evmMine,
  evmMineMany,
  increaseBlockchainTime,
  createEvmSnapshot,
  revertEvmSnapshot,
  getExistingGaslessAccount,
  createSmartWalletFactory,
  prepareRelayTransaction,
  deployRelayHub,
  deployVerifiers,
  createEnvelopingRequest,
  createUserDefinedRequest,
  getSuffixData,
  signData,
  generateRandomAddress,
  getSuffixDataAndSignature,
  createSupportedSmartWallet,
  RSK_URL,
  deployContract,
};

export type {
  CreateSmartWalletParams,
  PrepareRelayTransactionParams,
  SupportedSmartWallet,
  SupportedSmartWalletFactory,
};

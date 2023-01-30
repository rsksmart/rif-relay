import {
  MessageTypeProperty,
  MessageTypes,
  signTypedData,
  SignTypedDataVersion,
  TypedMessage,
} from '@metamask/eth-sig-util';

import {
  EnvelopingTypes,
  IForwarder,
} from '../../typechain-types/@rsksmart/rif-relay-contracts/contracts/RelayHub';

export type ForwardRequest = IForwarder.ForwardRequestStruct;
export type RelayData = EnvelopingTypes.RelayDataStruct;
export type RelayRequest = EnvelopingTypes.RelayRequestStruct;
export type DeployRequest = EnvelopingTypes.DeployRequestStruct;

const eIP712DomainType: MessageTypeProperty[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const relayDataType: MessageTypeProperty[] = [
  { name: 'gasPrice', type: 'uint256' },
  { name: 'feesReceiver', type: 'address' },
  { name: 'callForwarder', type: 'address' },
  { name: 'callVerifier', type: 'address' },
];

export const forwardRequestType: MessageTypeProperty[] = [
  { name: 'relayHub', type: 'address' },
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'tokenContract', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'gas', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'tokenAmount', type: 'uint256' },
  { name: 'tokenGas', type: 'uint256' },
  { name: 'validUntilTime', type: 'uint256' },
  { name: 'data', type: 'bytes' },
];

export const deployRequestDataType: MessageTypeProperty[] = [
  { name: 'relayHub', type: 'address' },
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'tokenContract', type: 'address' },
  { name: 'recoverer', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'tokenAmount', type: 'uint256' },
  { name: 'tokenGas', type: 'uint256' },
  { name: 'index', type: 'uint256' },
  { name: 'validUntilTime', type: 'uint256' },
  { name: 'data', type: 'bytes' },
];

const relayRequestType: MessageTypeProperty[] = [
  ...forwardRequestType,
  { name: 'relayData', type: 'RelayData' },
];

const deployRequestType: MessageTypeProperty[] = [
  ...deployRequestDataType,
  { name: 'relayData', type: 'RelayData' },
];

interface Types extends MessageTypes {
  EIP712Domain: MessageTypeProperty[];
  RelayRequest: MessageTypeProperty[];
  RelayData: MessageTypeProperty[];
}

// use these values in registerDomainSeparator
export const domainSeparatorType = {
  prefix: 'string name,string version',
  name: 'RSK Enveloping Transaction',
  version: '2',
};

type Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
};

function getDomainSeparator(
  verifyingContract: string,
  chainId: number
): Domain {
  return {
    name: domainSeparatorType.name,
    version: domainSeparatorType.version,
    chainId: chainId,
    verifyingContract: verifyingContract,
  };
}

export class TypedRequestData implements TypedMessage<Types> {
  readonly types: Types;

  readonly domain: Domain;

  readonly primaryType: string;

  readonly message: Record<string, unknown>;

  constructor(chainId: number, verifier: string, relayRequest: RelayRequest) {
    this.types = {
      EIP712Domain: eIP712DomainType,
      RelayRequest: relayRequestType,
      RelayData: relayDataType,
    };
    this.domain = getDomainSeparator(verifier, chainId);
    this.primaryType = 'RelayRequest';
    // in the signature, all "request" fields are flattened out at the top structure.
    // other params are inside "relayData" sub-type
    this.message = {
      ...relayRequest.request,
      relayData: relayRequest.relayData,
    };
  }
}

export function getLocalEip712Signature(
  typedRequestData: TypedMessage<Types>,
  privateKey: Buffer
): string {
  return signTypedData({
    privateKey: privateKey,
    data: typedRequestData,
    version: SignTypedDataVersion.V4,
  });
}

export class TypedDeployRequestData implements TypedMessage<Types> {
  readonly types: Types;

  readonly domain: Domain;

  readonly primaryType: string;

  readonly message: Record<string, unknown>;

  constructor(chainId: number, verifier: string, deployRequest: DeployRequest) {
    this.types = {
      EIP712Domain: eIP712DomainType,
      RelayRequest: deployRequestType,
      RelayData: relayDataType,
    };
    this.domain = getDomainSeparator(verifier, chainId);
    this.primaryType = 'RelayRequest';
    // in the signature, all "request" fields are flattened out at the top structure.
    // other params are inside "relayData" sub-type
    this.message = {
      ...deployRequest.request,
      relayData: deployRequest.relayData,
    };
  }
}

export function getLocalEip712DeploySignature(
  typedRequestData: TypedMessage<Types>,
  privateKey: Buffer
): string {
  return signTypedData({
    privateKey: privateKey,
    data: typedRequestData,
    version: SignTypedDataVersion.V4,
  });
}

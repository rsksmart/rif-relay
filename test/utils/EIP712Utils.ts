import {
  MessageTypeProperty,
  MessageTypes,
  signTypedData,
  SignTypedDataVersion,
  TypedMessage,
} from '@metamask/eth-sig-util';
import { relayDataType, relayRequestType } from '@rsksmart/rif-relay-client';

import {
  EnvelopingTypes,
  IForwarder,
} from '../../typechain-types/@rsksmart/rif-relay-contracts/contracts/RelayHub';

export type ForwardRequest = IForwarder.ForwardRequestStruct;
export type RelayData = EnvelopingTypes.RelayDataStruct;
export type RelayRequest = EnvelopingTypes.RelayRequestStruct;

const eIP712DomainType: MessageTypeProperty[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
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

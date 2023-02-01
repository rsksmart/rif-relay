import { TypedMessage, MessageTypeProperty } from '@metamask/eth-sig-util';
import {
  relayDataType,
  relayRequestType,
  getDomainSeparator,
  EnvelopingMessageTypes,
  RelayRequest,
} from '@rsksmart/rif-relay-client';

const eIP712DomainType: MessageTypeProperty[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

export type EnvelopingEIP712Types = {
  EIP712Domain: MessageTypeProperty[];
} & EnvelopingMessageTypes;

export const getTypedRequestData = (
  chainId: number,
  verifier: string,
  relayRequest: RelayRequest
): TypedMessage<EnvelopingEIP712Types> => {
  return {
    types: {
      EIP712Domain: eIP712DomainType,
      RelayRequest: relayRequestType,
      RelayData: relayDataType,
    },
    domain: getDomainSeparator(verifier, chainId),
    primaryType: 'RelayRequest',
    message: {
      ...relayRequest.request,
      relayData: relayRequest.relayData,
    },
  } as TypedMessage<EnvelopingEIP712Types>;
};

import { PrefixedHexString } from 'ethereumjs-tx'
import ow from 'ow'

import { Address } from './Aliases'
import RelayRequest from '../../common/EIP712/RelayRequest'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayMaxNonce: number
  signature: PrefixedHexString
  maxTime: number
}

export interface RelayTransactionRequest {
  relayRequest: RelayRequest
  metadata: RelayMetadata
}

export const RelayTransactionRequestShape = {
  relayRequest: {
    request: {
      from: ow.string,
      to: ow.string,
      data: ow.string,
      value: ow.string,
      nonce: ow.string,
      gas: ow.string,
      tokenRecipient: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string,
      factory: ow.string, // only set if this is a deploy request
      recoverer: ow.string, // only used if factory is set
      index: ow.string // only used if factory is set
    },
    relayData: {
      gasPrice: ow.string,
      pctRelayFee: ow.string,
      baseRelayFee: ow.string,
      relayWorker: ow.string,
      paymaster: ow.string,
      paymasterData: ow.string,
      clientId: ow.string,
      forwarder: ow.string
    }
  },
  metadata: {
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
    maxTime: ow.number
  }
}

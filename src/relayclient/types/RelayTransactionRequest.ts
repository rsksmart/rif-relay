import { PrefixedHexString } from 'ethereumjs-tx'
import ow from 'ow'

import { Address } from './Aliases'
import { DeployRequest, RelayRequest } from '../../common/EIP712/RelayRequest'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayMaxNonce: number
  signature: PrefixedHexString
}

export interface RelayTransactionRequest {
  relayRequest: RelayRequest
  metadata: RelayMetadata
}

export interface DeployTransactionRequest {
  relayRequest: DeployRequest
  metadata: RelayMetadata
}
export const DeployTransactionRequestShape = {
  relayRequest: {
    request: {
      from: ow.string,
      to: ow.string,
      value: ow.string,
      gas: ow.string,
      nonce: ow.string,
      data: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string,
      recoverer: ow.string,
      index: ow.string
    },
    relayData: {
      gasPrice: ow.string,
      domainSeparator: ow.string,
      relayWorker: ow.string,
      callForwarder: ow.string,
      callVerifier: ow.string
    }
  },
  metadata: {
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string
  }
}

export const RelayTransactionRequestShape = {
  relayRequest: {
    request: {
      from: ow.string,
      to: ow.string,
      value: ow.string,
      gas: ow.string,
      nonce: ow.string,
      data: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string
    },
    relayData: {
      gasPrice: ow.string,
      domainSeparator: ow.string,
      relayWorker: ow.string,
      callForwarder: ow.string,
      callVerifier: ow.string
    }
  },
  metadata: {
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string
  }
}

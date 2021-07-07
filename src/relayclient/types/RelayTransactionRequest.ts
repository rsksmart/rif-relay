import { PrefixedHexString } from 'ethereumjs-tx'
import ow from 'ow'

import { Address } from './Aliases'
import { DeployRequest, RelayRequest } from '../../common/EIP712/RelayRequest'

export interface RelayMetadata {
  relayHubAddress: Address
  relayMaxNonce: number
  signature: PrefixedHexString
  maxTime: number
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
      relayHub: ow.string,
      from: ow.string,
      to: ow.string,
      value: ow.string,
      nonce: ow.string,
      data: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string,
      tokenGas: ow.string,
      enableQos: ow.boolean,
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
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
    maxTime: ow.number
  }
}

export const RelayTransactionRequestShape = {
  relayRequest: {
    request: {
      relayHub: ow.string,
      from: ow.string,
      to: ow.string,
      value: ow.string,
      gas: ow.string,
      nonce: ow.string,
      data: ow.string,
      tokenContract: ow.string,
      tokenAmount: ow.string,
      tokenGas: ow.string,
      enableQos: ow.boolean
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
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
    maxTime: ow.number
  }
}

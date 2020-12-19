import { Address } from '../../relayclient/types/Aliases'
import RelayRequest from './RelayRequest'
import { EIP712Domain, EIP712TypedData, EIP712TypeProperty, EIP712Types, TypedDataUtils } from 'eth-sig-util'

import { bufferToHex } from 'ethereumjs-util'
import { PrefixedHexString } from 'ethereumjs-tx'

require('source-map-support').install({ errorFormatterForce: true })

export const EIP712DomainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const RelayDataType = [
  { name: 'gasPrice', type: 'uint256' },
  { name: 'domainSeparator', type: 'bytes32' },
  { name: 'isSmartWalletDeploy', type: 'bool' },
  { name: 'relayWorker', type: 'address' },
  { name: 'callForwarder', type: 'address' },
  { name: 'callVerifier', type: 'address' }
]

export const ForwardRequestType = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'gas', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'data', type: 'bytes' },
  { name: 'tokenContract', type: 'address' },
  { name: 'tokenAmount', type: 'uint256' },
  { name: 'recoverer', type: 'address' },
  { name: 'index', type: 'uint256' }
]

const RelayRequestType = [
  ...ForwardRequestType,
  { name: 'relayData', type: 'RelayData' }
]

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  RelayRequest: EIP712TypeProperty[]
  RelayData: EIP712TypeProperty[]
}

// use these values in registerDomainSeparator
export const GsnDomainSeparatorType = {
  prefix: 'string name,string version',
  name: 'RSK Enveloping Transaction',
  version: '2'
}

export function getDomainSeparator (verifier: Address, chainId: number): EIP712Domain {
  return {
    name: GsnDomainSeparatorType.name,
    version: GsnDomainSeparatorType.version,
    chainId: chainId,
    verifyingContract: verifier
  }
}

export function getDomainSeparatorHash (verifier: Address, chainId: number): PrefixedHexString {
  return bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', getDomainSeparator(verifier, chainId), { EIP712Domain: EIP712DomainType }))
}

export default class TypedRequestData implements EIP712TypedData {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: any

  constructor (
    chainId: number,
    verifier: Address,
    relayRequest: RelayRequest) {
    this.types = {
      EIP712Domain: EIP712DomainType,
      RelayRequest: RelayRequestType,
      RelayData: RelayDataType
    }
    this.domain = getDomainSeparator(verifier, chainId)
    this.primaryType = 'RelayRequest'
    // in the signature, all "request" fields are flattened out at the top structure.
    // other params are inside "relayData" sub-type
    this.message = {
      ...relayRequest.request,
      relayData: relayRequest.relayData
    }
  }
}

export const ENVELOPING_PARAMS = 'address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenContract,uint256 tokenAmount,address recoverer,uint256 index'

export const GsnRequestType = {
  typeName: 'RelayRequest',
  typeSuffix: 'RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)'
}

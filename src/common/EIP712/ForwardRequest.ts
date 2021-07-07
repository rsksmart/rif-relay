import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export interface ForwardRequest {
  relayHub: Address
  from: Address
  to: Address
  tokenContract: Address
  value: IntString
  gas: IntString
  nonce: IntString
  tokenAmount: IntString
  tokenGas: IntString
  enableQos: boolean
  data: PrefixedHexString
}

export interface DeployRequestStruct {
  relayHub: Address
  from: Address
  to: Address
  tokenContract: Address
  recoverer: Address
  value: IntString
  nonce: IntString
  tokenAmount: IntString
  tokenGas: IntString
  enableQos: boolean
  index: IntString
  data: PrefixedHexString
}

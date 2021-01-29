import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export interface ForwardRequest {
  relayHub: Address
  from: Address
  to: Address
  value: IntString
  gas: IntString
  nonce: IntString
  data: PrefixedHexString
  tokenContract: Address
  tokenAmount: IntString
}

export interface DeployRequestStruct {
  relayHub: Address
  from: Address
  to: Address
  value: IntString
  gas: IntString
  nonce: IntString
  data: PrefixedHexString
  tokenContract: Address
  tokenAmount: IntString
  recoverer: Address
  index: IntString

}

import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface ForwardRequest {
  from: Address
  to: Address
  data: PrefixedHexString
  value: IntString
  nonce: IntString
  gas: IntString
  tokenRecipient: Address
  tokenContract: Address
  tokenAmount: IntString
  factory: Address // only set if this is a deploy request
}

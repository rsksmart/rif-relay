import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface ForwardRequest {
  from: Address
  to: Address
  value: IntString
  gas: IntString
  nonce: IntString
  data: PrefixedHexString
  tokenRecipient: Address
  tokenContract: Address
  tokenAmount: IntString
  recoverer: Address // only used if factory is set
  index: IntString // only used if factory is set
}

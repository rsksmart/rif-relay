import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface SmartWalletForwardRequest {
  from: Address
  to: Address
  value: IntString
  gas: IntString
  nonce: IntString
  data: PrefixedHexString
  tokenRecipient: Address
  tokenContract: Address
  tokenAmount: IntString
  factory: Address
}

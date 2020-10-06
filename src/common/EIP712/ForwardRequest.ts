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
  paybackTokens: IntString
  tokenGas: IntString
  isDeploy: boolean
}

import { PrefixedHexString } from 'ethereumjs-tx'
import { Address, IntString } from './Aliases'

export default interface TmpRelayTransactionJsonRequest {
  relayWorker: Address
  data: PrefixedHexString
  signature: PrefixedHexString
  from: Address
  to: Address
  value: IntString
  callVerifier: Address
  clientId: IntString
  callForwarder: Address
  gasPrice: IntString
  gasLimit: IntString
  senderNonce: IntString
  relayMaxNonce: number
  baseRelayFee: IntString
  pctRelayFee: IntString
  relayHubAddress: Address
}

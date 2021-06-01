import { Address, IntString, PrefixedHexString } from './Aliases'

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
  relayHubAddress: Address
}

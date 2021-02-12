import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface RelayData {
  gasPrice: IntString
  domainSeparator: PrefixedHexString
  relayWorker: Address
  callForwarder: Address
  callVerifier: Address
}

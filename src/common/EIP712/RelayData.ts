import { Address, IntString, PrefixedHexString } from '../../relayclient/types/Aliases'

export default interface RelayData {
  gasPrice: IntString
  domainSeparator: PrefixedHexString
  relayWorker: Address
  callForwarder: Address
  callVerifier: Address
}

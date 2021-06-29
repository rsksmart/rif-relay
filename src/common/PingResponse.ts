import { Address, IntString } from '../relayclient/types/Aliases'

export default interface PingResponse {
  relayWorkerAddress: Address
  relayManagerAddress: Address
  relayHubAddress: Address
  minGasPrice: IntString
  maxDelay: number
  networkId?: IntString
  chainId?: IntString
  ready: boolean
  version: string
}

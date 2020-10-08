import RelayData from './RelayData'
import SmartWalletForwardRequest from './SmartWallerForwardRequest'

export default interface EnvelopingRequest {
  request: SmartWalletForwardRequest
  relayData: RelayData
}

export function cloneRelayRequest (relayRequest: EnvelopingRequest): EnvelopingRequest {
  return {
    request: { ...relayRequest.request },
    relayData: { ...relayRequest.relayData }
  }
}

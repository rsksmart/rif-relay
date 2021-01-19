import RelayData from './RelayData'
import { ForwardRequest, DeployRequestStruct } from './ForwardRequest'

export interface RelayRequest {
  request: ForwardRequest
  relayData: RelayData
}

export interface DeployRequest {
  request: DeployRequestStruct
  relayData: RelayData
}

export function cloneRelayRequest (relayRequest: RelayRequest | DeployRequest): RelayRequest|DeployRequest {
  return {
    request: { ...relayRequest.request },
    relayData: { ...relayRequest.relayData }
  }
}

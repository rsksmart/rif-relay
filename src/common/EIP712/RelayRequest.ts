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

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    request: { ...relayRequest.request },
    relayData: { ...relayRequest.relayData }
  }
}

export function cloneDeployRequest (deployRequest: DeployRequest): DeployRequest {
  return {
    request: { ...deployRequest.request },
    relayData: { ...deployRequest.relayData }
  }
}

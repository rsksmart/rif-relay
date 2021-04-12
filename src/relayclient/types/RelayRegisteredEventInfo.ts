import { Address } from './Aliases'

export interface RelayInfoUrl {
  relayUrl: string
}

export interface RelayRegisteredEventInfo extends RelayInfoUrl {
  relayManager: Address
}

export function isInfoFromEvent (info: RelayInfoUrl): boolean {
  return 'relayManager' in info
}

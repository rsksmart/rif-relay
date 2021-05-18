import { Address } from '../relayclient/types/Aliases'

export default interface TokenResponse {
  allowedTokens: {
    deployVerifier: Address[],
    relayVerifier: Address[]
  }
}
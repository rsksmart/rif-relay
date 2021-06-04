// The equivalent of a Map<Address, Address[]>,
// where keys are verifier addresses, and values are list of allowed token addresses.
// This interface was coded this way since so that the HTTP Server can use it as a response.
export default interface TokenResponse {
  [verifier: string]: string[]
}

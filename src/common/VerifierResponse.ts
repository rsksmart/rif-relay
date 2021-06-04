import { Address } from '../relayclient/types/Aliases'

export default interface VerifierResponse {
  trustedVerifiers: Address[]
}

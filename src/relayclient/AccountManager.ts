import { Address } from './types/Aliases'
export interface AccountKeypair {
  privateKey: Uint8Array
  address: Address
}

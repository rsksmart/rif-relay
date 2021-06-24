import { Address, IntString, PrefixedHexString } from './Aliases'

export default interface EnvelopingTransactionDetails {
  // Added by the Web3 call stack:
  readonly from: Address
  readonly data: PrefixedHexString
  readonly to: Address
  readonly tokenContract?: Address
  readonly tokenAmount?: IntString
  tokenGas?: IntString
  readonly recoverer?: Address
  readonly index?: IntString
  readonly value?: IntString

  /**
   * TODO: this is horrible. Think about it some more
   * Do not set this value manually as this value will be overwritten. Use {@link forceGasPrice} instead.
   */
  gas?: PrefixedHexString
  gasPrice?: PrefixedHexString

  // Required parameters for Enveloping, but assigned later
  readonly relayHub?: Address
  readonly callForwarder?: Address
  readonly callVerifier?: Address
  readonly isSmartWalletDeploy?: boolean
  smartWalletAddress?: Address

  readonly clientId?: IntString

  // Optional parameters for RelayProvider only:
  /**
   * Set to 'false' to create a direct transaction
   */
  readonly useEnveloping?: boolean

  /**
   * Use this to force the {@link RelayClient} to use provided gas price instead of calculated one.
   */
  readonly forceGasPrice?: PrefixedHexString

  /**
   * Use this to force the RelayClient to use only the preferred relays when searching for a suitable relay server
   */
  readonly onlyPreferredRelays?: boolean

  retries?: number
  initialBackoff?: number
}

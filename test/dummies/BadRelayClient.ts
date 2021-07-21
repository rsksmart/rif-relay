import { RelayClient, RelayingResult } from '@rsksmart/rif-relay-client'
import {
  EnvelopingTransactionDetails,
  EnvelopingConfig
} from '@rsksmart/rif-relay-common'
import { HttpProvider } from 'web3-core'

export default class BadRelayClient extends RelayClient {
  static readonly message = 'This is not the transaction you are looking for'

  private readonly failRelay: boolean
  private readonly returnUndefindedTransaction: boolean

  constructor (
    failRelay: boolean,
    returnNullTransaction: boolean,
    provider: HttpProvider,
    config: EnvelopingConfig
  ) {
    super(provider, config)
    this.failRelay = failRelay
    this.returnUndefindedTransaction = returnNullTransaction
  }

  async relayTransaction (transactionDetails: EnvelopingTransactionDetails): Promise<RelayingResult> {
    if (this.failRelay) {
      throw new Error(BadRelayClient.message)
    }
    if (this.returnUndefindedTransaction) {
      return {
        transaction: undefined,
        pingErrors: new Map<string, Error>(),
        relayingErrors: new Map<string, Error>()
      }
    }
    return await super.relayTransaction(transactionDetails)
  }
}

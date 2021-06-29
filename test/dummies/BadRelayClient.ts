import { RelayClient, RelayingResult } from '../../src/relayclient/RelayClient'
import EnvelopingTransactionDetails from '../../src/relayclient/types/EnvelopingTransactionDetails'
import { EnvelopingConfig } from '../../src/relayclient/Configurator'
import { providers } from 'ethers'

export default class BadRelayClient extends RelayClient {
  static readonly message = 'This is not the transaction you are looking for'

  private readonly failRelay: boolean
  private readonly returnUndefindedTransaction: boolean

  constructor (
    failRelay: boolean,
    returnNullTransaction: boolean,
    provider: providers.JsonRpcProvider,
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

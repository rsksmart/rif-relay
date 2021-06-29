import RelayedTransactionValidator from '../../src/relayclient/RelayedTransactionValidator'
import ContractInteractor from '../../src/common/ContractInteractor'
import { EnvelopingConfig } from '../../src/relayclient/Configurator'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'

export default class BadRelayedTransactionValidator extends RelayedTransactionValidator {
  private readonly failValidation: boolean

  constructor (failValidation: boolean, contractInteractor: ContractInteractor, config: EnvelopingConfig) {
    super(contractInteractor, config)
    this.failValidation = failValidation
  }

  async validateRelayResponse (transactionJsonRequest: RelayTransactionRequest, returnedTx: string): Promise<boolean> {
    if (this.failValidation) {
      return false
    }
    return await super.validateRelayResponse(transactionJsonRequest, returnedTx)
  }
}

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

  validateRelayResponse (transactionJsonRequest: RelayTransactionRequest, maxAcceptanceBudget: number, returnedTx: string): boolean {
    if (this.failValidation) {
      return false
    }
    return super.validateRelayResponse(transactionJsonRequest, maxAcceptanceBudget, returnedTx)
  }
}

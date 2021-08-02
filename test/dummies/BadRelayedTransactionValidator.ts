import { RelayedTransactionValidator } from '@rsksmart/rif-relay-client';
import {
    ContractInteractor,
    EnvelopingConfig,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';

export default class BadRelayedTransactionValidator extends RelayedTransactionValidator {
    private readonly failValidation: boolean;

    constructor(
        failValidation: boolean,
        contractInteractor: ContractInteractor,
        config: EnvelopingConfig
    ) {
        super(contractInteractor, config);
        this.failValidation = failValidation;
    }

    validateRelayResponse(
        transactionJsonRequest: RelayTransactionRequest,
        returnedTx: string
    ): boolean {
        if (this.failValidation) {
            return false;
        }
        return super.validateRelayResponse(transactionJsonRequest, returnedTx);
    }
}

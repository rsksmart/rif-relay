import {
    ContractInteractor,
    Web3Provider,
    EnvelopingConfig
} from '@rsksmart/rif-relay-common';
import { RelayRequest } from '@rsksmart/rif-relay-contracts';
import { TransactionReceipt } from 'web3-core';

export default class BadContractInteractor extends ContractInteractor {
    static readonly message = 'This is not the contract you are looking for';
    static readonly wrongNonceMessage = "the tx doesn't have the correct nonce";

    private readonly failValidateARC: boolean;

    constructor(
        provider: Web3Provider,
        config: EnvelopingConfig,
        failValidateARC: boolean
    ) {
        super(provider, config);
        this.failValidateARC = failValidateARC;
    }

    async validateAcceptRelayCall(
        relayRequest: RelayRequest,
        signature: string,
        workerAddress: string
    ): Promise<{
        verifierAccepted: boolean;
        returnValue: string;
        reverted: boolean;
        revertedInDestination: boolean;
    }> {
        if (this.failValidateARC) {
            return {
                verifierAccepted: false,
                reverted: true,
                returnValue: BadContractInteractor.message,
                revertedInDestination: false
            };
        }
        return await super.validateAcceptRelayCall(
            relayRequest,
            signature,
            workerAddress
        );
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async sendSignedTransaction(rawTx: string): Promise<TransactionReceipt> {
        console.debug('rawTx', rawTx);
        throw new Error(BadContractInteractor.wrongNonceMessage);
    }
}

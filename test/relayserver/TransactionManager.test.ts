import { KeyManager, ServerDependencies, StoredTransaction, TransactionManager, TxStoreManager } from "@rsksmart/rif-relay-server";
import { expect, use } from 'chai';
import { BigNumber, PopulatedTransaction } from "ethers";
import fs from 'fs/promises';
import sinon from "sinon";
import sinonChai from 'sinon-chai';

use(sinonChai);

describe('TransactionManager', function () {
    const workdir = '/tmp/env-test';
    let txManager: TransactionManager;
    let workersKeyManager: KeyManager;
    let workerAddress: string;

    beforeEach(async function () {
        const managerKeyManager = new KeyManager(1, workdir);
        workersKeyManager = new KeyManager(1, workdir);
        workerAddress = workersKeyManager.getAddress(0)!;
        const txStoreManager = new TxStoreManager({ workdir })
        const dependencies: ServerDependencies = {
            managerKeyManager,
            workersKeyManager,
            txStoreManager
        };
        await txStoreManager.putTx({
            txId: 'id1',
            attempts: 1,
            nonce: 1,
            creationBlockNumber: 0,
            gasLimit: BigNumber.from(1),
            gasPrice: BigNumber.from(1),
            nonceSigner: {
                nonce: 1,
                signer: workerAddress
            },
            from: workerAddress
        } as StoredTransaction);
        await txStoreManager.putTx({
            txId: 'id2',
            attempts: 1,
            nonce: 2,
            creationBlockNumber: 0,
            gasLimit: BigNumber.from(1),
            gasPrice: BigNumber.from(2),
            nonceSigner: {
                nonce: 2,
                signer: workerAddress
            },
            from: workerAddress
        } as StoredTransaction);

        txManager = new TransactionManager(dependencies);
    })

    it('should boost underpriced pending transactions for a given signer', async function () {
        const currentBlockHeight = 100;
        sinon.stub(txManager, '_resolveNewGasPrice').returns({
            isMaxGasPriceReached: false,
            newGasPrice: BigNumber.from(3)
        });
        const resendTransactionStub = sinon.stub(txManager, "resendTransaction").callsFake(async (
            tx: StoredTransaction,
            _: number,
            newGasPrice: BigNumber,
            __: boolean) => {
            const {
                to,
                from,
                nonce,
                gasLimit,
            } = tx
            const txToSign: PopulatedTransaction = {
                to,
                from,
                nonce,
                gasLimit,
                gasPrice: newGasPrice,
            };
            const signedTransaction = await workersKeyManager.signTransaction(
                tx.from,
                txToSign
            );
            
            return signedTransaction;
        })

        const boostedTransactions = await txManager.boostUnderpricedPendingTransactionsForSigner(workerAddress, currentBlockHeight);

        expect(resendTransactionStub).to.have.been.callCount(2);
        expect(boostedTransactions.size).to.be.eql(2);
    });

    afterEach(async function () {
        await fs.rm(workdir, { recursive: true, force: true });
    })
});

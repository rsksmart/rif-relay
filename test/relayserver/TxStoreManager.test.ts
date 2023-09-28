import { expect } from 'chai';
import {
  KeyManager,
  StoredTransaction,
  TxStoreManager,
} from '@rsksmart/rif-relay-server';
import { BigNumber } from 'ethers';
import fs from 'fs/promises';

const bn = BigNumber.from(1);
const bigNumberProperties = Object.getOwnPropertyNames(bn);
const isBigNumber = (value: any) =>
  bigNumberProperties.every((prop) => prop in value);

describe('TxStoreManager', function () {
  const workdir = '/tmp/env-test';
  it('should return transactions with gasLimit and gasPrice as BigNumber', async function () {
    const workersKeyManager = new KeyManager(1, workdir);
    const workerAddress = workersKeyManager.getAddress(0)!;
    const txStoreManager = new TxStoreManager({ workdir });
    await txStoreManager.putTx({
      txId: 'id1',
      attempts: 1,
      nonce: 1,
      creationBlockNumber: 0,
      gasLimit: BigNumber.from(1),
      gasPrice: BigNumber.from(1),
      nonceSigner: {
        nonce: 1,
        signer: workerAddress,
      },
      from: workerAddress,
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
        signer: workerAddress,
      },
      from: workerAddress,
    } as StoredTransaction);

    const txs = await txStoreManager.getAllBySigner(workerAddress);

    const txExpectation = ({ gasPrice, gasLimit }: StoredTransaction) =>
      isBigNumber(gasPrice) && isBigNumber(gasLimit);

    expect(
      txs.every(txExpectation),
      'the objects returned do not have gasPrice and gasLimit as BigNumber'
    ).to.be.true;
  });

  afterEach(async function () {
    await fs.rm(workdir, { recursive: true, force: true });
  });
});

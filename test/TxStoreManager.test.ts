import { fail } from 'assert'
import { expect } from 'chai'
import fs from 'fs'

import { ServerAction, StoredTransaction } from '../src/relayserver/StoredTransaction'
import { TXSTORE_FILENAME, TxStoreManager } from '../src/relayserver/TxStoreManager'

// NOTICE: this dir is removed in 'after', do not use this in any other test
const workdir = '/tmp/enveloping/test/txstore_manager'
const txStoreFilePath = `${workdir}/${TXSTORE_FILENAME}`

function cleanFolder (): void {
  if (fs.existsSync(txStoreFilePath)) {
    fs.unlinkSync(txStoreFilePath)
  }
  if (fs.existsSync(workdir)) {
    fs.rmdirSync(workdir)
  }
}

describe('TxStoreManager', () => {
  let txmanager: TxStoreManager
  let tx: StoredTransaction
  let tx2: StoredTransaction
  let tx3: StoredTransaction

  before('create txstore', async function () {
    cleanFolder()
    txmanager = new TxStoreManager({ workdir })
    await txmanager.clearAll()
    expect(txmanager).to.be.ok //('txstore uninitialized' + txmanager.toString())
    expect(fs.existsSync(workdir)).to.be.equal(true, 'test txstore dir should exist already')
    tx = {
      from: '',
      to: '',
      gas: 0,
      gasPrice: 0,
      data: '',
      nonce: 111,
      txId: '123456',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlockNumber: 0,
      minedBlockNumber: 0,
      attempts: 1
    }
    tx2 = {
      from: '',
      to: '',
      gas: 0,
      gasPrice: 0,
      data: '',
      nonce: 112,
      txId: '1234567',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlockNumber: 0,
      minedBlockNumber: 0,
      attempts: 1
    }
    tx3 =
      {
        from: '',
        to: '',
        gas: 0,
        gasPrice: 0,
        data: '',
        nonce: 113,
        txId: '12345678',
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        minedBlockNumber: 0,
        attempts: 1
      }
  })

  it('should store and get tx by txId', async function () {
    expect(await txmanager.getTxById(tx.txId)).to.be.null
    await txmanager.putTx(tx)
    const txById = await txmanager.getTxById(tx.txId)
    expect(tx.txId).to.be.equal(txById.txId)
    expect(tx.attempts).to.be.equal(txById.attempts)
  })

  it('should get tx by nonce', async function () {
    expect(await txmanager.getTxByNonce(tx.from, tx.nonce + 1234)).to.be.null
    const txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    expect(tx.txId).to.be.equal(txByNonce.txId)
  })

  it('should remove txs until nonce', async function () {
    await txmanager.putTx(tx2)
    await txmanager.putTx(tx3)
    let txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    expect(tx.txId).to.be.equal(txByNonce.txId)
    let tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    expect(tx2.txId).to.be.equal(tx2ByNonce.txId)
    let tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    expect(tx3.txId).to.be.equal(tx3ByNonce.txId)
    expect(3).to.be.deep.equal((await txmanager.getAll()).length)
    await txmanager.removeTxsUntilNonce(tx.from, tx2.nonce)
    txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    expect(txByNonce).to.be.null
    tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    expect(tx2ByNonce).to.be.null
    tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    expect(tx3.txId).to.be.equal(tx3ByNonce.txId)
    expect(1).to.be.deep.equal((await txmanager.getAll()).length)
})

  it('should clear txstore', async function () {
    await txmanager.putTx(tx, true)
    await txmanager.putTx(tx2, true)
    await txmanager.putTx(tx3, true)
    await txmanager.clearAll()
    expect([]).to.be.deep.equal(await txmanager.getAll())
  })

  it('should NOT store tx twice', async function () {
    await txmanager.clearAll()
    await txmanager.putTx(tx)
    await txmanager.putTx(tx, true)
    expect(1).to.be.deep.equal((await txmanager.getAll()).length)
    try {
      await txmanager.putTx(tx, false)
      fail('should fail storing twice')
    } catch (e) {
      expect(e.message).to.include('violates the unique constraint')
    }
    expect(1).to.be.deep.equal((await txmanager.getAll()).length)
  })

  after('remove txstore', cleanFolder)
})

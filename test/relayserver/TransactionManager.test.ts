import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import Mutex from 'async-mutex/lib/Mutex'
import * as ethUtils from 'ethereumjs-util'

import { evmMineMany, getTestingEnvironment } from '../TestUtils'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { HttpProvider } from 'web3-core'
import { ServerTestEnvironment } from './ServerTestEnvironment'

contract('TransactionManager', function (accounts) {
  const pendingTransactionTimeoutBlocks = 5
  const confirmationsNeeded = 12
  let relayServer: RelayServer
  let env: ServerTestEnvironment

  before(async function () {
    const chainId = (await getTestingEnvironment()).chainId
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({ chainId })
    await env.newServerInstance({
      pendingTransactionTimeoutBlocks,
      workerTargetBalance: 0.6e18
    })
    relayServer = env.relayServer
  })

  describe('nonce counter asynchronous access protection', function () {
    let _pollNonceOrig: (signer: string) => Promise<number>
    let nonceMutexOrig: Mutex
    let signTransactionOrig: (signer: string, tx: Transaction) => PrefixedHexString
    before(function () {
      _pollNonceOrig = relayServer.transactionManager.pollNonce
      relayServer.transactionManager.pollNonce = async function (signer) {
        return await this.contractInteractor.getTransactionCount(signer, 'pending')
      }
    })
    after(function () {
      relayServer.transactionManager.pollNonce = _pollNonceOrig
    })

    it('should not deadlock if server returned error while locked', async function () {
      try {
        signTransactionOrig = relayServer.transactionManager.workersKeyManager.signTransaction
        relayServer.transactionManager.workersKeyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await env.relayTransaction()
        } catch (e) {
          assert.include(e.message, 'no tx for you')
          assert.isFalse(relayServer.transactionManager.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        relayServer.transactionManager.workersKeyManager.signTransaction = signTransactionOrig
      }
    })
  })

  describe('local storage maintenance', function () {
    let parsedTxHash: PrefixedHexString
    let latestBlock: number

    before(async function () {
      await relayServer.transactionManager.txStoreManager.clearAll()
      relayServer.transactionManager._initNonces()
      const { signedTx } = await env.relayTransaction()
      parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx, relayServer.transactionManager.rawTxOptions)).hash())
      latestBlock = (await env.web3.eth.getBlock('latest')).number
    })

    it('should remove confirmed transactions from the recent transactions storage', async function () {
      await relayServer.transactionManager.removeConfirmedTransactions(latestBlock)
      let storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(storedTransactions[0].txId, parsedTxHash)
      await evmMineMany(confirmationsNeeded)
      const newLatestBlock = await env.web3.eth.getBlock('latest')
      await relayServer.transactionManager.removeConfirmedTransactions(newLatestBlock.number)
      storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      assert.deepEqual([], storedTransactions)
    })
  })
})

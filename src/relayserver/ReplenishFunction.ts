import { PrefixedHexString } from 'ethereumjs-tx/dist/types'
import { toBN, toHex } from 'web3-utils'
import {
  defaultEnvironment
} from '@rsksmart/rif-relay-common'
import { RelayServer } from './RelayServer'
import { ServerAction } from './StoredTransaction'
import { SendTransactionDetails } from './TransactionManager'

export async function replenishStrategy (relayServer: RelayServer, workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]> {
  let transactionHashes: PrefixedHexString[] = []
  if (relayServer.isCustomReplenish()) {
    // If custom replenish is settled, here should be a call to a custom function for replenish workers strategy.
    // Delete the next error if a custom replenish fuction is implemented.
    throw new Error('No custom replenish function found, to remove this error please add the custom replenish implementation here deleting this line.')
  } else {
    transactionHashes = await defaultReplenishFunction(relayServer, workerIndex, currentBlock)
  }

  return transactionHashes
}

async function defaultReplenishFunction (relayServer: RelayServer, workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]> {
  const transactionHashes: PrefixedHexString[] = []
  let managerEthBalance = await relayServer.getManagerBalance()
  relayServer.workerBalanceRequired.currentValue = await relayServer.getWorkerBalance(workerIndex)
  if (managerEthBalance.gte(toBN(relayServer.config.managerTargetBalance.toString())) && relayServer.workerBalanceRequired.isSatisfied) {
    // all filled, nothing to do
    return transactionHashes
  }
  managerEthBalance = await relayServer.getManagerBalance()
  const mustReplenishWorker = !relayServer.workerBalanceRequired.isSatisfied
  const isReplenishPendingForWorker = await relayServer.txStoreManager.isActionPending(ServerAction.VALUE_TRANSFER, relayServer.workerAddress)
  if (mustReplenishWorker && !isReplenishPendingForWorker) {
    const refill = toBN(relayServer.config.workerTargetBalance.toString()).sub(relayServer.workerBalanceRequired.currentValue)
    console.log(
      `== replenishServer: mgr balance=${managerEthBalance.toString()}
        \n${relayServer.workerBalanceRequired.description}\n refill=${refill.toString()}`)

    if (refill.lt(managerEthBalance.sub(toBN(relayServer.config.managerMinBalance)))) {
      console.log('Replenishing worker balance by manager rbtc balance')
      const details: SendTransactionDetails = {
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: relayServer.workerAddress,
        value: toHex(refill),
        creationBlockNumber: currentBlock,
        gasLimit: defaultEnvironment.mintxgascost
      }
      const { transactionHash } = await relayServer.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      const message = `== replenishServer: can't replenish: mgr balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`
      relayServer.emit('fundingNeeded', message)
      console.log(message)
    }
  }
  return transactionHashes
}

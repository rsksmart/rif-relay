// TODO: convert to 'commander' format
import fs from 'fs'
import Web3 from 'web3'
import { HttpServer } from './HttpServer'
import { RelayServer } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TxStoreManager, TXSTORE_FILENAME } from './TxStoreManager'
import ContractInteractor from '../relayclient/ContractInteractor'
import { configureGSN } from '../relayclient/GSNConfigurator'
import { parseServerConfig, resolveServerConfig, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import { PrefixedHexString } from 'ethereumjs-tx'
import { SendTransactionDetails } from './TransactionManager'
import { toBN, toHex } from 'web3-utils'
import { ServerAction } from './StoredTransaction'
import { defaultEnvironment } from '../common/Environments'

function error (err: string): never {
  console.error(err)
  process.exit(1)
}

async function run (): Promise<void> {
  let config: ServerConfigParams
  let web3provider
  let trustedVerifiers: string[] = []
  console.log('Starting GSN Relay Server process...\n')
  try {
    const conf = await parseServerConfig(process.argv.slice(2), process.env)
    console.log(conf)
    if (conf.rskNodeUrl == null) {
      error('missing rskNodeUrl')
    }
    if (conf.trustedVerifiers !== undefined && conf.trustedVerifiers != null && conf.trustedVerifiers !== '') {
      trustedVerifiers = JSON.parse(conf.trustedVerifiers)
    }

    web3provider = new Web3.providers.HttpProvider(conf.ethereumNodeUrl)
    config = await resolveServerConfig(conf, web3provider) as ServerConfigParams
    if (trustedVerifiers.length > 0) {
      config.trustedVerifiers = trustedVerifiers
    }
  } catch (e) {
    error(e.message)
  }
  const { devMode, workdir } = config
  if (devMode) {
    if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
    }
  }

  const managerKeyManager = new KeyManager(1, workdir + '/manager')
  const workersKeyManager = new KeyManager(1, workdir + '/workers')
  const txStoreManager = new TxStoreManager({ workdir })
  const contractInteractor = new ContractInteractor(web3provider, configureGSN({
    relayHubAddress: config.relayHubAddress,
    deployVerifierAddress: config.deployVerifierAddress,
    relayVerifierAddress: config.relayVerifierAddress
  }))
  await contractInteractor.init()

  const dependencies: ServerDependencies = {
    txStoreManager,
    managerKeyManager,
    workersKeyManager,
    contractInteractor
  }

  const replenishFunction: (relayServer: RelayServer, workerIndex: number, currentBlock: number) => Promise<PrefixedHexString[]> = async (relayServer: RelayServer, workerIndex: number, currentBlock: number) => {
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

  const relayServer = new RelayServer(config, dependencies, devMode ? replenishFunction : undefined)
  await relayServer.init()
  const httpServer = new HttpServer(config.port, relayServer)
  httpServer.start()
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()

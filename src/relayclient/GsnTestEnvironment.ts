import net from 'net'
import { ether } from '@openzeppelin/test-helpers'

import CommandsLogic, { DeploymentResult } from '../cli/CommandsLogic'
import { KeyManager } from '../relayserver/KeyManager'

import { configureGSN } from './GSNConfigurator'
import { getNetworkUrl, supportedNetworks } from '../cli/utils'
import { TxStoreManager } from '../relayserver/TxStoreManager'
import { RelayServer } from '../relayserver/RelayServer'
import { HttpServer } from '../relayserver/HttpServer'
import { Address } from './types/Aliases'
import { RelayProvider } from './RelayProvider'
import Web3 from 'web3'
import ContractInteractor from './ContractInteractor'
import { Environment, defaultEnvironment } from '../common/Environments'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'
import { PrefixedHexString } from 'ethereumjs-tx'
import { toBN, toHex } from 'web3-utils'
import { ServerAction } from '../relayserver/StoredTransaction'
import { SendTransactionDetails } from '../relayserver/TransactionManager'

export interface TestEnvironment {
  deploymentResult: DeploymentResult
  relayProvider: RelayProvider
  httpServer: HttpServer
  relayUrl: string
}

class GsnTestEnvironmentClass {
  private httpServer?: HttpServer

  /**
   *
   * @param host:
   * @param debug
   * @return
   */
  async startGsn (host?: string, environment = defaultEnvironment): Promise<TestEnvironment> {
    await this.stopGsn()
    const _host: string = getNetworkUrl(host)
    console.log('_host=', _host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    const commandsLogic = new CommandsLogic(_host, configureGSN({ chainId: environment.chainId }))
    const from = await commandsLogic.findWealthyAccount()
    const deploymentResult = await commandsLogic.deployGsnContracts({
      from,
      gasPrice: '1',
      skipConfirmation: true,
      relayHubConfiguration: environment.relayHubConfiguration
    })

    const port = await this._resolveAvailablePort()
    const relayUrl = 'http://127.0.0.1:' + port.toString()

    await this._runServer(_host, deploymentResult, from, relayUrl, port, this.defaultReplenishFunction)
    if (this.httpServer == null) {
      throw new Error('Failed to run a local Relay Server')
    }

    const registerOptions = {
      from,
      stake: ether('1'),
      funds: ether('1'),
      relayUrl: relayUrl,
      gasPrice: '1e9',
      unstakeDelay: '2000'
    }
    const registrationResult = await commandsLogic.registerRelay(registerOptions)
    if (registrationResult.success) {
      console.log('In-process relay successfully registered:', JSON.stringify(registrationResult))
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to fund relay: ${registrationResult.error} : ${registrationResult?.transactions?.toString()}`)
    }

    await commandsLogic.waitForRelay(relayUrl)

    const config = configureGSN({
      relayHubAddress: deploymentResult.relayHubAddress,
      relayVerifierAddress: deploymentResult.relayVerifierAddress,
      deployVerifierAddress: deploymentResult.deployVerifierAddress,
      preferredRelays: [relayUrl],
      chainId: environment.chainId
    })

    const relayProvider = new RelayProvider(new Web3.providers.HttpProvider(_host), config)
    console.error('== startGSN: ready.')
    return {
      deploymentResult,
      relayProvider,
      relayUrl,
      httpServer: this.httpServer
    }
  }

  /**
   * initialize a local relay
   * @private
   */

  private async _resolveAvailablePort (): Promise<number> {
    const server = net.createServer()
    await new Promise(resolve => {
      server.listen(0, resolve)
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Could not find available port')
    }
    const relayListenPort = address.port
    server.close()
    return relayListenPort
  }

  async stopGsn (): Promise<void> {
    if (this.httpServer !== undefined) {
      this.httpServer.stop()
      this.httpServer.close()
      await this.httpServer.backend.transactionManager.txStoreManager.clearAll()
      this.httpServer = undefined
    }
  }

  async defaultReplenishFunction (relayServer: RelayServer, workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]> {
    const transactionHashes: PrefixedHexString[] = []

    if (relayServer === undefined || relayServer === null) {
      return transactionHashes
    }

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

  async _runServer (
    host: string,
    deploymentResult: DeploymentResult,
    from: Address,
    relayUrl: string,
    port: number,
    replenishStrategy?: (relayServer: RelayServer, workerIndex: number, currentBlock: number) => Promise<PrefixedHexString[]>,
    environment: Environment = defaultEnvironment
  ): Promise<void> {
    if (this.httpServer !== undefined) {
      return
    }

    const managerKeyManager = new KeyManager(1)
    const workersKeyManager = new KeyManager(1)
    const txStoreManager = new TxStoreManager({ inMemory: true })
    const contractInteractor = new ContractInteractor(new Web3.providers.HttpProvider(host),
      configureGSN({
        relayHubAddress: deploymentResult.relayHubAddress,
        chainId: environment.chainId,
        relayVerifierAddress: deploymentResult.relayVerifierAddress,
        deployVerifierAddress: deploymentResult.deployVerifierAddress
      }))
    await contractInteractor.init()
    const relayServerDependencies = {
      contractInteractor,
      txStoreManager,
      managerKeyManager,
      workersKeyManager
    }
    const relayServerParams: Partial<ServerConfigParams> = {
      devMode: true,
      url: relayUrl,
      relayHubAddress: deploymentResult.relayHubAddress,
      gasPriceFactor: 1,
      baseRelayFee: '0',
      pctRelayFee: 0,
      logLevel: 1,
      checkInterval: 10,
      // refreshStateTimeoutBlocks:1,
      relayVerifierAddress: deploymentResult.relayVerifierAddress,
      deployVerifierAddress: deploymentResult.deployVerifierAddress
    }
    const relayServer = new RelayServer(relayServerParams, relayServerDependencies)
    await relayServer.init(replenishStrategy ?? this.defaultReplenishFunction)

    this.httpServer = new HttpServer(
      port,
      relayServer
    )
    this.httpServer.start()
  }
}

export const GsnTestEnvironment = new GsnTestEnvironmentClass()

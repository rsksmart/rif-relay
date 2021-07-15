import net from 'net'
import { ether } from '@openzeppelin/test-helpers'
import CommandsLogic, { DeploymentResult } from '../cli/CommandsLogic'
import { KeyManager } from '../relayserver/KeyManager'
import { configure } from './Configurator'
import { getNetworkUrl, supportedNetworks } from '../cli/utils'
import { TxStoreManager } from '../relayserver/TxStoreManager'
import { RelayServer } from '../relayserver/RelayServer'
import { HttpServer } from '../relayserver/HttpServer'
import { Address } from './types/Aliases'
import { RelayProvider } from './RelayProvider'
import Web3 from 'web3'
import {
  ContractInteractor,
  Environment,
  defaultEnvironment,
  ServerConfigParams
} from '@rsksmart/rif-relay-common'

export interface TestEnvironmentInfo {
  deploymentResult: DeploymentResult
  relayProvider: RelayProvider
  httpServer: HttpServer
  relayUrl: string
}

class TestEnvironmentClass {
  private httpServer?: HttpServer

  /**
   *
   * @param host:
   * @param debug
   * @return
   */
  async start (host?: string, workerTargetBalance = 0.003e18, environment = defaultEnvironment): Promise<TestEnvironmentInfo> {
    await this.stop()
    const _host: string = getNetworkUrl(host)
    console.log('_host=', _host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`start: expected network (${supportedNetworks().join('|')}) or url`)
    }
    const commandsLogic = new CommandsLogic(_host, configure({ chainId: environment.chainId }))
    const from = await commandsLogic.findWealthyAccount()
    const deploymentResult = await commandsLogic.deployContracts({
      from,
      gasPrice: '1',
      skipConfirmation: true,
      relayHubConfiguration: environment.relayHubConfiguration
    })

    const port = await this._resolveAvailablePort()
    const relayUrl = 'http://127.0.0.1:' + port.toString()

    await this._runServer(_host, deploymentResult, from, relayUrl, port, workerTargetBalance, environment)
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

    const config = configure({
      relayHubAddress: deploymentResult.relayHubAddress,
      relayVerifierAddress: deploymentResult.relayVerifierAddress,
      deployVerifierAddress: deploymentResult.deployVerifierAddress,
      preferredRelays: [relayUrl],
      chainId: environment.chainId
    })

    const relayProvider = new RelayProvider(new Web3.providers.HttpProvider(_host), config)
    console.error('== start: ready.')
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
      // @ts-ignore
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

  async stop (): Promise<void> {
    if (this.httpServer !== undefined) {
      this.httpServer.stop()
      this.httpServer.close()
      await this.httpServer.backend.transactionManager.txStoreManager.clearAll()
      this.httpServer = undefined
    }
  }

  async _runServer (
    host: string,
    deploymentResult: DeploymentResult,
    from: Address,
    relayUrl: string,
    port: number,
    workerTargetBalance: number,
    environment: Environment = defaultEnvironment
  ): Promise<void> {
    if (this.httpServer !== undefined) {
      return
    }

    const managerKeyManager = new KeyManager(1)
    const workersKeyManager = new KeyManager(1)
    const txStoreManager = new TxStoreManager({ inMemory: true })
    const contractInteractor = new ContractInteractor(new Web3.providers.HttpProvider(host),
      configure({
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
      logLevel: 1,
      checkInterval: 10,
      // refreshStateTimeoutBlocks:1,
      relayVerifierAddress: deploymentResult.relayVerifierAddress,
      deployVerifierAddress: deploymentResult.deployVerifierAddress,
      workerTargetBalance
    }

    const relayServer = new RelayServer(relayServerParams, relayServerDependencies)
    await relayServer.init()

    this.httpServer = new HttpServer(
      port,
      relayServer
    )
    this.httpServer.start()
  }
}

export const TestEnvironment = new TestEnvironmentClass()

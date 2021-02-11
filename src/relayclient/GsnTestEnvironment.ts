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
   * @param deployPaymasters - whether to deploy the naive paymaster and deploy naive paymaster instances for tests
   * @param debug
   * @return
   */
  async startGsn (host?: string, environment = defaultEnvironment, deployPaymasters: boolean = true): Promise<TestEnvironment> {
    await this.stopGsn()
    const _host: string = getNetworkUrl(host)
    console.log('_host=', _host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    const commandsLogic = new CommandsLogic(_host, configureGSN({ chainId: environment.chainId }))
    const from = await commandsLogic.findWealthyAccount()
    /* TODO review and remove
    if (from == null) {
      throw new Error('could not get unlocked account with sufficient balance')
    }
    */
    const deploymentResult = await commandsLogic.deployGsnContracts({
      from,
      gasPrice: '1',
      deployPaymasters,
      skipConfirmation: true,
      relayHubConfiguration: environment.relayHubConfiguration
    })
    if (deployPaymasters) {
      const balance = await commandsLogic.fundPaymaster(from, deploymentResult.naiveRelayPaymasterAddress, ether('1'))
      console.log('Naive Paymaster successfully funded, balance:', Web3.utils.fromWei(balance))
      const dbalance = await commandsLogic.fundPaymaster(from, deploymentResult.naiveDeployPaymasterAddress, ether('1'))
      console.log('Naive Deploy Paymaster successfully funded, balance:', Web3.utils.fromWei(dbalance))
    }

    const port = await this._resolveAvailablePort()
    const relayUrl = 'http://127.0.0.1:' + port.toString()
    await this._runServer(_host, deploymentResult, from, relayUrl, port)
    if (this.httpServer == null) {
      throw new Error('Failed to run a local Relay Server')
    }

    const registerOptions = {
      from,
      stake: ether('1'),
      funds: ether('1'),
      relayUrl: relayUrl,
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
      relayPaymasterAddress: deploymentResult.naiveRelayPaymasterAddress,
      deployPaymasterAddress: deploymentResult.naiveDeployPaymasterAddress,
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

  async _runServer (
    host: string,
    deploymentResult: DeploymentResult,
    from: Address,
    relayUrl: string,
    port: number,
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
        chainId: environment.chainId
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
      logLevel: 1
    }
    const backend = new RelayServer(relayServerParams, relayServerDependencies)
    await backend.init()

    this.httpServer = new HttpServer(
      port,
      backend
    )
    this.httpServer.start()
  }
}

export const GsnTestEnvironment = new GsnTestEnvironmentClass()

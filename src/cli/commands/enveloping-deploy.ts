import commander from 'commander'
import CommandsLogic from '../CommandsLogic'
import { configure } from '../../relayclient/Configurator'
import {
  getMnemonic,
  getNetworkUrl,
  getRelayHubConfiguration,
  envelopingCommander,
  saveDeployment,
  showDeployment
} from '../utils'
import { getEnvironment } from '@rsksmart/rif-relay-common'

envelopingCommander(['n', 'f', 'm', 'g'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/enveloping/)', 'build/enveloping')
  .option('--factory <address>', 'address of the Smart Wallet factory deployed to the current network (optional; deploys new one by default)')
  .option('--sWalletTemplate <address>', 'address of the Smart Wallet template to be instantiated by the factory deployed to the current network (optional; deploys new one by default)')
  .option('--deployVerifier <address>', 'address of the logic used to verify a deploy request (optional); deploys new one by default')
  .option('--relayVerifier <address>', 'address of the logic used to verify a relay request (optional); deploys new one by default')
  .option('--relayHub <address>', 'relayHub')
  .option('--penalizer <address>', 'penalizer')
  .option('--registry <address>', 'versionRegistry')
  .option('--registryHubId <string>', 'save the address of the relayHub to the registry, with this hub-id')
  .option('--yes, --skipConfirmation', 'skip confirmation')
  .option('-c, --config <mnemonic>', 'config JSON file to change the configuration of the RelayHub being deployed (optional)')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const mnemonic = getMnemonic(commander.mnemonic)

  const relayHubConfiguration = getRelayHubConfiguration(commander.config) ?? getEnvironment(network).relayHubConfiguration
  const logic = new CommandsLogic(nodeURL, configure({}), mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()
  async function getGasPrice (): Promise<string> {
    const gasPrice = await web3.eth.getGasPrice()
    console.log(`Using network gas price of ${gasPrice}`)
    return gasPrice
  }

  const gasPrice = commander.gasPrice ?? await getGasPrice()

  const deploymentResult = await logic.deployContracts({
    from,
    gasPrice,
    relayHubConfiguration,
    deployVerifierAddress: commander.deployVerifier,
    relayVerifierAddress: commander.relayVerifier,
    smartWalletFactoryAddress: commander.factory,
    smartWalletTemplateAddress: commander.sWalletTemplate,
    relayHubAddress: commander.relayHub,
    penalizerAddress: commander.penalizer,
    registryAddress: commander.registry,
    registryHubId: commander.registryHubId,
    verbose: true,
    skipConfirmation: commander.skipConfirmation
  })

  showDeployment(deploymentResult, `Enveloping deloyed to network: ${network}`)
  saveDeployment(deploymentResult, commander.workdir)
  process.exit(0)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)

import Web3 from 'web3'
import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { getMnemonic, getNetworkUrl, getPaymasterAddress, getDeployPaymasterAddress, getRelayHubAddress, gsnCommander } from '../utils'

const commander = gsnCommander(['h', 'n', 'm'])
  .option('--isDeploy', 'The paymaster is for deploy (default is false)')
  .option('--paymaster <address>', 'address of the relayer paymaster contract')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const hub = getRelayHubAddress(commander.hub)
  let paymaster
  if (commander.isDeploy != null) {
    paymaster = getDeployPaymasterAddress(commander.deployPaymaster)
  } else {
    paymaster = getPaymasterAddress(commander.paymaster)
  }

  if (hub == null || paymaster == null) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Contracts not found: hub: ${hub} paymaster: ${paymaster} `)
  }
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, configureGSN({ relayHubAddress: hub }), mnemonic)
  const balance = await logic.getPaymasterBalance(paymaster)
  console.log(`Account ${paymaster} has a GSN balance of ${Web3.utils.fromWei(balance)} ETH`)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)

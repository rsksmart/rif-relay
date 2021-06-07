import Web3 from 'web3'

import ContractInteractor from '../../common/ContractInteractor'
import { configure } from '../../relayclient/Configurator'
import HttpClient from '../../relayclient/HttpClient'
import HttpWrapper from '../../relayclient/HttpWrapper'

import { getNetworkUrl, getRelayHubAddress, envelopingCommander } from '../utils'
import StatusLogic from '../StatusLogic'
import {KnownRelaysManager} from "../../relayclient/KnownRelaysManager";

const commander = envelopingCommander(['n', 'h'])
  .parse(process.argv);

(async () => {
  const host = getNetworkUrl(commander.network)
  const relayHubAddress = getRelayHubAddress(commander.hub)

  if (relayHubAddress == null) {
    console.error('Please specify RelayHub address')
    process.exit(1)
  }

  const statusConfig = {
    blockHistoryCount: 6000,
    getAddressTimeout: 1000,
    relayHubAddress
  }

  const config = configure({ relayHubAddress })
  const contractInteractor = new ContractInteractor(new Web3.providers.HttpProvider(host), config)
  const httpClient = new HttpClient(new HttpWrapper({ timeout: statusConfig.getAddressTimeout }), config)
  const knownRelaysManager = new KnownRelaysManager(contractInteractor, config)

  const statusLogic = new StatusLogic(contractInteractor, httpClient, statusConfig, knownRelaysManager)

  const statistics = await statusLogic.gatherStatistics()

  console.log(`Total stakes by all relays: ${Web3.utils.fromWei(statistics.totalStakesByRelays)} RBTC`)
  console.log(`Hub address: ${relayHubAddress}`)

  console.log('\n# Relays:')
  statistics.activeRelays.forEach(activeRelay => {
    const res = []
    res.push(activeRelay.manager)
    res.push(activeRelay.url)
    const managerBalance = statistics.balances.get(activeRelay.manager)
    if (managerBalance == null) {
      res.push('\tbalance: N/A')
    } else {
      res.push(`\tbalance: ${Web3.utils.fromWei(managerBalance)} RBTC`)
    }
    const pingResult = statistics.relayPings.get(activeRelay.url)
    const status = pingResult?.pingResponse != null ? pingResult.pingResponse.ready.toString() : pingResult?.error?.toString() ?? 'unknown'
    res.push(`\tstatus: ${status}`)
    console.log('- ' + res.join(' '))
  })
  /*
    console.log('\n# Owners:')
    Object.keys(owners).forEach(k => {
      const ethBalance = web3.eth.getBalance(k)
      const relayBalance = r.methods.balanceOf(k).call()
      Promise.all([ethBalance, relayBalance])
        .then(async () => {
          // @ts-ignore
          console.log('-', owners[k], ':', k, 'on-hub:', (await relayBalance) / 1e18, '\tbal', (await ethBalance) / 1e18)
        })
        .catch(reason => {
          console.error(reason)
        })
    })
  */
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)

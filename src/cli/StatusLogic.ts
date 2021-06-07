import ContractInteractor  from '../common/ContractInteractor'
import HttpClient from '../relayclient/HttpClient'
import PingResponse from '../common/PingResponse'
import { Address } from '../relayclient/types/Aliases'
import {RelayData} from "../relayclient/types/RelayData";
import {KnownRelaysManager} from "../relayclient/KnownRelaysManager";

interface StatusConfig {
  blockHistoryCount: number
  getAddressTimeout: number
  relayHubAddress: Address
}

interface PingAttempt {
  pingResponse?: PingResponse
  error?: Error
}

interface Statistics {
  totalStakesByRelays: string
  activeRelays: RelayData[]
  relayPings: Map<string, PingAttempt>
  balances: Map<Address, string>
}

export default class StatusLogic {
  private readonly contractInteractor: ContractInteractor
  private readonly httpClient: HttpClient
  private readonly config: StatusConfig
  private readonly knownRelaysManager: KnownRelaysManager

  constructor (contractInteractor: ContractInteractor, httpClient: HttpClient, config: StatusConfig, knownRelaysManager: KnownRelaysManager) {
    this.contractInteractor = contractInteractor
    this.httpClient = httpClient
    this.config = config
    this.knownRelaysManager = knownRelaysManager
  }

  async gatherStatistics (): Promise<Statistics> {
    const r = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
    const totalStakesByRelays = await this.contractInteractor.getBalance(r.address)

    const managers = await this.knownRelaysManager._fetchRecentlyActiveRelayManagers();
    const activeRelays = await this.contractInteractor.getActiveRelays(managers)

    const relayPings = new Map<string, PingAttempt>()
    const balances = new Map<string, string>()
    for (const activeRelay of activeRelays) {
      const url = activeRelay.url
      const relayManager = activeRelay.manager
      try {
        const pingResponse = await this.httpClient.getPingResponse(url)
        relayPings.set(url, { pingResponse })
      } catch (error) {
        relayPings.set(url, { error })
      }
      const managerBalance = await this.contractInteractor.getBalance(relayManager)
      balances.set(relayManager, managerBalance)
    }

    return {
      totalStakesByRelays,
      activeRelays,
      relayPings,
      balances
    }
  }
}

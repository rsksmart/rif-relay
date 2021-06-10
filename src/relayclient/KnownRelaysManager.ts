import log from 'loglevel'

import EnvelopingTransactionDetails from './types/EnvelopingTransactionDetails'
import RelayFailureInfo from './types/RelayFailureInfo'
import { Address, AsyncScoreCalculator, RelayFilter } from './types/Aliases'
import { EnvelopingConfig } from './Configurator'

import ContractInteractor from '../common/ContractInteractor'
import { EventData } from 'web3-eth-contract'
import { RelayData } from './types/RelayData'

export const EmptyFilter: RelayFilter = (): boolean => {
  return true
}
/**
 * Basic score is reversed higher is better.
 * Relays that failed to respond recently will be downgraded for some period of time.
 */
export const DefaultRelayScore = async function (relay: RelayData, txDetails: EnvelopingTransactionDetails, failures: RelayFailureInfo[]): Promise<number> {
  return Math.pow(0.9, failures.length)
}

export class KnownRelaysManager {
  private readonly contractInteractor: ContractInteractor
  private readonly config: EnvelopingConfig
  private readonly relayFilter: RelayFilter
  private readonly scoreCalculator: AsyncScoreCalculator

  private latestScannedBlock: number = 0
  private relayFailures = new Map<string, RelayFailureInfo[]>()

  public relayLookupWindowParts: number
  public preferredRelayers: RelayData[] = []
  public allRelayers: RelayData[] = []

  constructor (contractInteractor: ContractInteractor, config: EnvelopingConfig, relayFilter?: RelayFilter, scoreCalculator?: AsyncScoreCalculator) {
    this.config = config
    this.relayFilter = relayFilter ?? EmptyFilter
    this.scoreCalculator = scoreCalculator ?? DefaultRelayScore
    this.contractInteractor = contractInteractor
    this.relayLookupWindowParts = this.config.relayLookupWindowParts
  }

  async refresh (): Promise<void> {
    this._refreshFailures()
    const recentlyActiveRelayManagers = await this._fetchRecentlyActiveRelayManagers()
    this.preferredRelayers = this.config.preferredRelays.map(relayUrl => {
      const relayData: RelayData = Object.assign({} as any, {
        url: relayUrl
      })
      return relayData
    })
    this.allRelayers = await this.getRelayDataForManagers(recentlyActiveRelayManagers)
  }

  async getRelayDataForManagers (relayManagers: Set<Address>): Promise<RelayData[]> {
    // As 'topics' are used as 'filter', having an empty set results in querying all register events.
    if (relayManagers.size === 0) {
      return []
    }
    const activeRelays = await this.contractInteractor.getActiveRelays(relayManagers)
    return activeRelays.filter(this.relayFilter)
  }

  splitRange (fromBlock: number, toBlock: number, splits: number): Array<{ fromBlock: number, toBlock: number }> {
    const totalBlocks = toBlock - fromBlock + 1
    const splitSize = Math.ceil(totalBlocks / splits)

    const ret: Array<{ fromBlock: number, toBlock: number }> = []
    let b
    for (b = fromBlock; b < toBlock; b += splitSize) {
      ret.push({ fromBlock: b, toBlock: Math.min(toBlock, b + splitSize - 1) })
    }
    return ret
  }

  // return events from hub. split requested range into "window parts", to avoid
  // fetching too many events at once.
  async getPastEventsForHub (fromBlock: number, toBlock: number): Promise<EventData[]> {
    let relayEventParts: any[]
    while (true) {
      const rangeParts = this.splitRange(fromBlock, toBlock, this.relayLookupWindowParts)
      try {
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        const getPastEventsPromises = rangeParts.map(({ fromBlock, toBlock }): Promise<any> =>
          this.contractInteractor.getPastEventsForHub([], {
            fromBlock,
            toBlock
          }))
        relayEventParts = await Promise.all(getPastEventsPromises)
        break
      } catch (e) {
        if (e.toString().match(/query returned more than/) != null &&
          this.config.relayLookupWindowBlocks > this.relayLookupWindowParts
        ) {
          if (this.relayLookupWindowParts >= 16) {
            throw new Error(`Too many events after splitting by ${this.relayLookupWindowParts}`)
          }
          this.relayLookupWindowParts *= 4
        } else {
          throw e
        }
      }
    }
    return relayEventParts.flat()
  }

  async _fetchRecentlyActiveRelayManagers (): Promise<Set<Address>> {
    const toBlock = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(0, toBlock - this.config.relayLookupWindowBlocks)

    const relayEvents: any[] = await this.getPastEventsForHub(fromBlock, toBlock)

    log.info(`fetchRelaysAdded: found ${relayEvents.length} events`)
    const foundRelayManagers: Set<Address> = new Set()
    relayEvents.forEach((event: any) => {
      // TODO: remove relay managers who are not staked
      // if (event.event === 'RelayRemoved') {
      //   foundRelays.delete(event.returnValues.relay)
      // } else {
      foundRelayManagers.add(event.returnValues.relayManager)
    })

    log.info(`fetchRelaysAdded: found unique relays: ${JSON.stringify(Array.from(foundRelayManagers.values()))}`)
    this.latestScannedBlock = toBlock
    return foundRelayManagers
  }

  _refreshFailures (): void {
    const newMap = new Map<string, RelayFailureInfo[]>()
    this.relayFailures.forEach((value: RelayFailureInfo[], key: string) => {
      newMap.set(key, value.filter(failure => {
        const elapsed = (new Date().getTime() - failure.lastErrorTime) / 1000
        return elapsed < this.config.relayTimeoutGrace
      }))
    })
    this.relayFailures = newMap
  }

  async getRelaysSortedForTransaction (transactionDetails: EnvelopingTransactionDetails): Promise<RelayData[][]> {
    const sortedRelays: RelayData[][] = []
    sortedRelays[0] = Array.from(this.preferredRelayers)
    sortedRelays[1] = await this._sortRelaysInternal(transactionDetails, this.allRelayers)
    return sortedRelays
  }

  async _sortRelaysInternal (transactionDetails: EnvelopingTransactionDetails, activeRelays: RelayData[]): Promise<RelayData[]> {
    const scores = new Map<string, number>()
    for (const activeRelay of activeRelays) {
      let score = 0
      score = await this.scoreCalculator(activeRelay, transactionDetails, this.relayFailures.get(activeRelay.url) ?? [])
      scores.set(activeRelay.manager, score)
    }
    return Array
      .from(activeRelays.values())
      .sort((a, b) => {
        const aScore = scores.get(a.manager) ?? 0
        const bScore = scores.get(b.manager) ?? 0
        return bScore - aScore
      })
  }

  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void {
    const relayFailures = this.relayFailures.get(relayUrl)
    const newFailureInfo = {
      lastErrorTime,
      relayManager,
      relayUrl
    }
    if (relayFailures == null) {
      this.relayFailures.set(relayUrl, [newFailureInfo])
    } else {
      relayFailures.push(newFailureInfo)
    }
  }
}

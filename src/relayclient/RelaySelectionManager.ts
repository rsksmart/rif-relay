import log from 'loglevel'
import { KnownRelaysManager } from './KnownRelaysManager'
import HttpClient from './HttpClient'
import { PingFilter } from './types/Aliases'
import EnvelopingTransactionDetails from './types/EnvelopingTransactionDetails'
import replaceErrors from '../common/ErrorReplacerJSON'
import { EnvelopingConfig } from './Configurator'
import { PartialRelayInfo, RelayInfo } from './types/RelayInfo'
import {RelayData} from "./types/RelayData";

interface RaceResult {
  winner?: PartialRelayInfo
  errors: Map<string, Error>
}

export default class RelaySelectionManager {
  private readonly knownRelaysManager: KnownRelaysManager
  private readonly httpClient: HttpClient
  private readonly config: EnvelopingConfig
  private readonly pingFilter: PingFilter
  private readonly transactionDetails: EnvelopingTransactionDetails

  private remainingRelays: RelayData[][] = []
  private isInitialized = false

  public errors: Map<string, Error> = new Map<string, Error>()

  constructor (transactionDetails: EnvelopingTransactionDetails, knownRelaysManager: KnownRelaysManager, httpClient: HttpClient, pingFilter: PingFilter, config: EnvelopingConfig) {
    this.transactionDetails = transactionDetails
    this.knownRelaysManager = knownRelaysManager
    this.httpClient = httpClient
    this.pingFilter = pingFilter
    this.config = config
  }

  /**
   * Ping those relays that were not pinged yet, and remove both the returned relay or relays re from {@link remainingRelays}
   * @returns the first relay to respond to a ping message. Note: will never return the same relay twice.
   */
  async selectNextRelay (): Promise<RelayInfo | undefined> {
    if (this.transactionDetails.onlyPreferredRelays ?? false) {
      log.info('Only using preferred relays')
      let index: number = 0

      while (true) {
        let relayInfo: RelayInfo | undefined
        const slice = this._getPreferredRelaysNextSlice(index)

        if (slice.length > 0) {
          relayInfo = await this._nextRelayInternal(slice)
          if (relayInfo == null) {
            index += slice.length
            continue
          }
        }
        return relayInfo
      }
    } else {
      while (true) {
        const slice = this._getNextSlice()
        let relayInfo: RelayInfo | undefined
        if (slice.length > 0) {
          relayInfo = await this._nextRelayInternal(slice)
          if (relayInfo == null) {
            continue
          }
        }
        return relayInfo
      }
    }
  }

  _getPreferredRelaysNextSlice (index: number): RelayData[] {
    if (!this.isInitialized) { throw new Error('init() not called') }
    let slice: RelayData[] = []
    if (this.remainingRelays[0].length >= index + 1) {
      const relays = this.remainingRelays[0].slice(index, this.remainingRelays[0].length)
      const bulkSize = Math.min(this.config.sliceSize, relays.length)
      slice = relays.slice(0, bulkSize)
    }

    return slice
  }

  async _nextRelayInternal (relays: RelayData[]): Promise<RelayInfo | undefined> {
    log.info('nextRelay: find fastest relay from: ' + JSON.stringify(relays))
    const raceResult = await this._raceToSuccess(relays)
    log.info(`race finished with a result: ${JSON.stringify(raceResult, replaceErrors)}`)
    this._handleRaceResults(raceResult)
    if (raceResult.winner != null) {
      const managerAddress = raceResult.winner.pingResponse.relayManagerAddress
      log.info(`finding relay register info for manager address: ${managerAddress}; known info: ${JSON.stringify(raceResult.winner.relayData)}`)
      const events = await this.knownRelaysManager.getRelayDataForManagers(new Set([managerAddress]))
      if (events.length === 1) {
        const relayInfo = events[0]
        relayInfo.url = raceResult.winner.relayData.url
        return {
          pingResponse: raceResult.winner.pingResponse,
          relayData: relayInfo
        }
      } else {
        // TODO: do not throw! The preferred relay may be removed since.
        throw new Error('Could not find register event for the winning preferred relay')
      }
    }
  }

  async init (): Promise<this> {
    this.remainingRelays = await this.knownRelaysManager.getRelaysSortedForTransaction(this.transactionDetails)
    this.isInitialized = true
    return this
  }

  // relays left to try
  // (note that some edge-cases (like duplicate urls) are not filtered out)
  relaysLeft (): RelayData[] {
    return this.remainingRelays.flatMap(list => list)
  }

  _getNextSlice (): RelayData[] {
    if (!this.isInitialized) { throw new Error('init() not called') }
    for (const relays of this.remainingRelays) {
      const bulkSize = Math.min(this.config.sliceSize, relays.length)
      const slice = relays.slice(0, bulkSize)
      if (slice.length === 0) {
        continue
      }
      return slice
    }
    return []
  }

  /**
   * @returns JSON response from the relay server, but adds the requested URL to it :'-(
   */
  async _getRelayAddressPing (relayData: RelayData): Promise<PartialRelayInfo> {
    log.info(`getRelayAddressPing URL: ${relayData.url}`)
    const pingResponse = await this.httpClient.getPingResponse(relayData.url, this.transactionDetails.callVerifier)

    if (!pingResponse.ready) {
      throw new Error(`Relay not ready ${JSON.stringify(pingResponse)}`)
    }
    this.pingFilter(pingResponse, this.transactionDetails)
    return {
      pingResponse,
      relayData
    }
  }

  /**
   * From https://stackoverflow.com/a/37235207 (added types, modified to catch exceptions)
   * Accepts an array of promises.
   * Resolves once any promise resolves, ignores the rest. Exceptions returned separately.
   */
  async _raceToSuccess (relays: RelayData[]): Promise<RaceResult> {
    const errors: Map<string, Error> = new Map<string, Error>()
    return await new Promise((resolve) => {
      relays.forEach((relay: RelayData) => {
        this._getRelayAddressPing(relay)
          .then((winner: PartialRelayInfo) => {
            resolve({
              winner,
              errors
            })
          })
          .catch((err: Error) => {
            errors.set(relay.url, err)
            if (errors.size === relays.length) {
              resolve({ errors })
            }
          })
      })
    })
  }

  _handleRaceResults (raceResult: RaceResult): void {
    if (!this.isInitialized) { throw new Error('init() not called') }
    this.errors = new Map([...this.errors, ...raceResult.errors])
    this.remainingRelays = this.remainingRelays.map(relays =>
      relays
        .filter(eventInfo => eventInfo.url !== raceResult.winner?.relayData.url)
        .filter(eventInfo => !Array.from(raceResult.errors.keys()).includes(eventInfo.url))
    )
  }
}

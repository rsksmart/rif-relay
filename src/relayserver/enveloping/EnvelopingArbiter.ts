import Web3 from 'web3'
import { HttpProvider, IpcProvider, WebsocketProvider } from 'web3-core'
import { FeeEstimator, FeesTable } from './FeeEstimator'
import { ServerConfigParams } from '../ServerConfigParams'

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

export class EnvelopingArbiter {
  readonly web3: Web3
  feeEstimator: FeeEstimator

  constructor (config: Partial<ServerConfigParams>, provider: Web3Provider) {
    this.web3 = new Web3(provider)
    this.feeEstimator = new FeeEstimator(config, this.web3)
  }

  getFeesTable=(): FeesTable => {
    return this.feeEstimator.feesTable
  }

  async start (): Promise<void> {
    console.log('Enveloping Arbiter Module started')
    this.feeEstimator.start()
  }
}

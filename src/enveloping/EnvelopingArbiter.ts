import { Bytes } from 'ethers'
import log from 'loglevel'
import { HttpProvider, IpcProvider, WebsocketProvider } from 'web3-core'
import { Address } from '../relayclient/types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'
import { TransactionManager } from '../relayserver/TransactionManager'
import { validateCommitmentSig } from './CommitmentValidator'
import { CommitmentReceipt } from './Commitment'
import { FeeEstimator, FeesTable } from './FeeEstimator'
import { NonceQueueSelector } from './NonceQueueSelector'

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

export class EnvelopingArbiter {
  readonly feeEstimator: FeeEstimator
  readonly nonceQueueSelector: NonceQueueSelector

  constructor (config: Partial<ServerConfigParams>, provider: Web3Provider) {
    this.feeEstimator = new FeeEstimator(config, provider)
    this.nonceQueueSelector = new NonceQueueSelector()
  }

  async delay (ms: number): Promise<void> {
    return await new Promise((resolve) => {
      setTimeout(() => resolve(), ms)
    })
  }

  isFeeEstimatorInitialized (): Boolean {
    return this.feeEstimator.initialized
  }

  isValidTime (maxTime: string): boolean {
    if (parseInt(maxTime) <= Date.now()) { return false }
    return true
  }

  async getFeesTable (): Promise<FeesTable> {
    if (typeof this.feeEstimator.feesTable !== 'undefined') {
      return this.feeEstimator.feesTable
    } else {
      await this.delay(1000)
      return await this.getFeesTable()
    }
  }

  async getQueueGasPrice (maxTime?: string): Promise<string> {
    if (typeof maxTime === 'undefined' || !this.isValidTime(maxTime)) { maxTime = (Date.now() + 300).toString() }
    return await this.nonceQueueSelector.getQueueGasPrice(parseInt(maxTime), await this.getFeesTable())
  }

  getQueueWorker (addresses: string[], maxTime?: string): string {
    if (typeof maxTime === 'undefined') { maxTime = (Date.now() + 300).toString() }
    return this.nonceQueueSelector.getQueueWorker(parseInt(maxTime), addresses)
  }

  async start (): Promise<void> {
    log.info('Enveloping Arbiter Module started')
    this.feeEstimator.start().then(() => {
      log.info('Fee Estimator initialized')
    }).catch(e => {
      console.error(e)
      throw new Error('Fee Estimator initialization failed')
    })
  }

  async signCommitment (transactionManager: TransactionManager, signer: Address, message: Bytes): Promise<string> {
    return await transactionManager.workersKeyManager.signMessage(signer, message)
  }

  validateCommitmentSig (receipt: CommitmentReceipt): boolean {
    return validateCommitmentSig(receipt)
  }
}

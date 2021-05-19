import { Bytes } from 'ethers'
import log from 'loglevel'
import { HttpProvider, IpcProvider, WebsocketProvider } from 'web3-core'
import { Address } from '../relayclient/types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'
import { TransactionManager } from '../relayserver/TransactionManager'
import { CommitmentValidator } from './CommitmentValidator'
import { CommitmentReceipt } from './Commitment'
import { FeeEstimator, FeesTable } from './FeeEstimator'
import { NonceQueueSelector } from './NonceQueueSelector'

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

/**
 * The main Enveloping Arbiter component. It is in charge of ensuring quality of service
 * for the Enveloping clients. It adds multiple workers support through the NonceQueueSelector, each
 * corresponding to a different "tier" of service. It also provides assurance to the client in the form
 * of a signed Commitment receipt, that can be validated through the CommitmentValidator or a
 * smart contract in the future. A Fee Estimator monitors the blockchain and estimates the recommended
 * gas prices for different tolerated delays.
 */
export class EnvelopingArbiter {
  readonly commitmentValidator: CommitmentValidator
  readonly feeEstimator: FeeEstimator
  readonly nonceQueueSelector: NonceQueueSelector

  constructor (config: Partial<ServerConfigParams>, provider: Web3Provider) {
    this.commitmentValidator = new CommitmentValidator()
    this.feeEstimator = new FeeEstimator(config, provider)
    this.nonceQueueSelector = new NonceQueueSelector()
  }

  /**
   * Checks if the given timestamp is valid. If not, it defaults to 5min in the future
   * @param maxTime the timestamp to validate
   * @return a valid timestamp
   */
  checkMaxDelayForResponse (maxTime?: string): number {
    if (typeof maxTime === 'undefined' || !this.isValidTime(maxTime)) {
      maxTime = (Date.now() + (300 * 1000)).toString()
    }
    return parseInt(maxTime)
  }

  /**
   * Waits the given number of miliseconds
   * @param ms the time to wait
   */
  async delay (ms: number): Promise<void> {
    return await new Promise((resolve) => {
      setTimeout(() => resolve(), ms)
    })
  }

  /**
   * Checks if the given timestamp is valid and not from the past
   */
  isValidTime (maxTime: string): boolean {
    return parseInt(maxTime) > Date.now();

  }

  /**
   * Reads the Fees Table from the Fee Estimator and returns it. When first started, the
   * Fee Estimator will take a few seconds to process the data, meanwhile the fees table
   * won't be available. In this case, it will keep checking every second until it is.
   */
  async getFeesTable (): Promise<FeesTable> {
    if (typeof this.feeEstimator.feesTable !== 'undefined') {
      return this.feeEstimator.feesTable
    } else {
      await this.delay(1000)
      return await this.getFeesTable()
    }
  }

  /**
   * It calls the NonceQueueSelector to return the recommended gas price for a transaction
   * to be included before the given time. If no timestamp or an invalid one is specified,
   * it will default to 5min in the future.
   * @param maxTime the timestamp to use for calculation
   * @return the recommended gas price
   */
  async getQueueGasPrice (maxTime?: string): Promise<string> {
    if (typeof maxTime === 'undefined' || !this.isValidTime(maxTime)) { maxTime = (Date.now() + (300 * 1000)).toString() }
    return await this.nonceQueueSelector.getQueueGasPrice(parseInt(maxTime), await this.getFeesTable())
  }

  /**
   * It calls the NonceQueueSelector to return the address of the worker that could relay a
   * transaction before the given time. If no timestamp or an invalid one is specified, it will
   * default to 5min in the future.
   * @param addresses an array containing a list of relay workers addresses
   * @param maxTime the timestamp to use for calculation
   * @return the selected worker address
   */
  getQueueWorker (addresses: string[], maxTime?: string): string {
    if (typeof maxTime === 'undefined' || !this.isValidTime(maxTime)) { maxTime = (Date.now() + (300 * 1000)).toString() }
    return this.nonceQueueSelector.getQueueWorker(parseInt(maxTime), addresses)
  }

  /**
   * The Enveloping Arbiter component requires to be started, so it can start the Fee Estimator
   * monitor worker.
   */
  async start (): Promise<void> {
    log.info('Enveloping Arbiter Module started')
    try {
      await this.feeEstimator.start()
      log.info('Fee Estimator initialized')
    } catch (error) {
      log.error(error)
      throw new Error('Fee Estimator initialization failed')
    }
  }

  /**
   * The Enveloping Arbiter component requires to be started, so it can start the Fee Estimator
   * monitor worker.
   */
  stop (): void {
    log.info('Sopping Fee Estimator Enveloping Arbiter Module')
    this.feeEstimator.stop()
    log.info('Fee Estimator successfully stopped')
  }

  /**
   * Signs the specified message using the given signer and TransactionManager
   * @param transactionManager the TransactionManager instance
   * @param signer the address that will sign the message
   * @param message the message to be signed
   * @return a signed message
   */
  async signCommitment (transactionManager: TransactionManager, signer: Address, message: Bytes): Promise<string> {
    return await transactionManager.workersKeyManager.signMessage(signer, message)
  }

  /**
   * Validates a CommitmentReceipt signature
   * @param receipt the CommitmentReceipt to be validated
   * @return true or false
   */
  validateCommitmentSig (receipt: CommitmentReceipt): boolean {
    return this.commitmentValidator.validateCommitmentSig(receipt)
  }
}

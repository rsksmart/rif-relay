import { Bytes } from 'ethers'
import log from 'loglevel'
import Web3 from 'web3'
import { HttpProvider, IpcProvider, WebsocketProvider } from 'web3-core'
import { Address } from '../relayclient/types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'
import { TransactionManager } from '../relayserver/TransactionManager'
import { validateCommitmentSig } from './CommitmentValidator'
import { CommitmentReceipt } from './Commitment'
import { FeeEstimator, FeesTable } from './FeeEstimator'

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

export class EnvelopingArbiter {
  readonly web3: Web3
  readonly feeEstimator: FeeEstimator

  constructor (config: Partial<ServerConfigParams>, provider: Web3Provider) {
    this.web3 = new Web3(provider)
    this.feeEstimator = new FeeEstimator(config, provider)
  }

  async delay (ms: number): Promise<void> {
    return await new Promise((resolve) => {
      setTimeout(() => resolve(), ms)
    })
  }

  isFeeEstimatorInitialized (): Boolean {
    return this.feeEstimator.initialized
  }

  async getFeesTable (): Promise<FeesTable> {
    if (typeof this.feeEstimator.feesTable !== 'undefined') {
      return this.feeEstimator.feesTable
    } else {
      await this.delay(5000)
      return await this.getFeesTable()
    }
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

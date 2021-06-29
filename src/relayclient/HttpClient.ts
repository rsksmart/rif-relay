import log from 'loglevel'

import PingResponse from '../common/PingResponse'
import HttpWrapper from './HttpWrapper'
import { DeployTransactionRequest, RelayTransactionRequest } from './types/RelayTransactionRequest'
import { EnvelopingConfig } from './Configurator'
import { CommitmentReceipt, CommitmentResponse } from '../enveloping/Commitment'
import { PrefixedHexString } from 'ethereumjs-tx'

export default class HttpClient {
  private readonly httpWrapper: HttpWrapper
  private readonly config: Partial<EnvelopingConfig>

  constructor (httpWrapper: HttpWrapper, config: Partial<EnvelopingConfig>) {
    this.httpWrapper = httpWrapper
    this.config = config
  }

  async getPingResponse (relayUrl: string, verifier?: string, maxTime?: number): Promise<PingResponse> {
    const verifierSuffix = verifier == null ? '' : '?verifier=' + verifier
    const symbol = (verifier == null) ? '?' : '&'
    const maxTimeSuffix = maxTime == null ? '' : symbol + 'maxTime=' + maxTime.toString()
    const pingResponse: PingResponse = await this.httpWrapper.sendPromise(relayUrl + '/getaddr' + verifierSuffix + maxTimeSuffix)
    if (pingResponse == null) {
      throw new Error('Relay responded without a body')
    }
    log.info(`pingResponse: ${JSON.stringify(pingResponse)}`)

    return pingResponse
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest | DeployTransactionRequest): Promise<CommitmentResponse> {
    const { signedTx, signedReceipt, transactionHash, error }: { signedTx: string, signedReceipt: CommitmentReceipt, transactionHash: PrefixedHexString, error: string } = await this.httpWrapper.sendPromise(relayUrl + '/relay', request)
    log.info('relayTransaction response:', signedTx, error)
    if (error != null) {
      throw new Error(`Got error response from relay: ${error}`)
    }
    if (signedTx == null) {
      throw new Error('body.signedTx field missing.')
    }
    if (signedReceipt == null) {
      throw new Error('body.signedReceipt field missing.')
    }
    return { signedTx, signedReceipt, transactionHash }
  }
}

import log from 'loglevel'

import PingResponse from '../common/PingResponse'
import HttpWrapper from './HttpWrapper'
import { RelayTransactionRequest } from './types/RelayTransactionRequest'
import { GSNConfig } from './GSNConfigurator'
import { CommitmentReceipt, CommitmentResponse } from '../enveloping/Commitment'

export default class HttpClient {
  private readonly httpWrapper: HttpWrapper
  private readonly config: Partial<GSNConfig>

  constructor (httpWrapper: HttpWrapper, config: Partial<GSNConfig>) {
    this.httpWrapper = httpWrapper
    this.config = config
  }

  async getPingResponse (relayUrl: string, paymaster?: string): Promise<PingResponse> {
    const paymasterSuffix = paymaster == null ? '' : '?paymaster=' + paymaster
    const pingResponse: PingResponse = await this.httpWrapper.sendPromise(relayUrl + '/getaddr' + paymasterSuffix)
    log.info('error, body', pingResponse)
    if (pingResponse == null) {
      throw new Error('Relay responded without a body')
    }
    return pingResponse
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<CommitmentResponse> {
    const { signedTx, signedReceipt, error }: { signedTx: string, signedReceipt: CommitmentReceipt, error: string } = await this.httpWrapper.sendPromise(relayUrl + '/relay', request)
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
    return { signedTx, signedReceipt }
  }
}

import log from 'loglevel'
import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../common/PingResponse'
import HttpWrapper from './HttpWrapper'
import { DeployTransactionRequest, RelayTransactionRequest } from './types/RelayTransactionRequest'
import { EnvelopingConfig } from './Configurator'

export default class HttpClient {
  private readonly httpWrapper: HttpWrapper
  private readonly config: Partial<EnvelopingConfig>

  constructor (httpWrapper: HttpWrapper, config: Partial<EnvelopingConfig>) {
    this.httpWrapper = httpWrapper
    this.config = config
  }

  async getPingResponse (relayUrl: string, verifier?: string): Promise<PingResponse> {
    const verifierSuffix = verifier == null ? '' : '?verifier=' + verifier
    const pingResponse: PingResponse = await this.httpWrapper.sendPromise(relayUrl + '/getaddr' + verifierSuffix)
    if (pingResponse == null) {
      throw new Error('Relay responded without a body')
    }
    log.info(`pingResponse: ${JSON.stringify(pingResponse)}`)

    return pingResponse
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest | DeployTransactionRequest): Promise<PrefixedHexString> {
    const { signedTx, error }: { signedTx: string, error: string } = await this.httpWrapper.sendPromise(relayUrl + '/relay', request)
    log.info('relayTransaction response:', signedTx, error)
    if (error != null) {
      throw new Error(`Got error response from relay: ${error}`)
    }
    if (signedTx == null) {
      throw new Error('body.signedTx field missing.')
    }
    return signedTx
  }
}

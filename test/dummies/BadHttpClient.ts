import HttpClient from '../../src/relayclient/HttpClient'
import HttpWrapper from '../../src/relayclient/HttpWrapper'
import PingResponse from '../../src/common/PingResponse'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import { EnvelopingConfig } from '../../src/relayclient/Configurator'
import { CommitmentReceipt, CommitmentResponse } from '../../src/enveloping/Commitment'

export default class BadHttpClient extends HttpClient {
  static readonly message = 'This is not the relay you are looking for'

  private readonly failRelay: boolean
  private readonly failPing: boolean
  private readonly timeoutRelay: boolean
  private readonly stubRelay: string | undefined
  private readonly stubPing: PingResponse | undefined
  private readonly stubCommitment: CommitmentReceipt | undefined

  constructor (config: EnvelopingConfig, failPing: boolean, failRelay: boolean, timeoutRelay: boolean, stubPing?: PingResponse, stubRelay?: string, stubCommitment?: CommitmentReceipt) {
    super(new HttpWrapper(), config)
    this.failPing = failPing
    this.failRelay = failRelay
    this.timeoutRelay = timeoutRelay
    this.stubRelay = stubRelay
    this.stubPing = stubPing
    this.stubCommitment = stubCommitment
  }

  async getPingResponse (relayUrl: string, verifier?: string): Promise<PingResponse> {
    if (this.failPing) {
      throw new Error(BadHttpClient.message)
    }
    if (this.stubPing != null) {
      return this.stubPing
    }
    return await super.getPingResponse(relayUrl, verifier)
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<CommitmentResponse> {
    if (this.failRelay) {
      throw new Error(BadHttpClient.message)
    }
    if (this.timeoutRelay) {
      throw new Error('some error describing how timeout occurred somewhere')
    }
    if (this.stubRelay != null && this.stubCommitment !== null) {
      return { signedTx: this.stubRelay, signedReceipt: this.stubCommitment, transactionHash: '' }
    }
    if (this.stubRelay != null && this.stubRelay !== '') {
      return { signedTx: this.stubRelay, signedReceipt: undefined, transactionHash: '' }
    }
    return await super.relayTransaction(relayUrl, request)
  }
}

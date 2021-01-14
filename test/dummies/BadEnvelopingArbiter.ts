import { EnvelopingArbiter } from '../../src/enveloping/EnvelopingArbiter'
import { HttpProvider, IpcProvider, WebsocketProvider } from 'web3-core'
import { ServerConfigParams } from '../../src/relayserver/ServerConfigParams'
import { TransactionManager } from '../../src/relayserver/TransactionManager'
import { Address } from '../../src/relayclient/types/Aliases'
import { Bytes } from 'ethers'

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

export class BadEnvelopingArbiter extends EnvelopingArbiter {
  readonly failSignature: boolean

  constructor (config: Partial<ServerConfigParams>, provider: Web3Provider, failSignature: boolean) {
    super(config, provider)
    this.failSignature = failSignature
  }

  async signCommitment (transactionManager: TransactionManager, signer: Address, message: Bytes): Promise<string> {
    if (this.failSignature) {
      return '0x'
    } else {
      return await transactionManager.workersKeyManager.signMessage(signer, message)
    }
  }
}

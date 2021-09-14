import { ether } from '@openzeppelin/test-helpers'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import TypedRequestData, { getDomainSeparatorHash } from '../../src/common/EIP712/TypedRequestData'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { Address } from '../../src/relayclient/types/Aliases'
import { RelayHubInstance, TestVerifierEverythingAcceptedInstance, TestTokenInstance, IForwarderInstance } from '../../types/truffle-contracts'
import { getLocalEip712Signature } from '../../Utils'

const gasPrice = '1'

export class RelayHelper {
  relayHub: RelayHubInstance
  relayOwner: Address
  relayWorker: Address
  relayManager: Address
  forwarder: IForwarderInstance
  verifier: TestVerifierEverythingAcceptedInstance
  token: TestTokenInstance
  chainId: number

  constructor (
    relayHub: RelayHubInstance,
    relayOwner: Address,
    relayWorker: Address,
    relayManager: Address,
    forwarder: IForwarderInstance,
    verifier: TestVerifierEverythingAcceptedInstance,
    token: TestTokenInstance,
    chainId: number
  ) {
    this.relayHub = relayHub
    this.relayOwner = relayOwner
    this.relayWorker = relayWorker
    this.relayManager = relayManager
    this.forwarder = forwarder
    this.verifier = verifier
    this.token = token
    this.chainId = chainId
  }

  async init (): Promise<void> {
    await this.token.mint('1000', this.forwarder.address)

    await this.relayHub.stakeForAddress(this.relayManager, 1000, {
      from: this.relayOwner,
      value: ether('1'),
      gasPrice: gasPrice
    })

    await this.relayHub.addRelayWorkers([this.relayWorker], { from: this.relayManager, gasPrice: gasPrice })
  }

  async createRelayRequest (from: Address, to: Address): Promise<RelayRequest> {
    const rr: RelayRequest = {
      request: {
        relayHub: this.relayHub.address,
        to: to,
        data: '',
        from: from,
        nonce: (await this.forwarder.nonce()).toString(),
        value: '0',
        gas: '3000000',
        tokenContract: this.token.address,
        tokenAmount: '1',
        tokenGas: '50000',
        enableQos: false
      },
      relayData: {
        gasPrice: gasPrice,
        relayWorker: this.relayWorker,
        callForwarder: this.forwarder.address,
        callVerifier: this.verifier.address,
        domainSeparator: getDomainSeparatorHash(this.forwarder.address, this.chainId)
      }
    }

    rr.request.data = '0xdeadbeef'
    rr.relayData.relayWorker = this.relayWorker

    return rr
  }

  getRelayRequestSignature (relayRequest: RelayRequest, account: AccountKeypair): string {
    const dataToSign = new TypedRequestData(
      this.chainId,
      this.forwarder.address,
      relayRequest
    )
    const signature = getLocalEip712Signature(
      dataToSign,
      account.privateKey
    )

    return signature
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  createCommitmentReceipt () {
    // temporarily hard-coded
    return {
      workerAddress: '0x86c659194f559c76a83fa8238120cfc6cb7440dc',
      commitment: {
        time: 1626784918999,
        from: '0x2F4034C552Bb3A241bB941F8B270FF972507EA09',
        to: '0x1Af2844A588759D0DE58abD568ADD96BB8B3B6D8',
        data: '0xa9059cbb000000000000000000000000d82c5cc006c83e9f0348f6896571aefa5aa2bbc600000000000000000000000000000000000000000000000029a2241af62c0000',
        relayHubAddress: '0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701',
        relayWorker: '0x86c659194f559c76a83fa8238120cfc6cb7440dc',
        enableQos: false,
        signature: '0xcba668ad3ba3a5389bebc3b8211bdbb0e8223f8f2145eb687235d6dc0aead3255618f039becb02dc78bc51575c14a47c547718d52753f4983fb0ba9b5c260c4f1b'
      },
      workerSignature: '0x5cd81b693e0aef3c75085b7e80e89f2bc5220926e369b70dc6f5901d116281d523f958e4578d5ec6fb1c3234cbd6d870ed48f41c94dda84d1203c9d0b6c07e741b'
    }
  }
}

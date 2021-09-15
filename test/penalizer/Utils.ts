import { ether } from '@openzeppelin/test-helpers'
import { ethers } from 'ethers'
import { toChecksumAddress } from 'web3-utils'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import TypedRequestData, { getDomainSeparatorHash } from '../../src/common/EIP712/TypedRequestData'
import { Commitment } from '../../src/enveloping/Commitment'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { Address } from '../../src/relayclient/types/Aliases'
import { RelayHubInstance, TestVerifierEverythingAcceptedInstance, TestTokenInstance, IForwarderInstance } from '../../types/truffle-contracts'
import { getLocalEip712Signature } from '../../Utils'
import { getGaslessAccount } from '../TestUtils'

const gasPrice = '1'

interface CommitmentParams{
  enableQos: boolean
}

interface CommitmentReceipt {
  workerAddress: string | BN
  commitment: {
    time: number | BN | string
    from: string | BN
    to: string | BN
    relayHubAddress: string | BN
    relayWorker: string | BN
    enableQos: boolean
    data: string
    signature: string
  }
  workerSignature: string
}

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

  async createRelayRequest (from: Address, to: Address, relayData: string): Promise<RelayRequest> {
    return {
      request: {
        relayHub: this.relayHub.address,
        to: to,
        data: relayData,
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
  }

  getRelayRequestSignature (relayRequest: RelayRequest, account: AccountKeypair): string {
    const dataToSign = new TypedRequestData(
      this.chainId,
      this.forwarder.address,
      relayRequest
    )
    return getLocalEip712Signature(
      dataToSign,
      account.privateKey
    )
  }

  createReceipt (params: CommitmentParams): CommitmentReceipt {
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
        enableQos: params.enableQos,
        signature: '0x00'
      },
      workerSignature: '0x00'
    }
  }

  async signReceipt (commitmentReceipt: CommitmentReceipt): Promise<void> {
    const worker = await getGaslessAccount()

    const c = commitmentReceipt.commitment
    const commitment = new Commitment(c.time as Number, c.from as string, c.to as string, c.data, c.relayHubAddress as string, c.relayWorker as string, c.enableQos, c.signature)

    const hash = ethers.utils.keccak256(commitment.encodeForSign())
    const digest = ethers.utils.arrayify(hash)

    const signerWallet = new ethers.Wallet(worker.privateKey)
    const sig = await signerWallet.signMessage(digest)

    commitmentReceipt.workerAddress = toChecksumAddress(worker.address)
    commitmentReceipt.workerSignature = sig
  }
}

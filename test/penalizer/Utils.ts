import { ether } from '@openzeppelin/test-helpers'
import { Transaction } from 'ethereumjs-tx'
import { ethers } from 'ethers'
import { toChecksumAddress } from 'web3-utils'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import TypedRequestData, { getDomainSeparatorHash } from '../../src/common/EIP712/TypedRequestData'
import { Commitment } from '../../src/enveloping/Commitment'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import { Address } from '../../src/relayclient/types/Aliases'
import { RelayHubInstance, TestVerifierEverythingAcceptedInstance, TestTokenInstance, IForwarderInstance } from '../../types/truffle-contracts'
import { getLocalEip712Signature } from '../../Utils'

const gasPrice = '1'

interface RelayRequestParams{
  from: Address
  to: Address
  relayData: string
  enableQos?: boolean
}

interface CommitmentParams{
  relayRequest: RelayRequest
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

  async createRelayRequest (params: RelayRequestParams): Promise<RelayRequest> {
    return {
      request: {
        relayHub: this.relayHub.address,
        to: params.to,
        data: params.relayData,
        from: params.from,
        nonce: (await this.forwarder.nonce()).toString(),
        value: '0',
        gas: '3000000',
        tokenContract: this.token.address,
        tokenAmount: '1',
        tokenGas: '50000',
        enableQos: params.enableQos ?? false
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
    const request = params.relayRequest.request
    const relayData = params.relayRequest.relayData
    return {
      workerAddress: relayData.relayWorker,
      commitment: {
        time: 0,
        from: request.from,
        to: request.to,
        data: request.data,
        relayHubAddress: this.relayHub.address,
        relayWorker: relayData.relayWorker,
        enableQos: request.enableQos,
        signature: '0x00'
      },
      workerSignature: '0x00'
    }
  }

  async signReceipt (commitmentReceipt: CommitmentReceipt): Promise<void> {
    const c = commitmentReceipt.commitment
    const commitment = new Commitment(c.time as Number, c.from as string, c.to as string, c.data, c.relayHubAddress as string, c.relayWorker as string, c.enableQos, c.signature)
    const hash = ethers.utils.keccak256(commitment.encodeForSign())

    commitmentReceipt.workerAddress = toChecksumAddress(this.relayWorker)
    commitmentReceipt.workerSignature = await web3.eth.sign(hash, this.relayWorker)
  }
}

export function createRawTx (from: AccountKeypair, to: Address, data: string, gas: string, gasPrice: string): string {
  const txObject = {
    from: from.address,
    to: to,
    data: data,
    gas: web3.utils.toHex(gas),
    gasPrice: web3.utils.toHex(gasPrice)
  }

  const tx = new Transaction(txObject)
  tx.sign(from.privateKey)
  const serializedTx = tx.serialize()

  return '0x' + serializedTx.toString('hex')
}

export async function fundAccount (fundedAccount: Address, destination: Address, ethAmount: string): Promise<void> {
  await web3.eth.sendTransaction({
    from: fundedAccount,
    to: destination,
    value: web3.utils.toWei(ethAmount, 'ether'),
    gasPrice: gasPrice
  })
}

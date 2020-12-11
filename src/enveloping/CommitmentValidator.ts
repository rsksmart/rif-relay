import { Commitment, CommitmentReceipt } from './Commitment'
import { ethers } from 'ethers'

export function validateCommitmentSig (receipt: CommitmentReceipt | undefined): boolean {
  if (typeof receipt !== 'undefined') {
    const commitment = new Commitment(
      receipt.commitment.time,
      receipt.commitment.from,
      receipt.commitment.to,
      receipt.commitment.data,
      receipt.commitment.relayHubAddress,
      receipt.commitment.relayWorker
    )
    const hash = ethers.utils.keccak256(commitment.encodeForSign(receipt.commitment.relayHubAddress))
    const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(hash), receipt.workerSignature)
    if (recoveredAddress.toLowerCase() === receipt.workerAddress.toLowerCase()) {
      return true
    } else {
      console.log('Error: Invalid receipt. Worker signature invalid.')
      return false
    }
  } else {
    return false
  }
}

import log from 'loglevel'
import { Commitment, CommitmentReceipt } from './Commitment'
import { ethers } from 'ethers'

/**
 * The CommitmentValidator can verify a CommitmentReceipt signature
 */
export class CommitmentValidator {
  /**
   * Validates a CommitmentReceipt signature
   * @param receipt the CommitmentReceipt to be validated
   * @return true or false
   */
  validateCommitmentSig (receipt: CommitmentReceipt | undefined): boolean {
    if (typeof receipt !== 'undefined') {
      const commitment = new Commitment(
        receipt.commitment.time,
        receipt.commitment.from,
        receipt.commitment.to,
        receipt.commitment.data,
        receipt.commitment.relayHubAddress,
        receipt.commitment.relayWorker,
        receipt.commitment.enabledQos,
        receipt.commitment.signature
      )
      try {
        const hash = ethers.utils.keccak256(commitment.encodeForSign(receipt.commitment.relayHubAddress))
        const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(hash), receipt.workerSignature)
        if (recoveredAddress.toLowerCase() === receipt.workerAddress.toLowerCase()) {
          return true
        } else {
          log.error('Error: Invalid receipt. Worker signature invalid.')
          return false
        }
      } catch (e) {
        log.error(e)
        return false
      }
    } else {
      return false
    }
  }
}

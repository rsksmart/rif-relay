import { CommitmentValidator } from '../../src/enveloping/CommitmentValidator'
import { CommitmentReceipt } from '../../src/enveloping/Commitment'

export class MockCommitmentValidator extends CommitmentValidator {
  private readonly validateEverything: boolean

  constructor (validateEverything: boolean) {
    super()
    this.validateEverything = validateEverything
  }

  validateCommitmentSig (receipt: CommitmentReceipt | undefined): boolean {
    if (this.validateEverything) {
      return true
    } else {
      return super.validateCommitmentSig(receipt)
    }
  }
}

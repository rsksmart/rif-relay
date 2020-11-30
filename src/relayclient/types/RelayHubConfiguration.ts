import { IntString } from './Aliases'

export interface RelayHubConfiguration {
  gasOverhead: number
  maxWorkerCount: number
  minimumUnstakeDelay: number
  minimumStake: IntString
  maximumRecipientDeposit: IntString
}

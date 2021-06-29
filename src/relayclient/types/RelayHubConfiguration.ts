import { IntString } from './Aliases'

export interface RelayHubConfiguration {
  maxWorkerCount: number
  minimumUnstakeDelay: number
  minimumStake: IntString
  minimumEntryDepositValue: IntString
}

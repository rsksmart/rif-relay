import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../../common/PingResponse'
import { RelayRequest } from '../../common/EIP712/RelayRequest'
import EnvelopingTransactionDetails from './EnvelopingTransactionDetails'
import RelayFailureInfo from './RelayFailureInfo'
import { RelayData } from './RelayData'

export type Address = string
export type IntString = string
export type BoolString = string
/**
 * For legacy reasons, to filter out the relay this filter has to throw.
 * TODO: make ping filtering sane!
 */
export type PingFilter = (pingResponse: PingResponse, transactionDetails: EnvelopingTransactionDetails) => void
export type AsyncDataCallback = (relayRequest: RelayRequest) => Promise<PrefixedHexString>

export type RelayFilter = (relayData: RelayData) => boolean
export type AsyncScoreCalculator = (relay: RelayData, txDetails: EnvelopingTransactionDetails, failures: RelayFailureInfo[]) => Promise<number>

export function notNull<TValue> (value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined
}

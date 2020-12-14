import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../../common/PingResponse'
import RelayRequest from '../../common/EIP712/RelayRequest'
import GsnTransactionDetails from './GsnTransactionDetails'
import RelayFailureInfo from './RelayFailureInfo'
import { RelayRegisteredEventInfo } from './RelayRegisteredEventInfo'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'

export type Address = string
export type IntString = string
/**
 * For legacy reasons, to filter out the relay this filter has to throw.
 * TODO: make ping filtering sane!
 */
export type PingFilter = (pingResponse: PingResponse, gsnTransactionDetails: GsnTransactionDetails) => void
export type AsyncDataCallback = (relayRequest: RelayRequest) => Promise<PrefixedHexString>

export type RelayFilter = (registeredEventInfo: RelayRegisteredEventInfo) => boolean
export type AsyncScoreCalculator = (relay: RelayRegisteredEventInfo, txDetails: GsnTransactionDetails, failures: RelayFailureInfo[]) => Promise<number>

export function notNull<TValue> (value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined
}

/**
 * The only thing that is guaranteed a Web3 provider or a similar object is a {@link send} method.
 */
export interface Web3ProviderBaseInterface {
  send: (
    payload: JsonRpcPayload,
    callback: (error: Error | null, result?: JsonRpcResponse) => void
  ) => void
}
import abi from 'web3-eth-abi'
import { toBN } from 'web3-utils'
import sigUtil from 'eth-sig-util'
import { EventData } from 'web3-eth-contract'
import { JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString } from 'ethereumjs-tx'
import { arrayify } from '@ethersproject/bytes'
import { Address } from '../relayclient/types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'

import TypedRequestData from './EIP712/TypedRequestData'
import chalk from 'chalk'
import { constants } from './Constants'
import { DeployTransactionRequest, RelayTransactionRequest } from '../relayclient/types/RelayTransactionRequest'
import relayHubAbi from './interfaces/IRelayHub.json'
import { DeployRequest, RelayRequest } from './EIP712/RelayRequest'
import TruffleContract = require('@truffle/contract')
import { RelayData } from '../relayclient/types/RelayData'

export function removeHexPrefix (hex: string): string {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'

export function padTo64 (hex: string): string {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

export function event2topic (contract: any, names: string[]): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!contract.options || !contract.options.jsonInterface) { return names }
  if (typeof names === 'string') {
    return event2topic(contract, [names])[0]
  }
  return contract.options.jsonInterface
    .filter((e: any) => names.includes(e.name))
    // @ts-ignore
    .map(abi.encodeEventSignature)
}

export function addresses2topics (addresses: string[]): string[] {
  return addresses.map(address2topic)
}

export function address2topic (address: string): string {
  return '0x' + '0'.repeat(24) + address.toLowerCase().slice(2)
}

// extract revert reason from a revert bytes array.
export function decodeRevertReason (revertBytes: PrefixedHexString, throwOnError = false): string | null {
  if (revertBytes == null) { return null }
  if (!revertBytes.startsWith('0x08c379a0')) {
    if (throwOnError) {
      throw new Error('invalid revert bytes: ' + revertBytes)
    }
    return revertBytes
  }
  // @ts-ignore
  return abi.decodeParameter('string', '0x' + revertBytes.slice(10)) as any
}

export function getLocalEip712Signature (
  typedRequestData: TypedRequestData,
  privateKey: Buffer
): PrefixedHexString {
  // @ts-ignore
  return sigUtil.signTypedData_v4(privateKey, { data: typedRequestData })
}

export async function getEip712Signature (
  web3: Web3,
  typedRequestData: TypedRequestData,
  methodSuffix = '',
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  const senderAddress = typedRequestData.message.from
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  return await new Promise((resolve, reject) => {
    let method
    // @ts-ignore (the entire web3 typing is fucked up)
    if (typeof web3.currentProvider.sendAsync === 'function') {
      // @ts-ignore
      method = web3.currentProvider.sendAsync
    } else {
      // @ts-ignore
      method = web3.currentProvider.send
    }
    method.bind(web3.currentProvider)({
      method: 'eth_signTypedData' + methodSuffix,
      params: [senderAddress, dataToSign],
      from: senderAddress,
      id: Date.now()
    }, (error: Error | string | null, result?: JsonRpcResponse) => {
      if (result?.error != null) {
        error = result.error
      }
      if (error != null || result == null) {
        reject((error as any).message ?? error)
      } else {
        resolve(result.result)
      }
    })
  })
}

/**
 * @returns maximum possible gas consumption by this deploy call
 */
export function calculateDeployTransactionMaxPossibleGas (
  estimatedDeployGas: string,
  estimatedTokenPaymentGas?: string): BN {
  if (estimatedTokenPaymentGas === undefined || estimatedTokenPaymentGas == null || toBN(estimatedTokenPaymentGas).isZero()) {
    // Subsidized case
    return toBN(estimatedDeployGas).add(toBN('12000'))
  } else {
    return toBN(estimatedDeployGas)
  }
}

/**
 * @returns maximum possible gas consumption by this relay call
 * Note that not using the linear fit would result in an Inadequate amount of gas
 * You can add another kind of estimation (a hardcoded value for example) in that "else" statement
 * if you don't then use this function with usingLinearFit = true
 */
export function estimateMaxPossibleRelayCallWithLinearFit (
  relayCallGasLimit: number,
  tokenPaymentGas: number,
  addCushion: boolean = false
): number {
  const cushion = addCushion ? constants.ESTIMATED_GAS_CORRECTION_FACTOR : 1.0

  if (toBN(tokenPaymentGas).isZero()) {
    // Subsidized case
    // y = a0 + a1 * x = 85090.977 + 1.067 * x
    const a0 = Number('85090.977')
    const a1 = Number('1.067')
    const estimatedCost = a1 * relayCallGasLimit + a0
    const costWithCushion = Math.ceil(estimatedCost * cushion)
    return costWithCushion
  } else {
    // y = a0 + a1 * x = 72530.9611 + 1.1114 * x
    const a0 = Number('72530.9611')
    const a1 = Number('1.1114')
    const estimatedCost = a1 * (relayCallGasLimit + tokenPaymentGas) + a0
    const costWithCushion = Math.ceil(estimatedCost * cushion)
    return costWithCushion
  }
}

export function parseHexString (str: string): number[] {
  const result = []
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16))

    str = str.substring(2, str.length)
  }

  return result
}

export function isSameAddress (address1: Address, address2: Address): boolean {
  return address1.toLowerCase() === address2.toLowerCase()
}

export async function sleep (ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export function randomInRange (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min)
}

export function isSecondEventLater (a: EventData, b: EventData): boolean {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex > a.transactionIndex
  }
  return b.blockNumber > a.blockNumber
}

export function getLatestEventData (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(
    (a: EventData, b: EventData) => {
      if (a.blockNumber === b.blockNumber) {
        return b.transactionIndex - a.transactionIndex
      }
      return b.blockNumber - a.blockNumber
    })
  return eventDataSorted[0]
}

export function isRegistrationValid (relayData: RelayData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  const portIncluded: boolean = config.url.indexOf(':') > 0
  return relayData != null &&
    isSameAddress(relayData.manager, managerAddress) &&
      relayData.url.toString() === (config.url.toString() + ((!portIncluded && config.port > 0) ? ':' + config.port.toString() : ''))
}

export interface VerifierGasLimits {
  preRelayedCallGasLimit: string
  postRelayedCallGasLimit: string
}

interface Signature {
  v: number[]
  r: number[]
  s: number[]
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

function isDeployRequest (req: any): boolean {
  let isDeploy = false
  if (req.relayRequest.request.recoverer !== undefined) {
    isDeploy = true
  }
  return isDeploy
}

export function transactionParamDataCost (req: RelayTransactionRequest | DeployTransactionRequest): number {
  // @ts-ignore
  const IRelayHubContract = TruffleContract({
    contractName: 'IRelayHub',
    abi: relayHubAbi
  })
  IRelayHubContract.setProvider(web3.currentProvider, undefined)

  const relayHub = new IRelayHubContract('')

  const isDeploy = isDeployRequest(req)
  const method = isDeploy ? relayHub.contract.methods.deployCall(
    req.relayRequest as DeployRequest, req.metadata.signature) : relayHub.contract.methods.relayCall(
    req.relayRequest as RelayRequest, req.metadata.signature)

  const encodedCall = method.encodeABI() ?? '0x'

  const dataAsByteArray: Uint8Array = arrayify(encodedCall)
  const nonZeroes = nonZeroDataBytes(dataAsByteArray)

  const zeroVals = dataAsByteArray.length - nonZeroes

  return constants.TRANSACTION_GAS_COST + zeroVals * constants.TX_ZERO_DATA_GAS_COST + nonZeroes * constants.TX_NO_ZERO_DATA_GAS_COST
}

function nonZeroDataBytes (data: Uint8Array): number {
  let counter = 0

  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte !== 0) {
      ++counter
    }
  }

  return counter
}

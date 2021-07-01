import chalk from 'chalk'
import sigUtil, { EIP712TypedData } from 'eth-sig-util'
import { BigNumber, providers, Event } from 'ethers'
import { defaultAbiCoder } from 'ethers/lib/utils'
import { IRelayHub } from '../../typechain'
import { Address, PrefixedHexString } from '../relayclient/types/Aliases'
import { constants } from './Constants'

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

export function event2topic (contract: IRelayHub, names: string[]): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  // if (!contract.options || !contract.options.jsonInterface) { return names }
  if (typeof names === 'string') {
    return event2topic(contract, [names])[0]
  }
  return contract.interface.fragments
    .filter((e: any) => names.includes(e.name))
    .map((e: any) => contract.interface.encodeFilterTopics(e, []))
    .flat()
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
  return (defaultAbiCoder.decode(['string'], '0x' + revertBytes.slice(10))).toString()
}

export function getLocalEip712Signature (
  typedRequestData: EIP712TypedData,
  privateKey: Uint8Array
): PrefixedHexString {
  // @ts-ignore
  return sigUtil.signTypedData_v4(privateKey, { data: typedRequestData })
}

export async function getEip712Signature (
  provider: providers.JsonRpcProvider,
  typedRequestData: EIP712TypedData,
  methodSuffix = '',
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  const senderAddress = typedRequestData.message.from
  let dataToSign: EIP712TypedData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  return await provider.send('eth_signTypedData' + methodSuffix, [senderAddress, dataToSign])
  // return await new Promise((resolve, reject) => {
  //   let method
  //   // @ts-ignore (the entire web3 typing is fucked up)
  //   if (typeof web3.currentProvider.sendAsync === 'function') {
  //     // @ts-ignore
  //     method = web3.currentProvider.sendAsync
  //   } else {
  //     // @ts-ignore
  //     method = web3.currentProvider.send
  //   }
  //   method.bind(web3.currentProvider)({
  //     method: 'eth_signTypedData' + methodSuffix,
  //     params: [senderAddress, dataToSign],
  //     from: senderAddress,
  //     id: Date.now()
  //   }, (error: Error | string | null, result?: JsonRpcResponse) => {
  //     if (result?.error != null) {
  //       error = result.error
  //     }
  //     if (error != null || result == null) {
  //       reject((error as any).message ?? error)
  //     } else {
  //       resolve(result.result)
  //     }
  //   })
  // })
}

/**
 * @returns maximum possible gas consumption by this deploy call
 */
export function calculateDeployTransactionMaxPossibleGas (
  estimatedDeployGas: string,
  estimatedTokenPaymentGas?: string): BigNumber {
  if (estimatedTokenPaymentGas === undefined || estimatedTokenPaymentGas == null || BigNumber.from(estimatedTokenPaymentGas).isZero()) {
    // Subsidized case
    return BigNumber.from(estimatedDeployGas).add(BigNumber.from('12000'))
  } else {
    return BigNumber.from(estimatedDeployGas)
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

  if (BigNumber.from(tokenPaymentGas).isZero()) {
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

export function isSecondEventLater (a: Event, b: Event): boolean {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex > a.transactionIndex
  }
  return b.blockNumber > a.blockNumber
}

export function getLatestEventData (events: Event[]): Event | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(
    (a: Event, b: Event) => {
      if (a.blockNumber === b.blockNumber) {
        return b.transactionIndex - a.transactionIndex
      }
      return b.blockNumber - a.blockNumber
    })
  return eventDataSorted[0]
}

// export function isRegistrationValid (registerEvent: Event | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
//   const portIncluded: boolean = config.url.indexOf(':') > 0
//   return registerEvent != null &&
//     isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
//     registerEvent.returnValues.relayUrl.toString() === (config.url.toString() + ((!portIncluded && config.port > 0) ? ':' + config.port.toString() : ''))
// }

export interface VerifierGasLimits {
  preRelayedCallGasLimit: string
  postRelayedCallGasLimit: string
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

// function isDeployRequest (req: any): boolean {
//   let isDeploy = false
//   if (req.relayRequest.request.recoverer !== undefined) {
//     isDeploy = true
//   }
//   return isDeploy
// }

// export function transactionParamDataCost (req: RelayTransactionRequest | DeployTransactionRequest): number {
//   // @ts-ignore
//   const IRelayHubContract = TruffleContract({
//     contractName: 'IRelayHub',
//     abi: relayHubAbi
//   })
//   IRelayHubContract.setProvider(web3.currentProvider, undefined)

//   const relayHub = new IRelayHubContract('')

//   const isDeploy = isDeployRequest(req)
//   const method = isDeploy ? relayHub.contract.methods.deployCall(
//     req.relayRequest as DeployRequest, req.metadata.signature) : relayHub.contract.methods.relayCall(
//     req.relayRequest as RelayRequest, req.metadata.signature)

//   const encodedCall = method.encodeABI() ?? '0x'

//   const dataAsByteArray: Uint8Array = arrayify(encodedCall)
//   const nonZeroes = nonZeroDataBytes(dataAsByteArray)

//   const zeroVals = dataAsByteArray.length - nonZeroes

//   return constants.TRANSACTION_GAS_COST + zeroVals * constants.TX_ZERO_DATA_GAS_COST + nonZeroes * constants.TX_NO_ZERO_DATA_GAS_COST
// }

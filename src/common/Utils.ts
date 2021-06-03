import chalk from 'chalk'
import sigUtil from 'eth-sig-util'
import { Address, PrefixedHexString } from '../relayclient/types/Aliases'
import TypedRequestData from './EIP712/TypedRequestData'

export function getLocalEip712Signature (
  typedRequestData: TypedRequestData,
  privateKey: Uint8Array,
  jsonStringifyRequest = false): PrefixedHexString {
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  // @ts-ignore
  return sigUtil.signTypedData_v4(privateKey, { data: dataToSign })
}

export function removeHexPrefix (hex: string): string {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

export function isSameAddress (address1: Address, address2: Address): boolean {
  return address1.toLowerCase() === address2.toLowerCase()
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

import chalk from 'chalk'
import sigUtil, { EIP712TypedData } from 'eth-sig-util'
import { BigNumber } from 'ethers'
import { Address, PrefixedHexString } from '../relayclient/types/Aliases'
import { constants } from './Constants'

export function getLocalEip712Signature (
  typedRequestData: EIP712TypedData,
  privateKey: Uint8Array
): PrefixedHexString {
  // @ts-ignore
  return sigUtil.signTypedData_v4(privateKey, { data: typedRequestData })
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

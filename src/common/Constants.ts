import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

const dayInSec = 24 * 60 * 60
const weekInSec = dayInSec * 7
const oneEther = ethers.constants.WeiPerEther

export const constants = {
  dayInSec,
  weekInSec,
  oneEther,
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  ZERO_BYTES32: '0x0000000000000000000000000000000000000000000000000000000000000000',
  MAX_UINT256: BigNumber.from('2').pow(BigNumber.from('256')).sub(BigNumber.from('1')),
  MAX_INT256: BigNumber.from('2').pow(BigNumber.from('255')).sub(BigNumber.from('1')),
  MIN_INT256: BigNumber.from('2').pow(BigNumber.from('255')).mul(BigNumber.from('-1')),
  SHA3_NULL_S: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
}
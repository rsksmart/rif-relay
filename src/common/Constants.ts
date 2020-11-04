import BN from 'bn.js'
import { toBN } from 'web3-utils'

const dayInSec = 24 * 60 * 60
const weekInSec = dayInSec * 7
const oneEther = toBN(1e18)

export const constants = {
  dayInSec,
  weekInSec,
  oneEther,
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  ZERO_BYTES32: '0x0000000000000000000000000000000000000000000000000000000000000000',
  MAX_UINT256: new BN('2').pow(new BN('256')).sub(new BN('1')),
  MAX_INT256: new BN('2').pow(new BN('255')).sub(new BN('1')),
  MIN_INT256: new BN('2').pow(new BN('255')).mul(new BN('-1')),
  SHA3_NULL_S: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
}

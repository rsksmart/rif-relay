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
  SHA3_NULL_S: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  // The following constants must be updated accordingly whenever RSKJ updates them
  TRANSACTION_CREATE_CONTRACT_GAS_COST: 53000,
  TRANSACTION_GAS_COST: 21000,
  TX_ZERO_DATA_GAS_COST: 4,
  TX_NO_ZERO_DATA_GAS_COST: 68,
  MAX_ESTIMATED_GAS_DEVIATION: 0.2,
  ESTIMATED_GAS_CORRECTION_FACTOR: 1.0, // TODO: if needed put a correction factor to mitigate RSK node gas miscalculation if execution includes refunds
  INTERNAL_TRANSACTION_ESTIMATE_CORRECTION: 20000, // When estimating the gas an internal call is going to spend, we need to substract some gas inherent to send the parameters to the blockchain
  WAIT_FOR_RECEIPT_RETRIES: 6,
  WAIT_FOR_RECEIPT_INITIAL_BACKOFF: 1000
}

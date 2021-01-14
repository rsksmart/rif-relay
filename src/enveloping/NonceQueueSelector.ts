import { FeesTable } from './FeeEstimator'

/**
 * For each transaction that is submitted, chooses which nonce queue will be used, based on existing rules.
 */
export class NonceQueueSelector {
  /**
   * Returns the recommended gas price for a transaction to be included before the given time, by
   * applying a determined set of rules.
   * @param maxTime the timestamp to use for calculation
   * @param feesTable a fees table to read the gas prices from
   * @return the recommended gas price
   */
  async getQueueGasPrice (maxTime: number, feesTable: FeesTable): Promise<string> {
    const workerIndex = this.applyDelayRule(maxTime)
    let gasPrice = '0'
    switch (workerIndex) {
      case 0:
        gasPrice = feesTable.safeLow.toString()
        break
      case 1:
        gasPrice = feesTable.standard.toString()
        break
      case 2:
        gasPrice = feesTable.fast.toString()
        break
      case 3:
        gasPrice = feesTable.fastest.toString()
        break
    }
    return gasPrice
  }

  /**
   * Returns the address of the worker that could relay a transaction before the given time, applying
   * a determined set of rules to select which nonce queue to use
   * @param maxTime the timestamp to use for calculation
   * @param addresses an array containing a list of relay workers addresses
   * @return the selected worker index
   */
  getQueueWorker (maxTime: number, addresses: string[]): string {
    const workerIndex = this.applyDelayRule(maxTime)
    return addresses[workerIndex]
  }

  /**
   * The default rule is a delay rule. The shorter the distance between now and the given timestamp,
   * the higher the gas price and Tier needed to comply with the request.
   * @param maxTime the timestamp to use for delay calculation
   * @return the selected worker index
   */
  applyDelayRule (maxTime: number): number {
    const delay = (maxTime - Date.now()) / 1000
    let workerIndex = 0
    if (delay > 300) {
      workerIndex = 0
    } else if (delay > 120 && delay <= 300) {
      workerIndex = 1
    } else if (delay > 30 && delay <= 120) {
      workerIndex = 2
    } else {
      workerIndex = 3
    }
    return workerIndex
  }
}

import { FeesTable } from './FeeEstimator'

export class NonceQueueSelector {
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

  getQueueWorker (maxTime: number, addresses: string[]): string {
    const workerIndex = this.applyDelayRule(maxTime)
    return addresses[workerIndex]
  }

  applyDelayRule (maxTime: number): number {
    const delay = maxTime - Date.now()
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

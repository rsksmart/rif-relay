import { PayableWithEmit, PayableWithEmit__factory } from '../../typechain'
import { ethers } from 'hardhat'
import { expect } from 'chai'

describe('PayableWithEmit', () => {
  let sender: PayableWithEmit
  let receiver: PayableWithEmit

  before(async () => {
    const PayableWithEmit = await ethers.getContractFactory("PayableWithEmit") as PayableWithEmit__factory
    const payableWEmit = await PayableWithEmit.deploy()
    receiver = await payableWEmit.deployed()
    const payableWEmitSender = await PayableWithEmit.deploy()
    sender = await payableWEmitSender.deployed()
  })
  it('payable that uses _msgSender()', async () => {
    await sender.doSend(receiver.address, { value: ethers.utils.parseEther('1.0') })
    const event = sender.filters.GasUsed(null, null)
    const eventEmitted = await sender.queryFilter(event)
    expect(eventEmitted[0].event).to.be.eq("GasUsed")
    expect(eventEmitted[0].args.success).to.be.true
  })
})

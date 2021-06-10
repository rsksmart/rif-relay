import { balance, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { expect } from 'chai'
import BN from 'bn.js'
import { evmMineMany, getTestingEnvironment } from './TestUtils'
import { isRsk } from '../src/common/Environments'

import { RelayHubInstance } from '../types/truffle-contracts'
import { constants } from '../src/common/Constants'

const RelayHub = artifacts.require('RelayHub')

contract('StakeManagement', function ([_, relayManager, worker, anyRelayHub, owner, nonOwner]) {
  const initialUnstakeDelay = new BN(4)
  const initialStake = ether('1')

  const maxWorkerCount = 1
  const minimumEntryDepositValue = ether('1')
  const minimumStake = ether('1')
  const minimumUnstakeDelay = 1

  let relayHub: RelayHubInstance

  function testCanStake (relayManager: string): void {
    it('should allow owner to stake for unowned addresses', async function () {
      const { logs } = await relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager,
        owner,
        stake: initialStake,
        unstakeDelay: initialUnstakeDelay
      })
    })

    it('should NOT allow owner to stake for unowned addresses if minimum entry stake is not met', async function () {
      await expectRevert(
        relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
          value: initialStake.sub(ether('0.00000000000001')), // slighlty less than allowed
          from: owner
        }),
        'Insufficient intitial stake'
      )
    })
  }

  function testStakeNotValid (): void {
    it('should report relayManager stake as not valid', async function () {
      const isRelayManagerStaked = await relayHub.isRelayManagerStaked(relayManager)
      expect(isRelayManagerStaked).to.be.false
    })
  }

  describe('with no stake for relay server', function () {
    beforeEach(async function () {
      relayHub = await RelayHub.new(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)
    })

    testStakeNotValid()

    it('should not allow not owner to schedule unlock', async function () {
      await expectRevert(
        relayHub.unlockStake(nonOwner, { from: owner }),
        'not owner'
      )
    })

    it('relay managers cannot stake for themselves', async function () {
      await expectRevert(
        relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
          value: initialStake,
          from: relayManager
        }),
        'caller is the relayManager'
      )
    })

    testCanStake(relayManager)
  })

  describe('with stake deposited for relay server', function () {
    beforeEach(async function () {
      relayHub = await RelayHub.new(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)

      await relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
    })

    it('should not allow to penalize hub', async function () {
      await expectRevert(
        relayHub.penalize(relayManager, nonOwner, { from: anyRelayHub }),
        'Not penalizer'
      )
    })

    it('should allow querying relayManager\'s stake', async function () {
      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
        await relayHub.stakes(relayManager)
      expect(actualOwner).to.equal(owner)
      expect(actualStake).to.be.bignumber.equal(initialStake)
      expect(actualUnstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)
    })

    testCanStake(nonOwner)

    it('should not allow one relayManager stake', async function () {
      await expectRevert(
        relayHub.stakeForAddress(nonOwner, initialUnstakeDelay, { from: relayManager }),
        'sender is a relayManager itself'
      )
    })

    it('owner can increase the relay stake', async function () {
      const addedStake = ether('2')
      const stake = initialStake.add(addedStake)
      const { logs } = await relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
        value: addedStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager,
        stake,
        unstakeDelay: initialUnstakeDelay
      })

      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { stake: actualStake } = await relayHub.stakes(relayManager)
      expect(actualStake).to.be.bignumber.equal(initialStake.add(addedStake))
    })

    it('should allow owner to increase the unstake delay', async function () {
      const newUnstakeDelay = new BN(5)
      const { logs } = await relayHub.stakeForAddress(relayManager, newUnstakeDelay, { from: owner })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager,
        stake: initialStake,
        unstakeDelay: newUnstakeDelay
      })
      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { unstakeDelay: actualUnstakeDelay } = await relayHub.stakes(relayManager)
      expect(actualUnstakeDelay).to.be.bignumber.equal(newUnstakeDelay)
    })

    it('should not allow owner to decrease the unstake delay', async function () {
      await expectRevert(
        relayHub.stakeForAddress(relayManager, initialUnstakeDelay.subn(1), { from: owner }),
        'unstakeDelay cannot be decreased'
      )
    })

    it('not owner cannot stake for owned relayManager address', async function () {
      await expectRevert(
        relayHub.stakeForAddress(relayManager, initialUnstakeDelay, { from: nonOwner }),
        'not owner'
      )
    })

    it('should not allow owner to withdraw stakes when not scheduled', async function () {
      await expectRevert(relayHub.withdrawStake(relayManager, { from: owner }), 'Withdrawal is not scheduled')
    })

    describe('should not allow not owner to call to', function () {
      it('unlock stake', async function () {
        await expectRevert(relayHub.unlockStake(relayManager, { from: nonOwner }), 'not owner')
      })
      it('withdraw stake', async function () {
        await expectRevert(relayHub.withdrawStake(relayManager, { from: nonOwner }), 'not owner')
      })
    })
  })

  describe('with authorized hub', function () {
    beforeEach(async function () {
      relayHub = await RelayHub.new(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)

      await relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
    })

    it('should report relayManager stake as valid for the authorized hub', async function () {
      const isRelayManagerStaked = await relayHub.isRelayManagerStaked(relayManager)
      expect(isRelayManagerStaked).to.be.true
    })

    describe('should report relayManager stake as not valid for', function () {
      it('not staked relayManager', async function () {
        const isRelayManagerStaked = await relayHub.isRelayManagerStaked(nonOwner)
        expect(isRelayManagerStaked).to.be.false
      })
    })

    it('should allow owner to schedule stake unlock', async function () {
      const { logs, receipt } = await relayHub.unlockStake(relayManager, { from: owner })
      const withdrawBlock = initialUnstakeDelay.addn(receipt.blockNumber)
      expectEvent.inLogs(logs, 'StakeUnlocked', {
        relayManager,
        owner,
        withdrawBlock
      })
    })
  })

  describe('with scheduled deauthorization of an authorized hub', function () {
    beforeEach(async function () {
      relayHub = await RelayHub.new(anyRelayHub, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)

      await relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await relayHub.addRelayWorkers([worker], { from: relayManager })
      await relayHub.unlockStake(relayManager, { from: owner })
    })

    describe('after grace period elapses', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay.toNumber())
      })

      it('should not allow to penalize hub', async function () {
        await expectRevert(
          relayHub.penalize(worker, nonOwner, { from: anyRelayHub }),
          'RelayManager not staked'
        )
      })
    })
  })

  describe('with scheduled unlock while hub still authorized', function () {
    beforeEach(async function () {
      relayHub = await RelayHub.new(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)

      await relayHub.stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await relayHub.unlockStake(relayManager, { from: owner })
    })

    testStakeNotValid()

    it('should not allow owner to schedule unlock again', async function () {
      await expectRevert(
        relayHub.unlockStake(relayManager, { from: owner }),
        'already pending'
      )
    })

    it('should not allow owner to withdraw stakes before it is due', async function () {
      await expectRevert(relayHub.withdrawStake(relayManager, { from: owner }), 'Withdrawal is not due')
    })

    it('should allow to withdraw stake after unstakeDelay', async function () {
      const env = await getTestingEnvironment()

      await evmMineMany(initialUnstakeDelay.toNumber())
      const relayOwnerBalanceTracker = await balance.tracker(owner)
      const stakeBalanceTracker = await balance.tracker(relayHub.address)

      // We call unstake with a gasPrice of zero to accurately measure the balance change in the relayOwner.
      // RSK doesn't support using a gasPrice lower than block's minimum, using 1 instead of 0 here.
      const { logs } = await relayHub.withdrawStake(relayManager, {
        from: owner,
        gasPrice: 1
      })
      expectEvent.inLogs(logs, 'StakeWithdrawn', {
        relayManager,
        amount: initialStake
      })

      const relayOwnerGain = await relayOwnerBalanceTracker.delta()
      const stakeLoss = await stakeBalanceTracker.delta()

      const rskDifference: number = isRsk(env) ? 30000 : 0
      const difference = relayOwnerGain.sub(initialStake)

      // expect(relayOwnerGain).to.be.bignumber.equal(initialStake)
      expect(difference).to.be.bignumber.at.most(new BN(rskDifference))
      expect(stakeLoss).to.be.bignumber.equal(initialStake.neg())
    })

    describe('with stake withdrawn', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay.toNumber())
        await relayHub.withdrawStake(relayManager, { from: owner })
      })

      it('should have no memory of removed relayManager', async function () {
        // @ts-ignore (typechain does not declare names or iterator for return types)
        const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
          await relayHub.stakes(relayManager)
        expect(actualOwner).to.equal(constants.ZERO_ADDRESS)
        expect(actualStake).to.be.bignumber.equal(new BN(0))
        expect(actualUnstakeDelay).to.be.bignumber.equal(new BN(0))
      })

      testCanStake(nonOwner)
    })
  })
})

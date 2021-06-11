import { expect } from 'chai'
import { evmMineMany, getTestingEnvironment } from './TestUtils'
import { isRsk } from '../src/common/Environments'
import { ethers } from 'hardhat'
import { constants } from '../src/common/Constants'
import { BigNumber } from 'ethers'
import { Penalizer, Penalizer__factory, RelayHub, RelayHub__factory } from '../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('StakeManagement', () => {
  const initialUnstakeDelay = BigNumber.from(4)
  const initialStake = ethers.utils.parseEther('1')
  let owner: string
  let nonOwner: string
  let relayManager: string
  const maxWorkerCount = 1
  const minimumEntryDepositValue = ethers.utils.parseEther('1')
  const minimumStake = ethers.utils.parseEther('1')
  const minimumUnstakeDelay = 1
  let RelayHubFactory: RelayHub__factory
  let Penalizer: Penalizer__factory
  let relayHub: RelayHub
  let penalizer: Penalizer
  let relayManagerSigner: SignerWithAddress
  let ownerSigner: SignerWithAddress
  let anyRelayHubSigner: SignerWithAddress
  let nonOwnerSigner: SignerWithAddress

  before(async () => {
    RelayHubFactory = await ethers.getContractFactory('RelayHub') as RelayHub__factory
    Penalizer = await ethers.getContractFactory('Penalizer') as Penalizer__factory
    const signer = await ethers.getSigners()
    owner = await signer[0].getAddress()
    relayManagerSigner = signer[1]
    ownerSigner = signer[0]
    anyRelayHubSigner = signer[2]
    nonOwnerSigner = signer[3]
    relayManager = await relayManagerSigner.getAddress()
    nonOwner = await nonOwnerSigner.getAddress()
    owner = await ownerSigner.getAddress()
  })

  function testCanStakeWithRelayManager (): void {
    it('should allow owner to stake for unowned addresses', async function () {
      await expect(relayHub.connect(ownerSigner).stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake
      })).to.emit(relayHub, 'StakeAdded').withArgs(
        relayManager,
        owner,
        initialStake,
        initialUnstakeDelay
      )
    })

    it('should NOT allow owner to stake for unowned addresses if minimum entry stake is not met', async function () {
      await expect(
        relayHub.connect(ownerSigner).stakeForAddress(relayManager, initialUnstakeDelay, {
          value: initialStake.sub(ethers.utils.parseEther('0.00000000000001')) // slighlty less than allowed
        })
      ).to.revertedWith('revert Insufficient intitial stake')
    })
  }

  function testCanStakeWithNonOwner (): void {
    it('should allow owner to stake for unowned addresses', async function () {
      await expect(relayHub.connect(ownerSigner).stakeForAddress(nonOwner, initialUnstakeDelay, {
        value: initialStake
      })).to.emit(relayHub, 'StakeAdded').withArgs(
        nonOwner,
        owner,
        initialStake,
        initialUnstakeDelay
      )
    })

    it('should NOT allow owner to stake for unowned addresses if minimum entry stake is not met', async function () {
      await expect(
        relayHub.connect(ownerSigner).stakeForAddress(nonOwner, initialUnstakeDelay, {
          value: initialStake.sub(ethers.utils.parseEther('0.00000000000001')) // slighlty less than allowed
        })
      ).to.revertedWith('revert Insufficient intitial stake')
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
      penalizer = await Penalizer.deploy()
      relayHub = await RelayHubFactory.deploy(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)
      await relayHub.deployed()
    })

    testStakeNotValid()

    it('should not allow not owner to schedule unlock', async function () {
      await expect(
        relayHub.connect(ownerSigner).unlockStake(nonOwner)).to.be.revertedWith(
        'revert not owner')
    })

    it('relay managers cannot stake for themselves', async function () {
      await expect(
        relayHub.connect(relayManagerSigner).stakeForAddress(relayManager, initialUnstakeDelay, {
          value: initialStake
        })
      ).to.be.revertedWith(
        'revert caller is the relayManager'
      )
    })

    testCanStakeWithRelayManager()
  })

  describe('with stake deposited for relay server', function () {
    beforeEach(async function () {
      relayHub = await RelayHubFactory.deploy(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)
      await relayHub.deployed()
      await relayHub.connect(ownerSigner).stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake
      })
    })

    it('should not allow to penalize hub', async function () {
      await expect(
        relayHub.connect(anyRelayHubSigner).penalize(relayManager, nonOwner)).to.be.revertedWith(
        'Not penalizer'
      )
    })

    it('should allow querying relayManager\'s stake', async function () {
      const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
      await relayHub.stakes(relayManager)
      expect(actualStake).to.be.equal(initialStake)
      expect(actualUnstakeDelay).to.be.equal(initialUnstakeDelay)
      expect(actualOwner).to.equal(owner)
    })

    testCanStakeWithNonOwner()

    it('should not allow one relayManager stake', async function () {
      await expect(
        relayHub.connect(relayManagerSigner).stakeForAddress(nonOwner, initialUnstakeDelay)).to.be.revertedWith(
        'revert sender is a relayManager itself'
      )
    })

    it('owner can increase the relay stake', async function () {
      const addedStake = ethers.utils.parseEther('2')
      const stake = initialStake.add(addedStake)
      await expect(relayHub.connect(ownerSigner).stakeForAddress(relayManager, initialUnstakeDelay, {
        value: addedStake
      })).to.emit(relayHub, 'StakeAdded').withArgs(
        relayManager,
        owner,
        stake,
        initialUnstakeDelay
      )

      const { stake: actualStake } = await relayHub.stakes(relayManager)
      expect(actualStake).to.be.equal(initialStake.add(addedStake))
    })

    it('should allow owner to increase the unstake delay', async function () {
      const newUnstakeDelay = BigNumber.from(5)
      await expect(relayHub.stakeForAddress(relayManager, newUnstakeDelay, { from: owner })).to.emit(
        relayHub, 'StakeAdded').withArgs(
        relayManager,
        owner,
        initialStake,
        newUnstakeDelay
      )
      const { unstakeDelay: actualUnstakeDelay } = await relayHub.stakes(relayManager)
      expect(actualUnstakeDelay).to.be.equal(newUnstakeDelay)
    })

    it('should not allow owner to decrease the unstake delay', async function () {
      await expect(
        relayHub.connect(ownerSigner).stakeForAddress(relayManager, initialUnstakeDelay.sub(1))
      ).to.be.revertedWith(
        'unstakeDelay cannot be decreased'
      )
    })

    it('not owner cannot stake for owned relayManager address', async function () {
      await expect(
        relayHub.connect(nonOwnerSigner).stakeForAddress(relayManager, initialUnstakeDelay)).revertedWith(
        'revert not owner'
      )
    })

    it('should not allow owner to withdraw stakes when not scheduled', async function () {
      await expect(relayHub.connect(ownerSigner).withdrawStake(relayManager)).to.revertedWith('revert Withdrawal is not scheduled')
    })

    describe('should not allow not owner to call to', function () {
      it('unlock stake', async function () {
        await expect(relayHub.connect(nonOwnerSigner).unlockStake(relayManager)).to.revertedWith('revert not owner')
      })
      it('withdraw stake', async function () {
        await expect(relayHub.connect(nonOwnerSigner).withdrawStake(relayManager)).to.revertedWith('revert not owner')
      })
    })
  })

  describe('with authorized hub', function () {
    beforeEach(async function () {
      relayHub = await RelayHubFactory.deploy(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)
      await relayHub.deployed()
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
      const tx = await relayHub.connect(ownerSigner).unlockStake(relayManager)
      const receipt = await tx.wait()

      const event = relayHub.filters.StakeUnlocked(null, null, null)
      const eventEmitted = await relayHub.queryFilter(event)
      expect(eventEmitted[0].event).to.be.equal('StakeUnlocked')
      expect(eventEmitted[0].args.relayManager).to.be.equal(relayManager)
      expect(eventEmitted[0].args.owner).to.be.equal(owner)
      const withdrawBlock = initialUnstakeDelay.add(receipt.blockNumber)
      expect(eventEmitted[0].args.withdrawBlock).to.be.equal(withdrawBlock)

      // expectEvent.inLogs(logs, 'StakeUnlocked', {
      //   relayManager,
      //   owner,
      //   withdrawBlock
      // })
    })
  })

  describe('with unlock scheduled', function () {
    beforeEach(async function () {
      penalizer = await Penalizer.deploy()
      await penalizer.deployed()
      relayHub = await RelayHubFactory.deploy(constants.ZERO_ADDRESS, maxWorkerCount,
        minimumEntryDepositValue, minimumUnstakeDelay, minimumStake)
      await relayHub.deployed()
      await relayHub.connect(ownerSigner).stakeForAddress(relayManager, initialUnstakeDelay, {
        value: initialStake
      })
      await relayHub.connect(ownerSigner).unlockStake(relayManager)
    })

    testStakeNotValid()

    it('should not allow owner to schedule unlock again', async function () {
      await expect(
        relayHub.connect(ownerSigner).unlockStake(relayManager)).to.revertedWith(
        'already pending'
      )
    })

    it('should not allow owner to withdraw stakes before it is due', async function () {
      await expect(relayHub.connect(ownerSigner).withdrawStake(relayManager)).to.revertedWith('Withdrawal is not due')
    })

    it('should allow to withdraw stake after unstakeDelay', async function () {
      const env = await getTestingEnvironment()

      await evmMineMany(initialUnstakeDelay.toNumber())
      const relayOwnerBalance = await ethers.provider.getBalance(owner)
      const stakeBalance = await ethers.provider.getBalance(relayHub.address)

      // We call unstake with a gasPrice of zero to accurately measure the balance change in the relayOwner.
      // RSK doesn't support using a gasPrice lower than block's minimum, using 1 instead of 0 here.
      await expect(relayHub.connect(ownerSigner).withdrawStake(relayManager, {
        gasPrice: 1
      })).to.emit(
        relayHub, 'StakeWithdrawn').withArgs(
        relayManager,
        owner,
        initialStake
      )

      const newRelayOwnerBalance = await ethers.provider.getBalance(owner)
      const newStakeBalance = await ethers.provider.getBalance(relayHub.address)

      const relayOwnerGain = newRelayOwnerBalance.sub(relayOwnerBalance)
      const stakeLoss = newStakeBalance.sub(stakeBalance)

      const rskDifference: number = isRsk(env) ? 30000 : 0
      const difference = relayOwnerGain.sub(initialStake)

      // expect(relayOwnerGain).to.be.bignumber.equal(initialStake)
      expect(difference).to.be.at.most(BigNumber.from(rskDifference))
      expect(stakeLoss).to.be.equal(initialStake.mul(-1))
    })

    describe('with stake withdrawn', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay.toNumber())
        await relayHub.connect(ownerSigner).withdrawStake(relayManager)
      })

      it('should have no memory of removed relayManager', async function () {
        const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
          await relayHub.stakes(relayManager)
        expect(actualOwner).to.equal(constants.ZERO_ADDRESS)
        expect(actualStake).to.be.equal(BigNumber.from(0))
        expect(actualUnstakeDelay).to.be.equal(BigNumber.from(0))
      })
      testCanStakeWithNonOwner()
    })
  })
})

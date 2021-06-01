import { RelayHubConfiguration } from '../src/relayclient/types/RelayHubConfiguration'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { deployHub } from './TestUtils'
import { Penalizer, Penalizer__factory, RelayHub } from '../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('RelayHub Relay Management', function () {
  let relayHub: RelayHub
  let penalizer: Penalizer
  let anAccountSigner: SignerWithAddress
  let relayOwnerSigner: SignerWithAddress
  let relayManagerSigner: SignerWithAddress
  let relayWorkerSigner1: SignerWithAddress
  let relayWorkerSigner2: SignerWithAddress
  let relayWorkerSigner3: SignerWithAddress
  let relayOwner: string
  let relayManager: string
  let relayWorker1: string
  let relayWorker2: string
  let relayWorker3: string
  const relayUrl = 'http://new-relay.com'
  const maxWorkerCount = 3
  const gasOverhead = 1000
  const minimumEntryDepositValue = ethers.utils.parseEther('1').toString()
  const minimumStake = ethers.utils.parseEther('1').toString()
  const minimumUnstakeDelay = 50

  const hubConfig: Partial<RelayHubConfiguration> = {
    maxWorkerCount,
    gasOverhead,
    minimumEntryDepositValue,
    minimumStake,
    minimumUnstakeDelay
  }

  beforeEach(async function () {
    [anAccountSigner, relayOwnerSigner, relayManagerSigner, 
        relayWorkerSigner1, relayWorkerSigner2, relayWorkerSigner3] = await ethers.getSigners()
    relayOwner = await relayOwnerSigner.getAddress()
    relayManager = await relayManagerSigner.getAddress()
    relayWorker1 = await relayWorkerSigner1.getAddress()
    relayWorker2 = await relayWorkerSigner2.getAddress()
    relayWorker3 = await relayWorkerSigner3.getAddress()
    const Penalizer = await ethers.getContractFactory('Penalizer') as Penalizer__factory
    penalizer = await Penalizer.deploy()
    await penalizer.deployed()
    relayHub = await deployHub(penalizer.address, hubConfig)
  })

  context('without stake for relayManager', function () {
    it('should not allow relayManager to add relay workers', async function () {
      await expect(
        relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker1])).to.revertedWith(
        'RelayManager not staked')
    })
    context('after stake unlocked for relayManager', function () {
      beforeEach(async function () {
        await relayHub.connect(relayOwnerSigner).stakeForAddress(relayManager, 2000, {
          value: ethers.utils.parseEther('2')
        })
        await relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker1])
        await relayHub.connect(relayOwnerSigner).unlockStake(relayManager)
      })

      it('should not allow relayManager to register a relay server', async function () {
        await expect(
          relayHub.connect(relayManagerSigner).registerRelayServer(relayUrl)).to.revertedWith(
          'RelayManager not staked')
      })
    })
  })

  context('with stake for relayManager and no active workers added', function () {
    beforeEach(async function () {
      await relayHub.connect(relayOwnerSigner).stakeForAddress(relayManager, 2000, {
        value: ethers.utils.parseEther('2')
      })
    })

    it('should not allow relayManager to register a relay server', async function () {
      await expect(
        relayHub.connect(relayManagerSigner).registerRelayServer(relayUrl)).to.revertedWith
        ('no relay workers')
    })

    it('should allow relayManager to add multiple workers', async function () {
      const newRelayWorkers = [relayWorker1, relayWorker2, relayWorker3]
      await expect(relayHub.connect(relayManagerSigner).addRelayWorkers(newRelayWorkers)).to.emit(relayHub, 'RelayWorkersAdded')
      .withArgs(
        relayManager,
        newRelayWorkers,
        '3'
      )
    })

    it('should not allow relayManager to register already registered workers', async function () {
      await relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker1])
      await expect(
        relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker1])).to.revertedWith(
        'this worker has a manager')
    })
  })

  context('with stake for relay manager and active relay workers', function () {
    beforeEach(async function () {
      await relayHub.connect(relayOwnerSigner).stakeForAddress(relayManager, 2000, {
        value: ethers.utils.parseEther('2')
      })
      await relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker1])
    })

    it('should not allow relayManager to exceed allowed number of workers', async function () {
      const newRelayWorkers = []
      for (let i = 0; i < 11; i++) {
        newRelayWorkers.push(relayWorker1)
      }
      await expect(
        relayHub.connect(relayManagerSigner).addRelayWorkers(newRelayWorkers)).to.revertedWith(
        'too many workers')
    })

    it('should allow relayManager to update transaction fee and url', async function () {
    await expect(relayHub.connect(relayManagerSigner).registerRelayServer(relayUrl)).to.emit(
      relayHub, 'RelayServerRegistered').withArgs(
        relayManager,
        relayUrl
      )
    })
  })
})

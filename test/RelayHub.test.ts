import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  createSmartWalletFactory,
  createSmartWallet,
} from './TestUtils'
import { BigNumber, /*Wallet, constants*/ } from 'ethers'
import {
  //EnvelopingTypes,
  UtilToken,
  IForwarder,
  CustomSmartWalletFactory,
  SmartWalletFactory,
  Penalizer,
  RelayHub,
} from '@rsksmart/rif-relay-contracts'
import {
  //TestDeployVerifierEverythingAccepted,
  TestRecipient,
  TestVerifierEverythingAccepted,
} from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { RelayRequest } from '@rsksmart/rif-relay-client'
//import { defaultEnvironment } from '@rsksmart/rif-relay-server';

const stripHex = (s: string): string => {
  return s.slice(2, s.length)
}

describe('RelayHub', function () {
  let penalizer: Penalizer
  let relayHub: RelayHub
  let verifier: TestVerifierEverythingAccepted
  let deployVerifier: TestDeployVerifierEverythingAccepted
  let recipient: TestRecipient
  let token: UtilToken
  let forwarder: IForwarder
  let factory: CustomSmartWalletFactory | SmartWalletFactory
  let sharedRelayRequestData: RelayRequest
  let relayWorker: SignerWithAddress
  let relayManager: SignerWithAddress
  let relayOwner: SignerWithAddress
  let fundedAccount: SignerWithAddress
  let relayHubSigner: SignerWithAddress

  beforeEach(async function () {
    const penalizerFactory = await ethers.getContractFactory('Penalizer')
    penalizer = await penalizerFactory.deploy()

    //const { relayHubConfiguration } = defaultEnvironment!;

    const relayHubFactory = await ethers.getContractFactory('RelayHub')

    relayHub = await relayHubFactory.deploy(
      penalizer.address,
      10,
      (1e18).toString(),
      1000,
      (1e18).toString(),
    )

    verifier = await ethers
      .getContractFactory('TestVerifierEverythingAccepted')
      .then((contractFactory) => contractFactory.deploy())
    deployVerifier = await ethers
      .getContractFactory('TestDeployVerifierEverythingAccepted')
      .then((contractFactory) => contractFactory.deploy())

    const smartWalletTemplate = await ethers
      .getContractFactory('SmartWallet')
      .then((contractFactory) => contractFactory.deploy())

    const provider = ethers.provider
    const owner = ethers.Wallet.createRandom().connect(provider)

    ;[
      relayWorker,
      relayManager,
      relayOwner,
      fundedAccount,
      relayHubSigner,
    ] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
    ]

    //Fund the owner
    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    })

    factory = await createSmartWalletFactory(smartWalletTemplate, false, owner)
    recipient = await ethers
      .getContractFactory('TestRecipient')
      .then((contractFactory) => contractFactory.deploy())
    token = await ethers
      .getContractFactory('UtilToken')
      .then((contractFactory) => contractFactory.deploy())

    //const sender = await ethers.getSigner(relayHub.address)

    forwarder = await createSmartWallet({
      relayHub: relayHubSigner.address,
      factory,
      owner,
      sender: relayHubSigner,
    })

    await token.mint('1000', forwarder.address)

    sharedRelayRequestData = {
      request: {
        relayHub: relayHub.address,
        to: recipient.address,
        data: '',
        from: owner.address,
        nonce: (await forwarder.nonce()).toString(),
        value: '0',
        gas: '3000000',
        tokenContract: token.address,
        tokenAmount: '1',
        tokenGas: '50000',
        validUntilTime: '0',
      },
      relayData: {
        gasPrice: '1',
        feesReceiver: relayWorker.address,
        callForwarder: forwarder.address,
        callVerifier: verifier.address,
      },
    }
  })
  describe('#add/disable relay workers', function () {
    it('should register and allow to disable new relay workers', async function () {
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      })

      const relayWorkersBefore = await relayHub.workerCount(
        relayManager.address,
      )

      expect(relayWorkersBefore.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`,
      )

      const addRelayWorkersTrx = await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address])
      await addRelayWorkersTrx.wait()
      const relayWorkersAddedFilter = relayHub.filters.RelayWorkersAdded()

      const [relayWorkersAddedEvent] = await relayHub.queryFilter(
        relayWorkersAddedFilter,
      )

      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.relayManager.toLowerCase(),
      )
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.newRelayWorkers[0]?.toLowerCase(),
      )
      expect(BigNumber.from(1)).to.equal(
        relayWorkersAddedEvent?.args.workersCount,
      )

      const relayWorkersAfter = await relayHub.workerCount(relayManager.address)
      expect(relayWorkersAfter.toNumber()).to.equal(1, 'Workers must be one')

      const manager = await relayHub.workerToManager(relayWorker.address)

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      const expectedManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1')),
      )

      expect(manager.toLowerCase()).to.equal(
        expectedManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`,
      )

      const disableWorkerTrx = await relayHub
        .connect(relayManager)
        .disableRelayWorkers([relayWorker.address])

      await disableWorkerTrx.wait()
      const disableWorkerFilter = relayHub.filters.RelayWorkersDisabled()
      const [relayWorkersDisabledEvent] = await relayHub.queryFilter(
        disableWorkerFilter,
      )

      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersDisabledEvent?.args.relayManager.toLowerCase(),
      )
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersDisabledEvent?.args.relayWorkers[0]?.toLowerCase(),
      )
      expect(BigNumber.from(0)).to.equal(
        relayWorkersDisabledEvent?.args.workersCount,
      )

      const workersCountAfterDisable = await relayHub.workerCount(
        relayManager.address,
      )
      expect(workersCountAfterDisable.toNumber()).equal(
        0,
        'Workers must be zero',
      )

      const disabledManager = await relayHub.workerToManager(
        relayWorker.address,
      )
      const expectedInvalidManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('0')),
      )
      expect(disabledManager.toLowerCase()).to.equal(
        expectedInvalidManager.toLowerCase(),
        `Incorrect relay manager: ${disabledManager}`,
      )
    })

    it('should fail to disable more relay workers than available', async function () {
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      })

      const relayWorkersBefore = await relayHub.workerCount(
        relayManager.address,
      )

      expect(relayWorkersBefore.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`,
      )

      const addRelayWorkersTrx = await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address])
      await addRelayWorkersTrx.wait()
      const relayWorkersAddedFilter = relayHub.filters.RelayWorkersAdded()

      const [relayWorkersAddedEvent] = await relayHub.queryFilter(
        relayWorkersAddedFilter,
      )

      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.relayManager.toLowerCase(),
      )
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.newRelayWorkers[0]?.toLowerCase(),
      )
      expect(BigNumber.from(1)).to.equal(
        relayWorkersAddedEvent?.args.workersCount,
      )

      const relayWorkersAfter = await relayHub.workerCount(relayManager.address)
      expect(relayWorkersAfter.toNumber()).to.equal(1, 'Workers must be one')

      const manager = await relayHub.workerToManager(relayWorker.address)

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      const expectedManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1')),
      )

      expect(manager.toLowerCase()).to.equal(
        expectedManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`,
      )

      const disableWorkerTrx = relayHub
        .connect(relayManager)
        .disableRelayWorkers([relayWorker.address, relayWorker.address])

      await expect(disableWorkerTrx).to.be.revertedWith(
        'invalid quantity of workers',
      )

      const workersCountAfterDisable = await relayHub.workerCount(
        relayManager.address,
      )
      expect(workersCountAfterDisable.toNumber()).equal(1, 'Workers must be 1')

      const disabledManager = await relayHub.workerToManager(
        relayWorker.address,
      )
      const expectedInvalidManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1')),
      )
      expect(disabledManager.toLowerCase()).to.equal(
        expectedInvalidManager.toLowerCase(),
        `Incorrect relay manager: ${disabledManager}`,
      )
    })

    it('should only allow the corresponding relay manager to disable their respective relay workers', async function () {
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      })

      const [
        incorrectRelayManager,
        incorrectWorker,
      ] = (await ethers.getSigners()) as [SignerWithAddress, SignerWithAddress]

      await relayHub
        .connect(relayOwner)
        .stakeForAddress(incorrectRelayManager.address, 1000, {
          value: ethers.utils.parseEther('1'),
        })

      const relayWorkers = await relayHub.workerCount(relayManager.address)

      const relayWorkersIncorrect = await relayHub.workerCount(
        incorrectRelayManager.address,
      )

      expect(relayWorkers.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkers.toNumber()}`,
      )

      expect(relayWorkersIncorrect.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkers.toNumber()}`,
      )

      await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address])

      await relayHub
        .connect(incorrectRelayManager)
        .addRelayWorkers([incorrectWorker.address])

      const workersAfterAdd = await relayHub.workerCount(relayManager.address)

      const workersIncorrectAfterAdd = await relayHub.workerCount(
        incorrectRelayManager.address,
      )

      expect(workersAfterAdd.toNumber()).equal(1, 'Workers must be 1')

      expect(workersIncorrectAfterAdd.toNumber()).equal(1, 'Workers must be 1')

      const manager = await relayHub.workerToManager(relayWorker.address)

      const managerIncorrectWorker = await relayHub.workerToManager(
        incorrectWorker.address,
      )

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      const expectedManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1')),
      )
      const expectedIncorrectManager = '0x00000000000000000000000'.concat(
        stripHex(incorrectRelayManager.address.concat('1')),
      )

      expect(manager.toLowerCase()).to.equal(
        expectedManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`,
      )

      expect(managerIncorrectWorker.toLowerCase()).to.equal(
        expectedIncorrectManager.toLowerCase(),
        `Incorrect relay manager: ${managerIncorrectWorker}`,
      )

      const disableWorkerTrx = relayHub
        .connect(incorrectRelayManager)
        .disableRelayWorkers([relayWorker.address])

      await expect(disableWorkerTrx).to.be.revertedWith('Incorrect Manager')

      const workersAfterDisable = await relayHub.workerCount(
        incorrectRelayManager.address,
      )

      expect(workersAfterDisable.toNumber()).to.equal(
        1,
        "Workers shouldn't have changed",
      )

      const queriedManager = await relayHub.workerToManager(relayWorker.address)

      const expectedRelayManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1')),
      )

      expect(queriedManager.toLowerCase()).to.equal(
        expectedRelayManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`,
      )

      const queriedManagerIncorrectWorker = await relayHub.workerToManager(
        incorrectWorker.address,
      )

      expect(queriedManagerIncorrectWorker.toLowerCase()).to.equal(
        expectedIncorrectManager.toLowerCase(),
        `Incorrect relay manager: ${queriedManagerIncorrectWorker}`,
      )
    })
  })

  describe('relayCall', function () {
    it.only('should retrieve version number', async function () {
      const version = await relayHub.versionHub()
      expect(version).to.match(/2\.\d*\.\d*-?.*\+enveloping\.hub\.irelayhub/)
    })

    context('with unknown worker', function () {
      /*it('should not accept a relay call with a disabled worker - 2', async function () {
        const gas = 4e6

        const relayRequest = cloneRelayRequest(sharedRelayRequestData)
        relayRequest.request.data = '0xdeadbeef'
        relayRequest.relayData.feesReceiver = unknownWorker

        const dataToSign = new TypedRequestData(
          chainId,
          forwarder,
          relayRequest,
        )
        const signature = getLocalEip712Signature(
          dataToSign,
          gaslessAccount.privateKey,
        )

        await expectRevert(
          relayHubInstance.relayCall(relayRequest, signature, {
            from: unknownWorker,
            gas,
          }),
          'Not an enabled worker',
        )
      })*/
    })
  })
})

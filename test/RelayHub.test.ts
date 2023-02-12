import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  createSmartWalletFactory,
  createSmartWallet,
  getSuffixDataAndSignature,
  deployRelayHub,
  getExistingGaslessAccount,
} from './TestUtils'
import { BigNumber, Wallet, constants } from 'ethers'
import {
  EnvelopingTypes,
  UtilToken,
  IForwarder,
  CustomSmartWallet__factory,
  UtilToken__factory,
  CustomSmartWallet,
  CustomSmartWalletFactory,
  SmartWalletFactory,
  IWalletCustomLogic,
  Penalizer,
  RelayHub,
} from '@rsksmart/rif-relay-contracts'
import {
  FailureCustomLogic,
  FailureCustomLogic__factory,
  ProxyCustomLogic,
  ProxyCustomLogic__factory,
  SuccessCustomLogic,
  SuccessCustomLogic__factory,
  TestDeployVerifierEverythingAccepted,
  TestForwarderTarget,
  TestRecipient,
  TestVerifierEverythingAccepted,
} from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { RelayRequest } from '@rsksmart/rif-relay-client'

async function fillTokens(
  token: UtilToken,
  recipient: string,
  amount: string,
): Promise<void> {
  await token.mint(amount, recipient)
}

async function getTokenBalance(
  token: UtilToken,
  account: string,
): Promise<BigNumber> {
  return token.balanceOf(account)
}

function createRequest(
  request: Partial<IForwarder.ForwardRequestStruct>,
  relayData: Partial<EnvelopingTypes.RelayDataStruct>,
): EnvelopingTypes.RelayRequestStruct {
  const baseRequest: EnvelopingTypes.RelayRequestStruct = {
    request: {
      relayHub: constants.AddressZero,
      from: constants.AddressZero,
      to: constants.AddressZero,
      value: '0',
      gas: '1000000',
      nonce: '0',
      data: '0x',
      tokenContract: constants.AddressZero,
      tokenAmount: '1',
      tokenGas: '50000',
      validUntilTime: '0',
    },
    relayData: {
      gasPrice: '1',
      feesReceiver: constants.AddressZero,
      callForwarder: constants.AddressZero,
      callVerifier: constants.AddressZero,
    },
  }

  return {
    request: {
      ...baseRequest.request,
      ...request,
    },
    relayData: {
      ...baseRequest.relayData,
      ...relayData,
    },
  }
}

describe('Custom Smart Wallet using TestToken', function () {
  let recipient: TestForwarderTarget
  let recipientFunction: string
  let successCustomLogicFactory: SuccessCustomLogic__factory
  let customSmartWalletFactory: CustomSmartWallet__factory
  let template: CustomSmartWallet
  let successCustomLogic: SuccessCustomLogic
  let factory: CustomSmartWalletFactory | SmartWalletFactory
  let utilTokenFactory: UtilToken__factory
  let token: UtilToken
  let owner: Wallet
  let fundedAccount: SignerWithAddress
  let relayHub: SignerWithAddress
  let worker: SignerWithAddress

  beforeEach(async function () {
    const testForwarderTargetFactory = await ethers.getContractFactory(
      'TestForwarderTarget',
    )
    recipient = await testForwarderTargetFactory.deploy()
    recipientFunction = recipient.interface.encodeFunctionData('emitMessage', [
      'hello',
    ])
    successCustomLogicFactory = await ethers.getContractFactory(
      'SuccessCustomLogic',
    )
    customSmartWalletFactory = await ethers.getContractFactory(
      'CustomSmartWallet',
    )
    utilTokenFactory = await ethers.getContractFactory('UtilToken')

    template = await customSmartWalletFactory.deploy()
    successCustomLogic = await successCustomLogicFactory.deploy()

    const provider = ethers.provider
    owner = ethers.Wallet.createRandom().connect(provider)

    ;[relayHub, worker, fundedAccount] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
    ]

    //Fund the owner
    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    })

    factory = await createSmartWalletFactory(template, true, owner)
    token = await utilTokenFactory.deploy()
  })

  async function createCustomSmartWallet(customLogic: IWalletCustomLogic) {
    const smartWallet = (await createSmartWallet({
      relayHub: relayHub.address,
      owner,
      sender: relayHub,
      factory,
      logicAddr: customLogic.address,
      isCustomSmartWallet: true,
    })) as CustomSmartWallet

    await fillTokens(token, smartWallet.address, '1000')

    const relayData = {
      callForwarder: smartWallet.address,
    }

    return { smartWallet, relayData }
  }

  async function getTokenBalancesAndNonce(smartWallet: CustomSmartWallet) {
    const workerTokenBalance = await getTokenBalance(token, worker.address)
    const smartWalletTokenBalance = await getTokenBalance(
      token,
      smartWallet.address,
    )
    const nonce = await smartWallet.nonce()

    return {
      workerTokenBalance,
      smartWalletTokenBalance,
      nonce,
    }
  }

  describe('#add/disable relay workers', function () {
    let penalizer: Penalizer
    let relayHub: RelayHub
    let verifier: TestVerifierEverythingAccepted
    let deployVerifier: TestDeployVerifierEverythingAccepted
    let recipient: TestRecipient
    let token: UtilToken
    let forwarder: IForwarder
    let factory: CustomSmartWalletFactory | SmartWalletFactory
    let sharedRelayRequestData: RelayRequest
    let worker: SignerWithAddress
    let relayManager: SignerWithAddress
    let relayOwner: SignerWithAddress
    beforeEach(async function () {
      const penalizerFactory = await ethers.getContractFactory('Penalizer')
      penalizer = await penalizerFactory.deploy()

      relayHub = await deployRelayHub(penalizer.address)
      verifier = await ethers
        .getContractFactory('TestVerifierEverythingAccepted')
        .then((contractFactory) => contractFactory.deploy())
      deployVerifier = await ethers
        .getContractFactory('TestDeployVerifierEverythingAccepted')
        .then((contractFactory) => contractFactory.deploy())

      const smartWalletTemplate = await ethers
        .getContractFactory('SmartWallet')
        .then((contractFactory) => contractFactory.deploy())

      const owner = ethers.Wallet.createRandom()

      factory = await createSmartWalletFactory(
        smartWalletTemplate,
        false,
        owner,
      )
      recipient = await ethers
        .getContractFactory('TestRecipient')
        .then((contractFactory) => contractFactory.deploy())
      token = await ethers
        .getContractFactory('UtilToken')
        .then((contractFactory) => contractFactory.deploy())

      const sender = await ethers.getSigner(relayHub.address)

      forwarder = await createSmartWallet({
        relayHub: relayHub.address,
        factory,
        owner,
        sender,
      })

      await token.mint('1000', forwarder.address)
      ;[worker, relayManager, relayOwner] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
        SignerWithAddress,
      ]

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
          feesReceiver: worker.address,
          callForwarder: forwarder.address,
          callVerifier: verifier.address,
        },
      }
    })

    it('should register and allow to disable new relay workers', async function () {
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: BigNumber.from('1'),
        from: relayOwner.address,
      })

      const relayWorkersBefore = await relayHub.workerCount(
        relayManager.address,
      )

      expect(relayWorkersBefore.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`,
      )

      let txResponse = await relayHub.addRelayWorkers([worker.address], {
        from: relayManager.address,
      })
      let receipt = await txResponse.wait()
      let filters = relayHub.filters.RelayWorkersAdded()

      const relayWorkersAddedEvent = relayHub.interface.parseLog(filters)

      const relayWorkersAddedEvent = logs.find(
        (e: any) => e != null && e.name === 'RelayWorkersAdded',
      )
      assert.equal(
        relayManager.toLowerCase(),
        relayWorkersAddedEvent.events[0].value.toLowerCase(),
      )
      assert.equal(
        relayWorker.toLowerCase(),
        relayWorkersAddedEvent.events[1].value[0].toLowerCase(),
      )
      assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value)

      let relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      assert.equal(relayWorkersAfter.toNumber(), 1, 'Workers must be one')
    })
  })
})

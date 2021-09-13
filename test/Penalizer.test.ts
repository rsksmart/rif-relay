import { ether, expectRevert } from '@openzeppelin/test-helpers'

import { Environment } from '../src/common/Environments'
import {
  IForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  SmartWalletFactoryInstance,
  SmartWalletInstance,
  TestRecipientInstance,
  TestTokenInstance,
  TestVerifierEverythingAcceptedInstance
} from '../types/truffle-contracts'

import { createSmartWallet, createSmartWalletFactory, deployHub, getGaslessAccount, getTestingEnvironment } from './TestUtils'
import { RelayRequest } from '../src/common/EIP712/RelayRequest'
import TypedRequestData, { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { getLocalEip712Signature } from '../Utils'
import { AccountKeypair } from '../src/relayclient/AccountManager'

const RelayHub = artifacts.require('RelayHub')
const Penalizer = artifacts.require('Penalizer')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const testToken = artifacts.require('TestToken')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')

contract('Penalizer', function ([relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker, reporterRelayManager]) {
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let recipientContract: TestRecipientInstance
  let verifierContract: TestVerifierEverythingAcceptedInstance
  let env: Environment
  let target: string
  let gaslessAccount: AccountKeypair
  let smartWalletTemplate: SmartWalletInstance
  let factory: SmartWalletFactoryInstance
  let forwarderInstance: IForwarderInstance
  let forwarder: string
  let verifier: string
  let token: TestTokenInstance

  before(async function () {
    penalizer = await Penalizer.new()
    relayHub = await deployHub(penalizer.address)
    recipientContract = await TestRecipient.new()
    verifierContract = await TestVerifierEverythingAccepted.new()
    target = recipientContract.address
    verifier = verifierContract.address
    token = await testToken.new()

    env = await getTestingEnvironment()

    gaslessAccount = await getGaslessAccount()
    smartWalletTemplate = await SmartWallet.new()
    factory = await createSmartWalletFactory(smartWalletTemplate)
    forwarderInstance = await createSmartWallet(relayOwner, gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)
    forwarder = forwarderInstance.address

    await relayHub.stakeForAddress(relayManager, 1000, {
      from: relayOwner,
      value: ether('1'),
      gasPrice: '1'
    })

    await relayHub.addRelayWorkers([relayWorker], { from: relayManager, gasPrice: '1' })
    // @ts-ignore
    Object.keys(RelayHub.events).forEach(function (topic) {
      // @ts-ignore
      RelayHub.network.events[topic] = RelayHub.events[topic]
    })
    // @ts-ignore
    Object.keys(RelayHub.events).forEach(function (topic) {
      // @ts-ignore
      Penalizer.network.events[topic] = RelayHub.events[topic]
    })

    await relayHub.stakeForAddress(reporterRelayManager, 1000, {
      value: ether('1'),
      from: relayOwner
    })
  })

  describe('should be able to have its hub set', function () {
    it('successfully from its owner address', async function () {
      await penalizer.setHub(relayHub.address, { from: await penalizer.owner() })
    })

    it('unsuccessfully from another address', async function () {
      await expectRevert(
        penalizer.setHub(relayHub.address, { from: other }),
        'caller is not the owner'
      )
    })
  })

  describe('should fulfill transactions', function () {
    it('successfully ', async function () {
      const relayRequest = await createRelayRequest(gaslessAccount)
      const sig = getRelayRequestSignature
      console.log(relayRequest, sig)
    })
  })

  async function createRelayRequest (account: AccountKeypair): Promise<RelayRequest> {
    const relayRequest: RelayRequest = {
      request: {
        relayHub: relayHub.address,
        to: target,
        data: '',
        from: account.address,
        nonce: (await forwarderInstance.nonce()).toString(),
        value: '0',
        gas: '3000000',
        tokenContract: token.address,
        tokenAmount: '1',
        tokenGas: '50000',
        enableQos: false
      },
      relayData: {
        gasPrice: '1',
        relayWorker,
        callForwarder: forwarder,
        callVerifier: verifier,
        domainSeparator: getDomainSeparatorHash(forwarder, env.chainId)
      }
    }

    relayRequest.request.data = '0xdeadbeef'
    relayRequest.relayData.relayWorker = relayWorker

    return relayRequest
  }

  function getRelayRequestSignature (relayRequest: RelayRequest, account: AccountKeypair): string {
    const dataToSign = new TypedRequestData(
      env.chainId,
      forwarder,
      relayRequest
    )
    const signature = getLocalEip712Signature(
      dataToSign,
      account.privateKey
    )

    return signature
  }
})

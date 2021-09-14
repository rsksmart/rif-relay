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
import { zeroAddress } from 'ethereumjs-util'

const Penalizer = artifacts.require('Penalizer')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const testToken = artifacts.require('TestToken')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')

contract('Penalizer', function ([relayOwner, relayWorker, relayManager, other]) {
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
  const gasPrice = '1'

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
    await token.mint('1000', forwarder)

    await relayHub.stakeForAddress(relayManager, 1000, {
      from: relayOwner,
      value: ether('1'),
      gasPrice: '1'
    })

    await relayHub.addRelayWorkers([relayWorker], { from: relayManager, gasPrice: '1' })
  })

  describe('should be able to have its hub set', function () {
    it('starting out with an unset address', async function () {
      assert.equal(await penalizer.getHub(), zeroAddress())
    })

    it('successfully from its owner address', async function () {
      await penalizer.setHub(relayHub.address, { from: await penalizer.owner() })

      assert.equal(await penalizer.getHub(), relayHub.address)
    })

    it('unsuccessfully from another address', async function () {
      await expectRevert(
        penalizer.setHub(other, { from: other }),
        'caller is not the owner'
      )

      // hub should remain set with its previous value
      assert.equal(await penalizer.getHub(), relayHub.address)
    })
  })

  describe('should fulfill transactions', function () {
    it('unsuccessfully if qos is disabled', async function () {
      const relayRequest = await createRelayRequest(gaslessAccount)
      const signature = getRelayRequestSignature(relayRequest, gaslessAccount)

      await relayHub.relayCall(relayRequest, signature, {
        from: relayWorker,
        gas: 4e6,
        gasPrice: gasPrice
      })

      assert.isFalse(await penalizer.fulfilled(signature))
    })

    it('successfully if qos is enabled', async function () {
      const relayRequest = await createRelayRequest(gaslessAccount)
      relayRequest.request.enableQos = true
      const signature = getRelayRequestSignature(relayRequest, gaslessAccount)

      await relayHub.relayCall(relayRequest, signature, {
        from: relayWorker,
        gas: 4e6,
        gasPrice: gasPrice
      })

      assert.isTrue(await penalizer.fulfilled(signature))
    })
  })

  describe('should be able to reject claims', function () {
    it('due to hub not being set', async function () {
      const hublessPenalizer = await Penalizer.new()
      const receipt = createCommitmentReceipt()
      await expectRevert(
        hublessPenalizer.claim(receipt),
        'relay hub not set'
      )
    })
  })

  async function createRelayRequest (account: AccountKeypair): Promise<RelayRequest> {
    const rr: RelayRequest = {
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
        gasPrice: gasPrice,
        relayWorker,
        callForwarder: forwarder,
        callVerifier: verifier,
        domainSeparator: getDomainSeparatorHash(forwarder, env.chainId)
      }
    }

    rr.request.data = '0xdeadbeef'
    rr.relayData.relayWorker = relayWorker

    return rr
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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function createCommitmentReceipt () {
    // temporarily hard-coded
    return {
      workerAddress: '0x86c659194f559c76a83fa8238120cfc6cb7440dc',
      commitment: {
        time: 1626784918999,
        from: '0x2F4034C552Bb3A241bB941F8B270FF972507EA09',
        to: '0x1Af2844A588759D0DE58abD568ADD96BB8B3B6D8',
        data: '0xa9059cbb000000000000000000000000d82c5cc006c83e9f0348f6896571aefa5aa2bbc600000000000000000000000000000000000000000000000029a2241af62c0000',
        relayHubAddress: '0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701',
        relayWorker: '0x86c659194f559c76a83fa8238120cfc6cb7440dc',
        enableQos: false,
        signature: '0xcba668ad3ba3a5389bebc3b8211bdbb0e8223f8f2145eb687235d6dc0aead3255618f039becb02dc78bc51575c14a47c547718d52753f4983fb0ba9b5c260c4f1b'
      },
      workerSignature: '0x5cd81b693e0aef3c75085b7e80e89f2bc5220926e369b70dc6f5901d116281d523f958e4578d5ec6fb1c3234cbd6d870ed48f41c94dda84d1203c9d0b6c07e741b'
    }
  }
})

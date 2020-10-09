import {
  DeployPaymasterInstance,
  RelayPaymasterInstance,
  TestTokenInstance,
  ForwarderInstance,
  TestForwarderTargetInstance,
  ProxyFactoryInstance,
  SmartWalletInstance
} from '../types/truffle-contracts'

import chai from 'chai'
import EnvelopingRequest from '../src/common/EIP712/EnvelopingRequest'
import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
import { ethers } from 'ethers'
import { toBuffer, bufferToHex, privateToAddress } from 'ethereumjs-util'
import { toChecksumAddress } from 'web3-utils'

const Forwarder = artifacts.require('Forwarder')
const DeployPaymaster = artifacts.require('DeployPaymaster')
const RelayPaymaster = artifacts.require('RelayPaymaster')
const TestToken = artifacts.require('TestToken')
const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const ProxyFactory = artifacts.require('ProxyFactory')
const SmartWallet = artifacts.require('SmartWallet')

const baseRelayFee = '10000'
const pctRelayFee = '10'
const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
const paymasterData = '0x'
const clientId = '1'
const tokensPaid = 1
let envelopingRequestData: EnvelopingRequest

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

contract('DeployPaymaster', function ([other0, dest, other1, relayWorker, senderAddress, other2, paymasterOwner, other3]) {
  let deployPaymaster: DeployPaymasterInstance
  let token: TestTokenInstance
  let fwd: SmartWalletInstance
  let recipient: TestForwarderTargetInstance
  let factory: ProxyFactoryInstance

  beforeEach(async function () {
    fwd = await SmartWallet.new()
    await fwd.registerDomainSeparator('Test Domain', '1')

    recipient = await TestForwarderTarget.new(fwd.address)
    factory = await ProxyFactory.new(fwd.address)
    deployPaymaster = await DeployPaymaster.new({ from: paymasterOwner })
    token = await TestToken.new()

    await deployPaymaster.setTrustedForwarder(fwd.address, { from: paymasterOwner })
    await deployPaymaster.setRelayHub(other1, { from: paymasterOwner })

    const data = '0x00'

    envelopingRequestData = {
      request: {
        to: recipient.address,
        data,
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenRecipient: dest,
        tokenContract: token.address,
        tokenAmount: tokensPaid.toString(),
        factory: factory.address
      },
      relayData: {
        pctRelayFee,
        baseRelayFee,
        gasPrice,
        relayWorker,
        forwarder: fwd.address,
        paymaster: deployPaymaster.address,
        paymasterData,
        clientId
      }
    }
    // we mint tokens to the sender,
    await token.mint(tokensPaid + 1000, senderAddress)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await deployPaymaster.preRelayedCallInternal(envelopingRequestData)
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
    const ownerPrivateKey = toBuffer(bytes32(1))
    const ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)))
    const logicAddress = addr(0)
    const initParams = '0x00'

    await token.mint(tokensPaid + 4, ownerAddress)

    const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)

    let toSign: string = ''

    const signSha = web3.utils.soliditySha3(
      { t: 'bytes2', v: '0x1910' },
      { t: 'address', v: ownerAddress },
      { t: 'address', v: logicAddress },
      { t: 'bytes', v: initParams }
    )

    if (signSha != null) {
      toSign = signSha
    }

    const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
    const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
    const signature = signingKey.signDigest(toSignAsBinaryArray)
    const signatureCollapsed = ethers.utils.joinSignature(signature)

    // expectedCode = runtime code only
    let expectedCode = await factory.getCreationBytecode()
    expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

    const { logs } = await factory.createUserSmartWallet(ownerAddress,
      logicAddress, initParams, signatureCollapsed)

    const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

    chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))

    envelopingRequestData.request.from = ownerAddress
    envelopingRequestData.request.to = logicAddress
    envelopingRequestData.request.data = initParams

    let salt = ''
    const saltSha = web3.utils.soliditySha3(
      { t: 'address', v: ownerAddress },
      { t: 'address', v: logicAddress },
      { t: 'bytes', v: initParams }
    )

    if (saltSha != null) {
      salt = saltSha
    }

    const expectedSalt = web3.utils.toBN(salt).toString()

    // Check the emitted event
    expectEvent.inLogs(logs, 'Deployed', {
      addr: expectedAddress,
      salt: expectedSalt
    })

    await expectRevert.unspecified(
      deployPaymaster.preRelayedCallInternal(envelopingRequestData),
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // Address should be contract, we use this one
    envelopingRequestData.request.from = token.address
    // run method
    await expectRevert.unspecified(
      deployPaymaster.preRelayedCallInternal(envelopingRequestData),
      'balance too low'
    )
  })
})

contract('RelayPaymaster', function ([_, dest, relayManager, relayWorker, senderAddress, other, paymasterOwner, relayHub]) {
  let relayPaymaster: RelayPaymasterInstance
  let token: TestTokenInstance
  let fwd: ForwarderInstance
  let recipient: TestForwarderTargetInstance
  let forwarder: string
  let envelopingRequestData: EnvelopingRequest
  let proxy: ProxyFactoryInstance

  before(async function () {
    fwd = await Forwarder.new()
    forwarder = fwd.address

    recipient = await TestForwarderTarget.new(forwarder)
    relayPaymaster = await RelayPaymaster.new({ from: paymasterOwner })
    token = await TestToken.new()
    proxy = await ProxyFactory.new(fwd.address)

    await relayPaymaster.setTrustedForwarder(forwarder, { from: paymasterOwner })
    await relayPaymaster.setRelayHub(relayHub, { from: paymasterOwner })

    envelopingRequestData = {
      request: {
        to: recipient.address,
        data: '0x00',
        from: fwd.address,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenRecipient: dest,
        tokenContract: token.address,
        tokenAmount: tokensPaid.toString(),
        factory: proxy.address
      },
      relayData: {
        pctRelayFee,
        baseRelayFee,
        gasPrice,
        relayWorker,
        forwarder,
        paymaster: relayPaymaster.address,
        paymasterData,
        clientId
      }
    }
    // we mint tokens to the sender,
    await token.mint(tokensPaid + 4, fwd.address)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    // run method
    await relayPaymaster.preRelayedCallInternal(envelopingRequestData)
    // All checks should pass
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // Address should be contract, we use this one
    envelopingRequestData.request.from = token.address
    // run method
    await expectRevert.unspecified(
      relayPaymaster.preRelayedCallInternal(envelopingRequestData),
      'balance too low'
    )
  })

  it('SHOULD fail on address not contract of preRelayCall', async function () {
    // Address should be contract, we use this one
    envelopingRequestData.request.from = other
    // run method
    await expectRevert.unspecified(
      relayPaymaster.preRelayedCallInternal(envelopingRequestData),
      'Addr MUST be a contract'
    )
  })
})

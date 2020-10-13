import {
  DeployPaymasterInstance,
  RelayPaymasterInstance,
  TestTokenInstance,
  ProxyFactoryInstance,
  SmartWalletInstance
} from '../types/truffle-contracts'

import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
import { ethers } from 'ethers'
import { toBuffer, bufferToHex, privateToAddress } from 'ethereumjs-util'
import { toChecksumAddress } from 'web3-utils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getTestingEnvironment, createProxyFactory, createSmartWallet } from './TestUtils'

const DeployPaymaster = artifacts.require('DeployPaymaster')
const RelayPaymaster = artifacts.require('RelayPaymaster')
const TestToken = artifacts.require('TestToken')
const ProxyFactory = artifacts.require('ProxyFactory')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')

const baseRelayFee = '10000'
const pctRelayFee = '10'
const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
const paymasterData = '0x'
const clientId = '1'
const tokensPaid = 1
let relayRequestData: RelayRequest

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

contract('DeployPaymaster', function ([relayHub, dest, other1, relayWorker, senderAddress, other2, paymasterOwner, other3]) {
  let deployPaymaster: DeployPaymasterInstance
  let token: TestTokenInstance
  let template: SmartWalletInstance
  let factory: ProxyFactoryInstance

  const ownerPrivateKey = toBuffer(bytes32(1))
  const ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)))
  const logicAddress = addr(0)
  const initParams = '0x00'

  beforeEach(async function () {
    template = await SmartWallet.new()
    factory = await ProxyFactory.new(template.address)
    deployPaymaster = await DeployPaymaster.new({ from: paymasterOwner })
    token = await TestToken.new()

    await deployPaymaster.setRelayHub(relayHub, { from: paymasterOwner })

    relayRequestData = {
      request: {
        to: logicAddress,
        data: initParams,
        from: ownerAddress,
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
        forwarder: other2,
        paymaster: deployPaymaster.address,
        paymasterData,
        clientId
      }
    }
    // we mint tokens to the sender,
    const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
    await token.mint(tokensPaid + 4, expectedAddress)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await deployPaymaster.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub })
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
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

    const { logs } = await factory.createUserSmartWallet(ownerAddress,
      logicAddress, initParams, signatureCollapsed)

    relayRequestData.request.from = ownerAddress
    relayRequestData.request.to = logicAddress
    relayRequestData.request.data = initParams

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
      deployPaymaster.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // We change the initParams so the smart wallet address will be different
    // So there wont be any balance
    relayRequestData.request.data = '0x01'

    await expectRevert.unspecified(
      deployPaymaster.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'balance too low'
    )
  })
})

contract('RelayPaymaster', function ([_, dest, relayManager, relayWorker, other, other2, paymasterOwner, relayHub]) {
  let template: SmartWalletInstance
  let sw: SmartWalletInstance
  let relayPaymaster: RelayPaymasterInstance
  let token: TestTokenInstance
  let relayRequestData: RelayRequest
  let factory: ProxyFactoryInstance

  before(async function () {
    const env = await getTestingEnvironment()
    const chainId = env.chainId

    const senderPrivKeyStr = bytes32(1)
    const senderPrivateKey = toBuffer(senderPrivKeyStr)
    const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

    relayPaymaster = await RelayPaymaster.new({ from: paymasterOwner })
    token = await TestToken.new()
    template = await SmartWallet.new()

    factory = await createProxyFactory(template)

    sw = await createSmartWallet(senderAddress, factory, chainId, senderPrivKeyStr)
    const smartWallet = sw.address
    const recipientContract = await TestRecipient.new()

    await relayPaymaster.setRelayHub(relayHub, { from: paymasterOwner })

    relayRequestData = {
      request: {
        to: recipientContract.address,
        data: '0x00',
        from: smartWallet,
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
        forwarder: other2,
        paymaster: relayPaymaster.address,
        paymasterData,
        clientId
      }
    }
    // we mint tokens to the sender,
    await token.mint(tokensPaid + 4, smartWallet)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    // run method
    await relayPaymaster.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub })
    // All checks should pass
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // Address should be contract, we use this one
    relayRequestData.request.from = token.address
    // run method
    await expectRevert.unspecified(
      relayPaymaster.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on address not contract of preRelayCall', async function () {
    // Address should be contract, we use this one
    relayRequestData.request.from = other
    // run method
    await expectRevert.unspecified(
      relayPaymaster.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Addr MUST be a contract'
    )
  })
})

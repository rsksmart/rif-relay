import {
  DeployPaymasterInstance,
  RelayPaymasterInstance,
  TestTokenInstance,
  ProxyFactoryInstance,
  SmartWalletInstance,
  TestPaymastersInstance
} from '../types/truffle-contracts'

import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
import { ethers } from 'ethers'
import { toBuffer, bufferToHex, privateToAddress, BN } from 'ethereumjs-util'
import { toChecksumAddress } from 'web3-utils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getTestingEnvironment, createProxyFactory, createSmartWallet } from './TestUtils'
import { constants } from "../src/common/Constants"

const DeployPaymaster = artifacts.require('DeployPaymaster')
const RelayPaymaster = artifacts.require('RelayPaymaster')
const TestToken = artifacts.require('TestToken')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasters = artifacts.require('TestPaymasters')

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

  let testPaymasters: TestPaymastersInstance

  const ownerPrivateKey = toBuffer(bytes32(1))
  const ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)))
  const logicAddress = addr(0)
  const initParams = '0x00'

  beforeEach(async function () {
    deployPaymaster = await DeployPaymaster.new({ from: paymasterOwner })
    token = await TestToken.new()
    template = await SmartWallet.new()

    testPaymasters = await TestPaymasters.new(deployPaymaster.address)

    factory = await createProxyFactory(template)

    // We simulate the testPaymasters contract is a relayHub to make sure
    // the onlyRelayHub condition is correct
    await deployPaymaster.setRelayHub(testPaymasters.address, { from:  paymasterOwner})

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
        forwarder: constants.ZERO_ADDRESS,
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
    await deployPaymaster.acceptToken(token.address, {from: paymasterOwner})

    const { logs } = await testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub })

    expectEvent.inLogs(logs, 'Accepted', {
      tokenAmount : new BN(tokensPaid),
      from: ownerAddress
    })
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
    await deployPaymaster.acceptToken(token.address, {from: paymasterOwner})

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
      testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    await deployPaymaster.acceptToken(token.address, {from: paymasterOwner})

    // We change the initParams so the smart wallet address will be different
    // So there wont be any balance
    relayRequestData.request.data = '0x01'

    await expectRevert.unspecified(
      testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expectRevert.unspecified(
      testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Token contract not allowed'
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
  let testPaymasters: TestPaymastersInstance

  const senderPrivKeyStr = bytes32(1)
  const senderPrivateKey = toBuffer(senderPrivKeyStr)
  const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

  before(async function () {
    const env = await getTestingEnvironment()
    const chainId = env.chainId

    relayPaymaster = await RelayPaymaster.new({ from: paymasterOwner })

    testPaymasters = await TestPaymasters.new(relayPaymaster.address)

    token = await TestToken.new()
    template = await SmartWallet.new()

    factory = await createProxyFactory(template)

    sw = await createSmartWallet(senderAddress, factory, chainId, senderPrivKeyStr)
    const smartWallet = sw.address
    const recipientContract = await TestRecipient.new()

    // We simulate the testPaymasters contract is a relayHub to make sure
    // the onlyRelayHub condition is correct
    await relayPaymaster.setRelayHub(testPaymasters.address, { from:  paymasterOwner})

    relayRequestData = {
      request: {
        to: recipientContract.address,
        data: '0x00',
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
        forwarder: smartWallet,
        paymaster: relayPaymaster.address,
        paymasterData,
        clientId
      }
    }
    // we mint tokens to the sender,
    await token.mint(tokensPaid + 4, smartWallet)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await relayPaymaster.acceptToken(token.address, {from: paymasterOwner})
    // run method
    const { logs } = await testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub })
    // All checks should pass

    expectEvent.inLogs(logs, 'Accepted', {
      tokenAmount : new BN(tokensPaid),
      from: senderAddress
    })
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    await relayPaymaster.acceptToken(token.address, {from: paymasterOwner})
    // Address should be contract, we use this one
    relayRequestData.relayData.forwarder = other
    // run method
    await expectRevert.unspecified(
      testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expectRevert.unspecified(
      testPaymasters.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Token contract not allowed'
    )
  })
})

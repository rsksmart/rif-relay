import {
  DeployPaymasterInstance,
  RelayPaymasterInstance,
  TestTokenInstance,
  ForwarderInstance,
  TestForwarderTargetInstance,
  ProxyFactoryInstance
} from '../types/truffle-contracts'

import EnvelopingRequest from '../src/common/EIP712/RelayRequest'
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

const baseRelayFee = '10000'
const pctRelayFee = '10'
const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
let relayRequestData: EnvelopingRequest
const paymasterData = '0x'
const clientId = '1'
const tokensPaid = 1

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

contract('DeployPaymaster', function ([other0, dest, other1, relayWorker, senderAddress, other2, paymasterOwner, other3]) {
  let deployPaymaster: DeployPaymasterInstance
  let token: TestTokenInstance
  let fwd: ForwarderInstance
  let recipient: TestForwarderTargetInstance
  let proxy: ProxyFactoryInstance
  let forwarder: string

  before(async function () {
    fwd = await Forwarder.new()
    forwarder = fwd.address

    recipient = await TestForwarderTarget.new(forwarder)
    proxy = await ProxyFactory.new(fwd.address)
    deployPaymaster = await DeployPaymaster.new(proxy.address, { from: paymasterOwner })
    token = await TestToken.new()

    await deployPaymaster.setTrustedForwarder(forwarder, { from: paymasterOwner })
    await deployPaymaster.setRelayHub(other1, { from: paymasterOwner })

    const data = '0xef06ad14000000000000000000000000c783df8a850f42e7f7e57013759c285caa701eb600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000078371bdede8aac7debfff451b74c5edb385af7000000000000000000000000ead9c93b79ae7c1591b1fb5323bd777e86e150d4000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000186a0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000002a59800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000411fdf77b663cd5082669f97b136f87f8322a23e6c494cb0c5929f4581b6aaa0161b20485f69455eeb2e59e321e8b9751855955e38fe5b9cc1e45d5d82ca92b6b81b00000000000000000000000000000000000000000000000000000000000000'

    relayRequestData = {
      request: {
        to: recipient.address,
        data,
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenRecipient: dest,
        tokenContract: token.address,
        paybackTokens: tokensPaid.toString(),
        tokenGas: gasLimit
      },
      relayData: {
        pctRelayFee,
        baseRelayFee,
        gasPrice,
        relayWorker,
        forwarder,
        paymaster: deployPaymaster.address,
        paymasterData,
        clientId
      }
    }
    // we mint tokens to the sender,
    await token.mint(tokensPaid + 4, senderAddress)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await deployPaymaster.preRelayedCallInternal(relayRequestData)
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
    const logicAddress = addr(0)
    const initParams = '0x00'
    const logicInitGas = '0x00'
    const ownerPrivateKey = toBuffer(bytes32(1))
    const ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)))

    const paymentToken = other2
    const recipient = other3
    const deployPrice = 46
    const sig = '0x1fdf77b663cd5082669f97b136f87f8322a23e6c494cb0c5929f4581b6aaa0161b20485f69455eeb2e59e321e8b9751855955e38fe5b9cc1e45d5d82ca92b6b81b'

    let testData = 'FFFFFFFF' + web3.eth.abi.encodeParameters(['address', 'address', 'address', 'address',
      'uint256', 'uint256', 'bytes', 'bytes'], [ownerAddress, logicAddress, paymentToken, recipient, deployPrice, logicInitGas, initParams, sig])
    testData = testData.replace('0x', '')
    testData = '0x' + testData
    let toSign: string = ''
    const toSignReal = web3.utils.soliditySha3(
      { t: 'bytes2', v: '0x1910' },
      { t: 'address', v: ownerAddress },
      { t: 'address', v: logicAddress },
      { t: 'uint256', v: logicInitGas },
      { t: 'bytes', v: initParams }
    )

    if (toSignReal != null) {
      toSign += toSignReal
    }

    const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
    const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
    const signature = signingKey.signDigest(toSignAsBinaryArray)
    const signatureCollapsed = ethers.utils.joinSignature(signature)

    relayRequestData.request.data = testData

    const { logs } = await proxy.createUserSmartWallet(ownerAddress, logicAddress, logicInitGas,
      initParams, signatureCollapsed)
    const expectedAddress = await proxy.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
    let salt = ''
    const saltReal = web3.utils.soliditySha3(
      { t: 'address', v: ownerAddress },
      { t: 'address', v: logicAddress },
      { t: 'bytes', v: initParams })

    if (saltReal != null) {
      salt += saltReal
    }

    const expectedSalt = web3.utils.toBN(salt).toString()

    expectEvent.inLogs(logs, 'Deployed', {
      addr: expectedAddress,
      salt: expectedSalt
    })

    await expectRevert.unspecified(
      deployPaymaster.preRelayedCallInternal(relayRequestData),
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // Address should be contract, we use this one
    relayRequestData.request.from = token.address
    // run method
    await expectRevert.unspecified(
      deployPaymaster.preRelayedCallInternal(relayRequestData),
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
  let relayRequestData: RelayRequest

  before(async function () {
    fwd = await Forwarder.new()
    forwarder = fwd.address

    recipient = await TestForwarderTarget.new(forwarder)
    relayPaymaster = await RelayPaymaster.new({ from: paymasterOwner })
    token = await TestToken.new()

    await relayPaymaster.setTrustedForwarder(forwarder, { from: paymasterOwner })
    await relayPaymaster.setRelayHub(relayHub, { from: paymasterOwner })

    relayRequestData = {
      request: {
        to: recipient.address,
        data: '0x00',
        from: fwd.address,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenRecipient: dest,
        tokenContract: token.address,
        paybackTokens: tokensPaid.toString(),
        tokenGas: gasLimit
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
    await relayPaymaster.preRelayedCallInternal(relayRequestData)
    // All checks should pass
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // Address should be contract, we use this one
    relayRequestData.request.from = token.address
    // run method
    await expectRevert.unspecified(
      relayPaymaster.preRelayedCallInternal(relayRequestData),
      'balance too low'
    )
  })

  it('SHOULD fail on address not contract of preRelayCall', async function () {
    // Address should be contract, we use this one
    relayRequestData.request.from = other
    // run method
    await expectRevert.unspecified(
      relayPaymaster.preRelayedCallInternal(relayRequestData),
      'Addr MUST be a contract'
    )
  })
})

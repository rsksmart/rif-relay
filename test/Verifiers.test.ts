import {
  DeployVerifierInstance,
  RelayVerifierInstance,
  TestTokenInstance,
  SmartWalletFactoryInstance,
  SmartWalletInstance,
  TestDeployVerifierInstance,
  TestRelayVerifierInstance
} from '../types/truffle-contracts'

import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
import { ethers } from 'ethers'
import { toBuffer, bufferToHex, privateToAddress, BN } from 'ethereumjs-util'
import { DeployRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import { getTestingEnvironment, createSmartWalletFactory, createSmartWallet, bytes32 } from './TestUtils'
import { constants } from '../src/common/Constants'
import { Address } from '../src/relayclient/types/Aliases'
import { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'

const DeployVerifier = artifacts.require('DeployVerifier')
const RelayVerifier = artifacts.require('RelayVerifier')
const TestToken = artifacts.require('TestToken')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const TestRelayVerifier = artifacts.require('TestRelayVerifier')
const TestDeployVerifier = artifacts.require('TestDeployVerifier')

const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
const tokensPaid = 1

contract('DeployVerifier', function ([relayHub, other1, relayWorker, verifierOwner]) {
  let deployRequestData: DeployRequest
  let deployVerifier: DeployVerifierInstance
  let token: TestTokenInstance
  let template: SmartWalletInstance
  let factory: SmartWalletFactoryInstance

  let testVerifiers: TestDeployVerifierInstance
  let expectedAddress: Address

  const ownerPrivateKey = toBuffer(bytes32(1))
  let ownerAddress: string

  const recoverer = constants.ZERO_ADDRESS
  const index = '0'

  beforeEach(async function () {
    ownerAddress = bufferToHex(privateToAddress(ownerPrivateKey)).toLowerCase()
    token = await TestToken.new()
    template = await SmartWallet.new()

    factory = await createSmartWalletFactory(template)

    deployVerifier = await DeployVerifier.new(factory.address, { from: verifierOwner })
    testVerifiers = await TestDeployVerifier.new(deployVerifier.address)

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct
    deployRequestData = {
      request: {
        relayHub: relayHub,
        to: constants.ZERO_ADDRESS,
        data: '0x',
        from: ownerAddress,
        nonce: senderNonce,
        value: '0',
        recoverer: recoverer,
        index: index,
        tokenContract: token.address,
        tokenAmount: tokensPaid.toString(),
        tokenGas: '50000',
        enableQos: 'false',
      },
      relayData: {
        gasPrice,
        relayWorker,
        callForwarder: factory.address,
        callVerifier: deployVerifier.address,
        domainSeparator: '0x0000000000000000000000000000000000000000000000000000000000000000'
      }
    }

    // we mint tokens to the sender
    expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)
    await token.mint(tokensPaid + 4, expectedAddress)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })
    const { logs } = await testVerifiers.verifyRelayedCall(deployRequestData, '0x00', { from: relayHub })

    // All checks should pass
    assert.equal(logs[0].event, 'Accepted')
    assert.equal(logs[0].args[0].toNumber(), new BN(tokensPaid).toNumber())
    assert.equal(logs[0].args[1].toLowerCase(), ownerAddress.toLowerCase())

    // expectEvent.inLogs(logs, 'Accepted', {
    //   tokenAmount: new BN(tokensPaid),
    //   from: ownerAddress
    // })
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })
    const toSign: string = web3.utils.soliditySha3(
      { t: 'bytes2', v: '0x1910' },
      { t: 'address', v: ownerAddress },
      { t: 'address', v: recoverer },
      { t: 'uint256', v: index }
    ) ?? ''

    const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
    const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
    const signature = signingKey.signDigest(toSignAsBinaryArray)
    const signatureCollapsed = ethers.utils.joinSignature(signature)

    const { logs } = await factory.createUserSmartWallet(ownerAddress, recoverer,
      index, signatureCollapsed)

    deployRequestData.request.from = ownerAddress
    deployRequestData.request.to = constants.ZERO_ADDRESS
    deployRequestData.request.data = '0x'

    const salt = web3.utils.soliditySha3(
      { t: 'address', v: ownerAddress },
      { t: 'address', v: recoverer },
      { t: 'uint256', v: index }
    ) ?? ''

    const expectedSalt = web3.utils.toBN(salt).toString()

    // Check the emitted event
    expectEvent.inLogs(logs, 'Deployed', {
      addr: expectedAddress,
      salt: expectedSalt
    })

    await expectRevert(
      testVerifiers.verifyRelayedCall(deployRequestData, '0x00', { from: relayHub }),
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    // We change the initParams so the smart wallet address will be different
    // So there wont be any balance
    deployRequestData.request.data = '0x01'
    deployRequestData.request.tokenAmount = (tokensPaid + 100).toString()
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })

    await expectRevert(
      testVerifiers.verifyRelayedCall(deployRequestData, '0x00', { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expectRevert(
      testVerifiers.verifyRelayedCall(deployRequestData, '0x00', { from: relayHub }),
      'Token contract not allowed'
    )
  })

  it('SHOULD fail when factory is incorrect on preRelayCall', async function () {
    deployVerifier = await DeployVerifier.new(other1, { from: verifierOwner })
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct
    testVerifiers = await TestDeployVerifier.new(deployVerifier.address)

    await expectRevert(
      testVerifiers.verifyRelayedCall(deployRequestData, '0x00', { from: relayHub }),
      'Invalid factory'
    )
  })
})

contract('RelayVerifier', function ([relayHub, relayWorker, other, verifierOwner]) {
  let template: SmartWalletInstance
  let sw: SmartWalletInstance
  let relayVerifier: RelayVerifierInstance
  let token: TestTokenInstance
  let relayRequestData: RelayRequest
  let factory: SmartWalletFactoryInstance
  let testRelayVerifier: TestRelayVerifierInstance
  let incorrectTokenRelayRequestData: RelayRequest

  const senderPrivateKey = toBuffer(bytes32(1))
  let senderAddress: string

  before(async function () {
    const env = await getTestingEnvironment()
    const chainId = env.chainId

    senderAddress = bufferToHex(privateToAddress(senderPrivateKey)).toLowerCase()

    token = await TestToken.new()
    template = await SmartWallet.new()

    factory = await createSmartWalletFactory(template)

    relayVerifier = await RelayVerifier.new(factory.address, { from: verifierOwner })
    testRelayVerifier = await TestRelayVerifier.new(relayVerifier.address)

    sw = await createSmartWallet(relayHub, senderAddress, factory, senderPrivateKey, chainId)
    const smartWallet = sw.address
    const recipientContract = await TestRecipient.new()

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct

    relayRequestData = {
      request: {
        relayHub: relayHub,
        to: recipientContract.address,
        data: '0x00',
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenContract: token.address,
        tokenAmount: tokensPaid.toString(),
        tokenGas: '50000',
        enableQos: 'false',
      },
      relayData: {
        gasPrice,
        relayWorker,
        callForwarder: smartWallet,
        callVerifier: relayVerifier.address,
        domainSeparator: getDomainSeparatorHash(smartWallet, chainId)
      }
    }

    incorrectTokenRelayRequestData = {
      request: {
        relayHub: relayHub,
        to: recipientContract.address,
        data: '0x00',
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenContract: relayHub, // relayHub is an address not authorized as token contract
        tokenAmount: tokensPaid.toString(),
        tokenGas: '50000',
        enableQos: 'false',
      },
      relayData: {
        gasPrice,
        relayWorker,
        callForwarder: smartWallet,
        callVerifier: relayVerifier.address,
        domainSeparator: getDomainSeparatorHash(smartWallet, chainId)
      }
    }

    // we mint tokens to the sender,
    await token.mint(tokensPaid + 4, smartWallet)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await relayVerifier.acceptToken(token.address, { from: verifierOwner })
    // run method
    const { logs } = await testRelayVerifier.verifyRelayedCall(relayRequestData, '0x00', { from: relayHub })
    // All checks should pass
    assert.equal(logs[0].event, 'Accepted')
    assert.equal(logs[0].args[0].toNumber(), new BN(tokensPaid).toNumber())
    assert.equal(logs[0].args[1].toLowerCase(), senderAddress.toLowerCase())
    // expectEvent.inLogs(logs, 'Accepted', {
    //   tokenAmount: new BN(tokensPaid),
    //   from: senderAddress
    // })
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    relayRequestData.relayData.callForwarder = other
    // run method
    await expectRevert(
      testRelayVerifier.verifyRelayedCall(relayRequestData, '0x00', { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expectRevert(
      testRelayVerifier.verifyRelayedCall(incorrectTokenRelayRequestData, '0x00', { from: relayHub }),
      'Token contract not allowed'
    )
  })

  it('SHOULD fail on SW different to template of preRelayCall', async function () {
    // Forwarder needs to be a contract with balance
    // But a different than the template needed
    relayRequestData.relayData.callForwarder = token.address
    await token.mint(tokensPaid + 4, token.address)
    // run method
    await expectRevert(
      testRelayVerifier.verifyRelayedCall(relayRequestData, '0x00', { from: relayHub }),
      'SW different to template'
    )
  })
})

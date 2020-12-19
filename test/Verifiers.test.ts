import {
  DeployVerifierInstance,
  RelayVerifierInstance,
  TestTokenInstance,
  ProxyFactoryInstance,
  SmartWalletInstance,
  TestVerifiersInstance
} from '../types/truffle-contracts'

import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
import { ethers } from 'ethers'
import { toBuffer, bufferToHex, privateToAddress, BN } from 'ethereumjs-util'
import { toChecksumAddress, soliditySha3Raw } from 'web3-utils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getTestingEnvironment, createProxyFactory, createSmartWallet, bytes32 } from './TestUtils'
import { constants } from '../src/common/Constants'
import { Address } from '../src/relayclient/types/Aliases'
import { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'

const DeployVerifier = artifacts.require('DeployVerifier')
const RelayVerifier = artifacts.require('RelayVerifier')
const TestToken = artifacts.require('TestToken')
const SmartWallet = artifacts.require('SmartWallet')
const TestRecipient = artifacts.require('TestRecipient')
const TestVerifiers = artifacts.require('TestVerifiers')

const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
const tokensPaid = 1
let relayRequestData: RelayRequest

contract('DeployVerifier', function ([relayHub, dest, other1, relayWorker, senderAddress, other2, verifierOwner, other3]) {
  let deployVerifier: DeployVerifierInstance
  let token: TestTokenInstance
  let template: SmartWalletInstance
  let factory: ProxyFactoryInstance

  let testVerifiers: TestVerifiersInstance
  let expectedAddress: Address

  const ownerPrivateKey = toBuffer(bytes32(1))
  let ownerAddress: string
  const logicAddress = constants.ZERO_ADDRESS
  const initParams = '0x'

  const recoverer = constants.ZERO_ADDRESS
  const index = '0'

  beforeEach(async function () {
    ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)), (await getTestingEnvironment()).chainId).toLowerCase()
    token = await TestToken.new()
    template = await SmartWallet.new()

    factory = await createProxyFactory(template)

    deployVerifier = await DeployVerifier.new(factory.address, { from: verifierOwner })
    testVerifiers = await TestVerifiers.new(deployVerifier.address)

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct

    relayRequestData = {
      request: {
        to: logicAddress,
        data: initParams,
        from: ownerAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenContract: token.address,
        tokenAmount: tokensPaid.toString(),
        recoverer,
        index
      },
      relayData: {
        gasPrice,
        relayWorker,
        callForwarder: constants.ZERO_ADDRESS,
        callVerifier: deployVerifier.address,
        isSmartWalletDeploy: false,
        domainSeparator: '0x'
      }
    }
    // we mint tokens to the sender,
    expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, logicAddress,
      soliditySha3Raw({ t: 'bytes', v: initParams }), index)
    await token.mint(tokensPaid + 4, expectedAddress)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })

    const { logs } = await testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub })

    expectEvent.inLogs(logs, 'Accepted', {
      tokenAmount: new BN(tokensPaid),
      from: ownerAddress
    })
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })

    const toSign: string = web3.utils.soliditySha3(
      { t: 'bytes2', v: '0x1910' },
      { t: 'address', v: ownerAddress },
      { t: 'address', v: recoverer },
      { t: 'address', v: logicAddress },
      { t: 'uint256', v: index },
      { t: 'bytes', v: initParams }// Init params is empty
    ) ?? ''

    const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
    const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
    const signature = signingKey.signDigest(toSignAsBinaryArray)
    const signatureCollapsed = ethers.utils.joinSignature(signature)

    const { logs } = await factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
      index, initParams, signatureCollapsed)

    relayRequestData.request.from = ownerAddress
    relayRequestData.request.to = logicAddress
    relayRequestData.request.data = initParams

    const salt = web3.utils.soliditySha3(
      { t: 'address', v: ownerAddress },
      { t: 'address', v: recoverer },
      { t: 'address', v: logicAddress },
      { t: 'bytes32', v: soliditySha3Raw({ t: 'bytes', v: initParams }) },
      { t: 'uint256', v: index }
    ) ?? ''

    const expectedSalt = web3.utils.toBN(salt).toString()

    // Check the emitted event
    expectEvent.inLogs(logs, 'Deployed', {
      addr: expectedAddress,
      salt: expectedSalt
    })

    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    await deployVerifier.acceptToken(token.address, { from: verifierOwner })

    // We change the initParams so the smart wallet address will be different
    // So there wont be any balance
    relayRequestData.request.data = '0x01'

    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Token contract not allowed'
    )
  })

  it('SHOULD fail when factory is incorrect on preRelayCall', async function () {
    deployVerifier = await DeployVerifier.new(other1, { from: verifierOwner })

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct
    testVerifiers = await TestVerifiers.new(deployVerifier.address)

    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Invalid factory'
    )
  })
})

contract('RelayVerifier', function ([_, dest, relayManager, relayWorker, other, other2, verifierOwner, relayHub]) {
  let template: SmartWalletInstance
  let sw: SmartWalletInstance
  let relayVerifier: RelayVerifierInstance
  let token: TestTokenInstance
  let relayRequestData: RelayRequest
  let factory: ProxyFactoryInstance
  let testVerifiers: TestVerifiersInstance

  const senderPrivateKey = toBuffer(bytes32(1))
  let senderAddress: string

  before(async function () {
    const env = await getTestingEnvironment()
    const chainId = env.chainId

    senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)), chainId).toLowerCase()

    token = await TestToken.new()
    template = await SmartWallet.new()

    factory = await createProxyFactory(template)

    relayVerifier = await RelayVerifier.new(factory.address, { from: verifierOwner })
    testVerifiers = await TestVerifiers.new(relayVerifier.address)

    sw = await createSmartWallet(senderAddress, factory, senderPrivateKey, chainId)
    const smartWallet = sw.address
    const recipientContract = await TestRecipient.new()

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct

    relayRequestData = {
      request: {
        to: recipientContract.address,
        data: '0x00',
        from: senderAddress,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        tokenContract: token.address,
        tokenAmount: tokensPaid.toString(),
        recoverer: constants.ZERO_ADDRESS,
        index: '0'
      },
      relayData: {
        gasPrice,
        relayWorker,
        callForwarder: smartWallet,
        callVerifier: relayVerifier.address,
        isSmartWalletDeploy: false,
        domainSeparator: getDomainSeparatorHash(smartWallet, chainId)
      }
    }
    // we mint tokens to the sender,
    await token.mint(tokensPaid + 4, smartWallet)
  })

  it('Should not fail on checks of preRelayCall', async function () {
    await relayVerifier.acceptToken(token.address, { from: verifierOwner })
    // run method
    const { logs } = await testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub })
    // All checks should pass

    expectEvent.inLogs(logs, 'Accepted', {
      tokenAmount: new BN(tokensPaid),
      from: senderAddress
    })
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    await relayVerifier.acceptToken(token.address, { from: verifierOwner })
    relayRequestData.relayData.callForwarder = other
    // run method
    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'Token contract not allowed'
    )
  })

  it('SHOULD fail on SW different to template of preRelayCall', async function () {
    await relayVerifier.acceptToken(token.address, { from: verifierOwner })
    // Forwarder needs to be a contract with balance
    // But a different than the template needed
    relayRequestData.relayData.callForwarder = token.address
    await token.mint(tokensPaid + 4, token.address)
    // run method
    await expectRevert.unspecified(
      testVerifiers.preRelayedCall(relayRequestData, '0x00', '0x00', 6, { from: relayHub }),
      'SW different to template'
    )
  })
})

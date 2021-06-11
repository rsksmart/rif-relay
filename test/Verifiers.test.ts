import { ethers } from 'hardhat'
import { DeployRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import { getTestingEnvironment, createSmartWalletFactory, createSmartWallet, bytes32 } from './TestUtils'
import { constants } from '../src/common/Constants'
import { Address } from '../src/relayclient/types/Aliases'
import { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { TestDeployVerifier, TestDeployVerifier__factory, DeployVerifier, DeployVerifier__factory, RelayVerifier__factory, SmartWallet, SmartWalletFactory, SmartWallet__factory, TestRecipient__factory, TestToken, TestToken__factory, RelayVerifier } from '../typechain'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { TestRelayVerifier__factory } from '../typechain/factories/TestRelayVerifier__factory'
import { TestRelayVerifier } from '../typechain/TestRelayVerifier'

const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
const tokensPaid = 1

describe('DeployVerifier', function () {
  let DeployVerifier: DeployVerifier__factory
  let TestToken: TestToken__factory
  let SmartWallet: SmartWallet__factory
  let TestDeployVerifier: TestDeployVerifier__factory
  let relayHub: string
  let relayHubSigner: SignerWithAddress
  let other1: string
  let other1Signer: SignerWithAddress
  let relayWorker: string
  let relayWorkerSigner: SignerWithAddress
  let verifierOwnerSigner: SignerWithAddress
  let deployRequestData: DeployRequest
  let deployVerifier: DeployVerifier
  let token: TestToken
  let template: SmartWallet
  let factory: SmartWalletFactory

  let testDeployVerifier: TestDeployVerifier
  let expectedAddress: Address

  const ownerPrivateKey = bytes32(1)
  let ownerAddress: string

  const recoverer = constants.ZERO_ADDRESS
  const index = '0'

  before(async function () {
    DeployVerifier = await ethers.getContractFactory('DeployVerifier') as DeployVerifier__factory
    TestToken = await ethers.getContractFactory('TestToken') as TestToken__factory
    SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
    TestDeployVerifier = await ethers.getContractFactory('TestDeployVerifier') as TestDeployVerifier__factory
    [relayHubSigner, other1Signer, relayWorkerSigner, verifierOwnerSigner] = await ethers.getSigners()
    relayHub = await relayHubSigner.getAddress()
    other1 = await other1Signer.getAddress()
    relayWorker = await relayWorkerSigner.getAddress()
  })

  beforeEach(async function () {
    ownerAddress = ethers.utils.computeAddress(ownerPrivateKey)
    token = await TestToken.deploy()
    await token.deployed()
    template = await SmartWallet.deploy()
    await template.deployed()

    factory = await createSmartWalletFactory(template)

    deployVerifier = await DeployVerifier.connect(verifierOwnerSigner).deploy(factory.address)
    await deployVerifier.deployed()
    testDeployVerifier = await TestDeployVerifier.deploy(deployVerifier.address)
    await testDeployVerifier.deployed()

    // We simulate the testDeployVerifiers contract is a relayHub to make sure
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
        tokenGas: '50000'
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
    await deployVerifier.connect(verifierOwnerSigner).acceptToken(token.address)
    await expect(testDeployVerifier.connect(relayHubSigner).verifyRelayedCall(deployRequestData, '0x00')).to.emit(
      testDeployVerifier, 'Accepted').withArgs(
      tokensPaid,
      ownerAddress
    )

    // All checks should pass
    //   assert.equal(logs[0].event, 'Accepted')
    //   assert.equal(logs[0].args[0].toNumber(), new BN(tokensPaid).toNumber())
    //   assert.equal(logs[0].args[1].toLowerCase(), ownerAddress.toLowerCase())

    // expectEvent.inLogs(logs, 'Accepted', {
    //   tokenAmount: new BN(tokensPaid),
    //   from: ownerAddress
    // })
  })

  it('SHOULD fail on address already created on preRelayCall', async function () {
    await deployVerifier.connect(verifierOwnerSigner).acceptToken(token.address)

    const toSign: string = ethers.utils.solidityKeccak256(
      ['bytes2', 'address', 'address', 'uint256'],
      ['0x1910', ownerAddress, recoverer, index])

    const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
    const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
    const signature = signingKey.signDigest(toSignAsBinaryArray)
    const signatureCollapsed = ethers.utils.joinSignature(signature)

    deployRequestData.request.from = ownerAddress
    deployRequestData.request.to = constants.ZERO_ADDRESS
    deployRequestData.request.data = '0x'

    const salt = ethers.utils.solidityKeccak256(
      ['address', 'address', 'uint256'],
      [ownerAddress, recoverer, index])

    const expectedSalt = BigNumber.from(salt).toString()

    // Check the emitted event
    await expect(factory.createUserSmartWallet(ownerAddress, recoverer,
      index, signatureCollapsed)).to.emit(factory, 'Deployed').withArgs(
      expectedAddress, expectedSalt
    )

    await expect(
      testDeployVerifier.connect(relayHubSigner).verifyRelayedCall(deployRequestData, '0x00')).to.revertedWith(
      'Address already created!')
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    await deployVerifier.connect(verifierOwnerSigner).acceptToken(token.address)
    // We change the initParams so the smart wallet address will be different
    // So there wont be any balance
    deployRequestData.request.data = '0x01'
    deployRequestData.request.tokenAmount = (tokensPaid + 100).toString()

    await expect(
      testDeployVerifier.connect(relayHubSigner).verifyRelayedCall(deployRequestData, '0x00')).to.revertedWith(
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expect(
      testDeployVerifier.connect(relayHubSigner).verifyRelayedCall(deployRequestData, '0x00')).to.revertedWith(
      'Token contract not allowed'
    )
  })

  it('SHOULD fail when factory is incorrect on preRelayCall', async function () {
    deployVerifier = await DeployVerifier.connect(verifierOwnerSigner).deploy(other1)
    await deployVerifier.connect(verifierOwnerSigner).acceptToken(token.address)

    // We simulate the testVerifiers contract is a relayHub to make sure
    // the onlyRelayHub condition is correct
    testDeployVerifier = await TestDeployVerifier.deploy(deployVerifier.address)

    await expect(
      testDeployVerifier.connect(relayHubSigner).verifyRelayedCall(deployRequestData, '0x00')).to.revertedWith(
      'Invalid factory'
    )
  })
})

describe('RelayVerifier', function () {
  let template: SmartWallet
  let sw: SmartWallet
  let relayVerifier: RelayVerifier
  let token: TestToken
  let relayRequestData: RelayRequest
  let incorrectTokenRelayRequestData: RelayRequest
  let factory: SmartWalletFactory
  let testRelayVerifier: TestRelayVerifier
  let relayHubSigner: SignerWithAddress
  let relayWorkerSigner: SignerWithAddress
  let otherSigner: SignerWithAddress
  let verifierOwnerSigner: SignerWithAddress
  let relayHub: string
  let relayWorker: string
  let other: string
  let SmartWallet: SmartWallet__factory
  let RelayVerifier: RelayVerifier__factory
  let TestToken: TestToken__factory
  let TestRelayVerifier: TestRelayVerifier__factory
  let TestRecipient: TestRecipient__factory

  const senderPrivateKey = bytes32(1)
  let senderAddress: string

  before(async function () {
    SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
    RelayVerifier = await ethers.getContractFactory('RelayVerifier') as RelayVerifier__factory
    TestToken = await ethers.getContractFactory('TestToken') as TestToken__factory
    TestRecipient = await ethers.getContractFactory('TestRecipient') as TestRecipient__factory
    TestRelayVerifier = await ethers.getContractFactory('TestRelayVerifier') as TestRelayVerifier__factory
    [relayHubSigner, relayWorkerSigner, otherSigner, verifierOwnerSigner] = await ethers.getSigners()
    relayHub = await relayHubSigner.getAddress()
    relayWorker = await relayWorkerSigner.getAddress()
    other = await otherSigner.getAddress()
    const env = await getTestingEnvironment()
    const chainId = env.chainId

    senderAddress = ethers.utils.computeAddress(senderPrivateKey)

    token = await TestToken.deploy()
    await token.deployed()
    template = await SmartWallet.deploy()
    await template.deployed()

    factory = await createSmartWalletFactory(template)

    relayVerifier = await RelayVerifier.connect(verifierOwnerSigner).deploy(factory.address)
    await relayVerifier.deployed()
    testRelayVerifier = await TestRelayVerifier.deploy(relayVerifier.address)
    await testRelayVerifier.deployed()

    sw = await createSmartWallet(relayHub, senderAddress, factory, ethers.utils.arrayify(senderPrivateKey), chainId)
    const smartWallet = sw.address
    const recipientContract = await TestRecipient.deploy()
    await recipientContract.deployed()
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
        tokenGas: '50000'
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
        tokenGas: '50000'
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
    await relayVerifier.connect(verifierOwnerSigner).acceptToken(token.address)
    // run method
    await expect(await testRelayVerifier.connect(relayHubSigner).verifyRelayedCall(relayRequestData, '0x00')).to.emit(
      testRelayVerifier, 'Accepted'
    ).withArgs(
      tokensPaid,
      senderAddress
    )
    // All checks should pass
  //   assert.equal(logs[0].event, 'Accepted')
  //   assert.equal(logs[0].args[0].toNumber(), new BN(tokensPaid).toNumber())
  //   assert.equal(logs[0].args[1].toLowerCase(), senderAddress.toLowerCase())
    // expectEvent.inLogs(logs, 'Accepted', {
    //   tokenAmount: new BN(tokensPaid),
    //   from: senderAddress
    // })
  })

  it('SHOULD fail on Balance Too Low of preRelayCall', async function () {
    relayRequestData.relayData.callForwarder = other
    // run method
    await expect(
      testRelayVerifier.connect(relayHubSigner).verifyRelayedCall(relayRequestData, '0x00')).to.revertedWith(
      'balance too low'
    )
  })

  it('SHOULD fail on Token contract not allowed of preRelayCall', async function () {
    await expect(
      testRelayVerifier.connect(relayHubSigner).verifyRelayedCall(incorrectTokenRelayRequestData, '0x00')).to.revertedWith(
      'Token contract not allowed'
    )
  })

  it('SHOULD fail on SW different to template of preRelayCall', async function () {
    // Forwarder needs to be a contract with balance
    // But a different than the template needed
    relayRequestData.relayData.callForwarder = token.address
    await token.mint(tokensPaid + 4, token.address)
    // run method
    await expect(
      testRelayVerifier.connect(relayHubSigner).verifyRelayedCall(relayRequestData, '0x00')).to.revertedWith(
      'SW different to template'
    )
  })
})

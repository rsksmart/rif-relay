import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { expect } from 'chai'
import { bytes32, getTestingEnvironment, stripHex } from './TestUtils'
// @ts-ignore
import { signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { Environment } from '../src/common/Environments'
import { DeployRequestDataType, getDomainSeparatorHash, TypedDeployRequestData } from '../src/common/EIP712/TypedRequestData'
import { constants } from '../src/common/Constants'
import { DeployRequest } from '../src/common/EIP712/RelayRequest'
import { CustomSmartWallet, CustomSmartWalletFactory, CustomSmartWalletFactory__factory, CustomSmartWallet__factory, SmartWallet, SmartWalletFactory, SmartWalletFactory__factory, SmartWallet__factory, TestToken, TestToken__factory } from '../typechain'

const keccak256 = ethers.utils.keccak256

describe('CustomSmartWalletFactory', () => {
  let TestTokenFactory: TestToken__factory
  let fwd: CustomSmartWallet
  let token: TestToken
  let factory: CustomSmartWalletFactory
  let FactoryOfCustomSmartWallet: CustomSmartWallet__factory
  let FactoryOfCustomSmartWalletFactory: CustomSmartWalletFactory__factory
  let chainId: number
  const ownerPrivateKey = bytes32(1)
  let ownerAddress: string
  const recipientPrivateKey = bytes32(1)
  let recipientAddress: string
  let env: Environment
  let from: string

  const request: DeployRequest = {
    request: {
      relayHub: constants.ZERO_ADDRESS,
      from: constants.ZERO_ADDRESS,
      to: constants.ZERO_ADDRESS,
      value: '0',
      nonce: '0',
      data: '0x',
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '0',
      tokenGas: '60000',
      recoverer: constants.ZERO_ADDRESS,
      index: '0'
    },
    relayData: {
      gasPrice: '1',
      relayWorker: constants.ZERO_ADDRESS,
      callForwarder: constants.ZERO_ADDRESS,
      callVerifier: constants.ZERO_ADDRESS,
      domainSeparator: '0x'
    }
  }

  before(async () => {
    FactoryOfCustomSmartWallet = await ethers.getContractFactory('CustomSmartWallet') as CustomSmartWallet__factory
    FactoryOfCustomSmartWalletFactory = await ethers.getContractFactory('CustomSmartWalletFactory') as CustomSmartWalletFactory__factory
    TestTokenFactory = await ethers.getContractFactory('TestToken') as TestToken__factory
    env = await getTestingEnvironment()
    chainId = env.chainId
    ownerAddress = ethers.utils.computeAddress(ownerPrivateKey).toLowerCase()
    recipientAddress = ethers.utils.computeAddress(recipientPrivateKey).toLowerCase()
    request.request.from = ownerAddress
    fwd = await FactoryOfCustomSmartWallet.deploy()
    await fwd.deployed()
  })

  beforeEach(async () => {
    // A new factory for new create2 addresses each
    factory = await FactoryOfCustomSmartWalletFactory.deploy(fwd.address)
    await factory.deployed()
    request.relayData.callForwarder = factory.address
    request.relayData.domainSeparator = getDomainSeparatorHash(factory.address, chainId)
  })

  describe('#getCreationBytecode', () => {
    it('should return the expected bytecode', async () => {
      const expectedCode = '0x602D3D8160093D39F3363D3D373D3D3D3D363D73' +
            stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'
      const code = await factory.getCreationBytecode()
      expect(BigNumber.from(expectedCode)).to.be.equal(BigNumber.from(code))
    })
  })

  describe('#getRuntimeCodeHash', () => {
    it('should return the expected code hash', async () => {
      const expectedCode = '0x363D3D373D3D3D3D363D73' + stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'
      const expectedCodeHash = keccak256(expectedCode)

      const code = await factory.runtimeCodeHash()
      expect(BigNumber.from(expectedCodeHash)).to.be.equal(BigNumber.from(code))
    })
  })

  describe('#getSmartWalletAddress', () => {
    it('should create the correct create2 Address', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParamsHash = constants.SHA3_NULL_S
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const create2Address = await factory.getSmartWalletAddress(ownerAddress, recoverer, logicAddress, initParamsHash, index)
      const creationByteCode = await factory.getCreationBytecode()
      const salt: string = ethers.utils.solidityKeccak256(
        ['address', 'address', 'address', 'bytes32', 'uint256'],
        [ownerAddress, recoverer, logicAddress, initParamsHash, index]
      )

      const bytecodeHash = ethers.utils.solidityKeccak256(['bytes'], [creationByteCode])

      const _data: string = ethers.utils.solidityKeccak256(
        ['bytes1', 'address', 'bytes32', 'bytes32'], ['0xff', factory.address, salt, bytecodeHash]
      ) ?? ''

      const expectedAddress = ethers.utils.getAddress('0x' + _data.slice(26, _data.length))
      expect(expectedAddress).to.be.equal(create2Address)
    })
  })

  describe('#createUserSmartWallet', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'address', 'uint256', 'bytes'],
        ['0x1910', ownerAddress, recoverer, logicAddress, index, initParams] // Init params is empty
      )

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      const _initParams: string = ethers.utils.solidityKeccak256(
        ['bytes'], [initParams])

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      const salt = ethers.utils.solidityKeccak256(['address', 'address', 'address', 'bytes32', 'uint256'],
        [ownerAddress, recoverer, logicAddress, _initParams, index])

      const expectedSalt = BigNumber.from(salt).toString()

      await expect(factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed)).to.emit(factory, 'Deployed').withArgs(expectedAddress, expectedSalt)

      //     expectEvent.inLogs(logs, 'Deployed', {
      //       addr: expectedAddress,
      //       salt: expectedSalt
      //     })
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])
      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'address', 'uint256', 'bytes'],
        ['0x1910', ownerAddress, recoverer, logicAddress, index, initParams])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const tx = await factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed)
      const receipt = await tx.wait()

      const code = await ethers.provider.getCode(expectedAddress, receipt.blockNumber)
      expect(BigNumber.from(expectedCode)).to.be.equal(BigNumber.from(code))
    })

    it('should revert for an invalid signature', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x00'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'address', 'uint256', 'bytes'],
        ['0x1910', ownerAddress, recoverer, logicAddress, index, initParams])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      let signatureCollapsed: string = ethers.utils.joinSignature(signature)

      signatureCollapsed = signatureCollapsed.substr(0, signatureCollapsed.length - 1).concat('0')

      await expect(factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed)).to.be.revertedWith('invalid signature')
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])
      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'address', 'uint256', 'bytes'],
        ['0x1910', ownerAddress, recoverer, logicAddress, index, initParams])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      const salt = ethers.utils.solidityKeccak256(
        ['address', 'address', 'address', 'bytes32', 'uint256'],
        [ownerAddress, recoverer, logicAddress, _initParams, index])

      const expectedSalt = BigNumber.from(salt).toString()

      // expectEvent.inLogs(logs, 'Deployed', {
      //   addr: expectedAddress,
      //   salt: expectedSalt
      // })

      const tx = await factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed)
      const receipt = await tx.wait()

      // Check the emitted event
      const event = factory.filters.Deployed(null, null)
      const eventEmitted = await factory.queryFilter(event)
      expect(eventEmitted[0].event).to.be.equal('Deployed')
      expect(eventEmitted[0].args.addr).to.be.equal(expectedAddress)
      expect(eventEmitted[0].args.salt).to.be.equal(expectedSalt)

      const ABI = ['function isInitialized()']
      const iface = new ethers.utils.Interface(ABI)
      const trx = await ethers.provider.getTransaction(receipt.transactionHash)
      const isInitializedFunc = iface.encodeFunctionData('isInitialized()')

      const newTrx = {
        from: trx.from,
        gasLimit: trx.gasLimit,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await ethers.provider.call(newTrx)
      // let result = await web3.eth.call(newTrx)

      // It should be initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))
      const initFuncABI = ['function initialize(address,address,address,address,uint256,uint256,bytes)']
      const initFuncABIif = new ethers.utils.Interface(initFuncABI)
      const initFunc = initFuncABIif.encodeFunctionData('initialize', [ownerAddress, logicAddress, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0x00', '0x00', initParams])

      // const initFunc = await web3.eth.abi.encodeFunctionCall({
      //   name: 'initialize',
      //   type: 'function',
      //   inputs: [{
      //     type: 'address',
      //     name: 'owner'
      //   },
      //   {
      //     type: 'address',
      //     name: 'logic'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenAddr'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenRecipient'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenAmount'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenGas'
      //   },
      //   {
      //     type: 'bytes',
      //     name: 'initParams'
      //   }
      //   ]
      // }, [ownerAddress, logicAddress, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0x00', '0x00', initParams])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      const signer = await ethers.getSigner(trx.from)
      await expect(signer.sendTransaction(newTrx)).to.be.revertedWith('already initialized')
      // await expectRevert.unspecified(web3.eth.sendTransaction(newTrx), 'Already initialized')

      newTrx.data = isInitializedFunc
      result = await ethers.provider.call(newTrx)

      // The smart wallet should be still initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))
    })
  })

  describe('#relayedUserSmartWalletCreation', () => {
    before(async () => {
      from = await ethers.provider.getSigner().getAddress()
    })

    it('should create the Smart Wallet in the expected address', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      token = await TestTokenFactory.deploy()
      await token.deployed()
      await token.mint('200', expectedAddress)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      req.request.relayHub = from
      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )
      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })
      // relayData information
      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))
      const salt: string = ethers.utils.solidityKeccak256(
        ['address', 'address', 'address', 'bytes32', 'uint256'],
        [ownerAddress, recoverer, logicAddress, _initParams, index]
      )

      const expectedSalt = BigNumber.from(salt).toString()

      // Check the emitted event
      await expect(factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)).to.be.emit(factory, 'Deployed')
        .withArgs(expectedAddress, expectedSalt)

      // expectEvent.inLogs(logs, 'Deployed', {
      //   addr: expectedAddress,
      //   salt: expectedSalt
      // })

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(deployPrice)
      expect(expectedBalance).to.be.equal(newBalance)
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      token = await TestTokenFactory.deploy()
      await token.deployed()
      await token.mint('200', expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      req.request.relayHub = from

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))
      const tx = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)
      const receipt = await tx.wait()

      const code = await ethers.provider.getCode(expectedAddress, receipt.blockNumber)

      expect(BigNumber.from(expectedCode)).to.be.equal(BigNumber.from(code))
    })

    it('should revert for an invalid signature', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }
      req.request.relayHub = from

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })

      req.request.tokenAmount = '9'

      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))

      await expect(factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)).to.be.revertedWith('signature mismatch')

      const newBalance = await token.balanceOf(expectedAddress)
      expect(originalBalance).to.be.equal(newBalance)
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, _initParams, index)

      token = await TestTokenFactory.deploy()
      await token.deployed()
      await token.mint('200', expectedAddress)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }
      req.request.relayHub = from

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))
      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })
      const tx = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)
      const receipt = await tx.wait()

      const salt = ethers.utils.solidityKeccak256(['address', 'address', 'address', 'bytes32', 'uint256'], [ownerAddress, recoverer, logicAddress, _initParams, index])
      const expectedSalt = BigNumber.from(salt).toString()

      // Check the emitted event
      // expectEvent.inLogs(logs, 'Deployed', {
      //   addr: expectedAddress,
      //   salt: expectedSalt
      // })
      // Check the emitted event
      const event = factory.filters.Deployed(null, null)
      const eventEmitted = await factory.queryFilter(event)
      expect(eventEmitted[0].event).to.be.equal('Deployed')
      expect(eventEmitted[0].args.addr).to.be.equal(expectedAddress)
      expect(eventEmitted[0].args.salt).to.be.equal(expectedSalt)

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(BigNumber.from(deployPrice))
      expect(expectedBalance).to.be.equal(newBalance)

      const ABI = ['function isInitialized()']
      const iface = new ethers.utils.Interface(ABI)

      const trx = await ethers.provider.getTransaction(receipt.transactionHash)
      const isInitializedFunc = iface.encodeFunctionData('isInitialized()')

      const newTrx = {
        from: trx.from,
        gasLimit: trx.gasLimit,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await ethers.provider.call(newTrx)
      // let result = await web3.eth.call(newTrx)

      // It should be initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))

      const initFuncABI = ['function initialize(address,address,address,address,uint256,uint256,bytes)']
      const initFuncABIif = new ethers.utils.Interface(initFuncABI)
      const initFunc = initFuncABIif.encodeFunctionData('initialize', [ownerAddress, logicAddress, token.address, recipientAddress, deployPrice, '0xD6D8', initParams])

      // const initFunc = web3.eth.abi.encodeFunctionCall({
      //   name: 'initialize',
      //   type: 'function',
      //   inputs: [{
      //     type: 'address',
      //     name: 'owner'
      //   },
      //   {
      //     type: 'address',
      //     name: 'logic'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenAddr'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenRecipient'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenAmount'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenGas'
      //   },
      //   {
      //     type: 'bytes',
      //     name: 'initParams'
      //   }
      //   ]
      // }, [ownerAddress, logicAddress, token.address, recipientAddress, deployPrice, '0xD6D8', initParams])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      const signer = await ethers.getSigner(trx.from)
      await expect(signer.sendTransaction(newTrx)).to.be.revertedWith('already initialized')

      newTrx.data = isInitializedFunc
      result = await ethers.provider.call(newTrx)

      // The smart wallet should be still initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))
    })
  })
})

describe('SmartWalletFactory', () => {
  let TestTokenFactory: TestToken__factory
  let FactoryOfSmartWallet: SmartWallet__factory
  let FactoryOfSmartWalletFactory: SmartWalletFactory__factory
  let token: TestToken
  let fwd: SmartWallet
  let factory: SmartWalletFactory
  let chainId: number
  const ownerPrivateKey = bytes32(1)
  let ownerAddress: string
  const recipientPrivateKey = bytes32(1)
  let recipientAddress: string
  let env: Environment

  const request: DeployRequest = {
    request: {
      relayHub: constants.ZERO_ADDRESS,
      from: constants.ZERO_ADDRESS,
      to: constants.ZERO_ADDRESS,
      value: '0',
      nonce: '0',
      data: '0x',
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '1',
      tokenGas: '50000',
      recoverer: constants.ZERO_ADDRESS,
      index: '0'
    },
    relayData: {
      gasPrice: '1',
      relayWorker: constants.ZERO_ADDRESS,
      callForwarder: constants.ZERO_ADDRESS,
      callVerifier: constants.ZERO_ADDRESS,
      domainSeparator: '0x'
    }
  }

  before(async () => {
    const from = (await ethers.getSigners())[0]
    request.request.relayHub = await from.getAddress()
    FactoryOfSmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
    FactoryOfSmartWalletFactory = await ethers.getContractFactory('SmartWalletFactory') as SmartWalletFactory__factory
    TestTokenFactory = await ethers.getContractFactory('TestToken') as TestToken__factory
    env = await getTestingEnvironment()
    chainId = env.chainId
    ownerAddress = ethers.utils.computeAddress(ownerPrivateKey).toLowerCase()
    recipientAddress = ethers.utils.computeAddress(recipientPrivateKey).toLowerCase()
    request.request.from = ownerAddress
    fwd = await FactoryOfSmartWallet.deploy()
    await fwd.deployed()
  })

  beforeEach(async () => {
    // A new factory for new create2 addresses each
    factory = await FactoryOfSmartWalletFactory.deploy(fwd.address)
    request.relayData.callForwarder = factory.address
    request.relayData.domainSeparator = getDomainSeparatorHash(factory.address, chainId)
  })

  describe('#getCreationBytecode', () => {
    it('should return the expected bytecode', async () => {
      const expectedCode = '0x602D3D8160093D39F3363D3D373D3D3D3D363D73' +
            stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'

      const code = await factory.getCreationBytecode()
      expect(BigNumber.from(expectedCode)).to.be.equal(BigNumber.from(code))
    })
  })

  describe('#getRuntimeCodeHash', () => {
    it('should return the expected code hash', async () => {
      const expectedCode = '0x363D3D373D3D3D3D363D73' + stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'
      const expectedCodeHash = keccak256(expectedCode)

      const code = await factory.runtimeCodeHash()
      expect(BigNumber.from(expectedCodeHash)).to.be.equal(BigNumber.from(code))
    })
  })

  describe('#getSmartWalletAddress', () => {
    it('should create the correct create2 Address', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const create2Address = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)
      const creationByteCode = await factory.getCreationBytecode()

      const salt: string = ethers.utils.solidityKeccak256(
        ['address', 'address', 'uint256'], [ownerAddress, recoverer, index])

      const bytecodeHash: string = ethers.utils.solidityKeccak256(['bytes'], [creationByteCode])

      const _data: string = ethers.utils.solidityKeccak256(
        ['bytes1', 'address', 'bytes32', 'bytes32'],
        ['0xff', factory.address, salt, bytecodeHash])

      const expectedAddress = ethers.utils.getAddress('0x' + _data.slice(26, _data.length))
      expect(create2Address).to.be.equal(expectedAddress)
    })
  })

  describe('#createUserSmartWallet', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'uint256'],
        ['0x1910', ownerAddress, recoverer, index])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      const salt = ethers.utils.solidityKeccak256(
        ['address', 'address', 'uint256'],
        [ownerAddress, recoverer, index])

      const expectedSalt = BigNumber.from(salt).toString()

      await expect(factory.createUserSmartWallet(ownerAddress, recoverer,
        index, signatureCollapsed)).to.emit(factory, 'Deployed').withArgs(expectedAddress, expectedSalt)
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'uint256'],
        ['0x1910', ownerAddress, recoverer, index])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const tx = await factory.createUserSmartWallet(ownerAddress, recoverer, index, signatureCollapsed)
      const receipt = await tx.wait()

      const code = await ethers.provider.getCode(expectedAddress, receipt.blockNumber)

      expect(BigNumber.from(expectedCode)).to.be.equal(BigNumber.from(code))
    })

    it('should revert for an invalid signature', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'uint256'],
        ['0x1910', ownerAddress, recoverer, index])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      let signatureCollapsed: string = ethers.utils.joinSignature(signature)

      signatureCollapsed = signatureCollapsed.substr(0, signatureCollapsed.length - 1).concat('0')

      await expect(factory.createUserSmartWallet(ownerAddress, recoverer,
        index, signatureCollapsed)).to.be.revertedWith('invalid signature')
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      const toSign: string = ethers.utils.solidityKeccak256(
        ['bytes2', 'address', 'address', 'uint256'],
        ['0x1910', ownerAddress, recoverer, index])

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      const tx = await factory.createUserSmartWallet(ownerAddress, recoverer,
        index, signatureCollapsed)
      const receipt = await tx.wait()

      const salt = ethers.utils.solidityKeccak256(
        ['address', 'address', 'uint256'],
        [ownerAddress, recoverer, index])

      const expectedSalt = BigNumber.from(salt).toString()

      // Check the emitted event
      const event = factory.filters.Deployed(null, null)
      const eventEmitted = await factory.queryFilter(event)
      expect(eventEmitted[0].event).to.be.equal('Deployed')
      expect(eventEmitted[0].args.addr).to.be.equal(expectedAddress)
      expect(eventEmitted[0].args.salt).to.be.equal(expectedSalt)

      const ABI = ['function isInitialized()']
      const iface = new ethers.utils.Interface(ABI)
      const trx = await ethers.provider.getTransaction(receipt.transactionHash)
      const isInitializedFunc = iface.encodeFunctionData('isInitialized()')

      const newTrx = {
        from: trx.from,
        gasLimit: trx.gasLimit,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await ethers.provider.call(newTrx)

      // It should be initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))

      const initFuncABI = ['function initialize(address,address,address,uint256,uint256)']
      const initFuncABIif = new ethers.utils.Interface(initFuncABI)
      const initFunc = initFuncABIif.encodeFunctionData('initialize', [ownerAddress, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0x00', '0x00'])

      // const initFunc = await web3.eth.abi.encodeFunctionCall({
      //   name: 'initialize',
      //   type: 'function',
      //   inputs: [{
      //     type: 'address',
      //     name: 'owner'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenAddr'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenRecipient'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenAmount'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenGas'
      //   }
      //   ]
      // }, [ownerAddress, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0x00', '0x00'])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      const signer = await ethers.getSigner(trx.from)
      await expect(signer.sendTransaction(newTrx)).to.be.revertedWith('already initialized')

      newTrx.data = isInitializedFunc
      result = await ethers.provider.call(newTrx)

      // The smart wallet should be still initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))
    })
  })

  describe('#relayedUserSmartWalletCreation', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      token = await TestTokenFactory.deploy()
      await token.deployed()
      await token.mint('200', expectedAddress)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })

      // relayData information
      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))

      const salt: string = ethers.utils.solidityKeccak256(
        ['address', 'address', 'uint256'],
        [ownerAddress, recoverer, index]
      )

      const expectedSalt = BigNumber.from(salt).toString()

      // Check the emitted event
      // expectEvent.inLogs(logs, 'Deployed', {
      //   addr: expectedAddress,
      //   salt: expectedSalt
      // })

      await expect(factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)).to.emit(factory, 'Deployed').withArgs(expectedAddress, expectedSalt)

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(BigNumber.from(deployPrice))
      expect(expectedBalance).to.be.equal(newBalance)
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      token = await TestTokenFactory.deploy()
      await token.deployed()
      await token.mint('200', expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))
      const tx = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)
      const receipt = await tx.wait()

      const code = await ethers.provider.getCode(expectedAddress, receipt.blockNumber)

      expect(BigNumber.from(expectedCode)).to.be.equal(BigNumber.from(code))
    })

    it('should revert for an invalid signature', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })

      req.request.tokenAmount = '8' // change data after signature

      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))

      await expect(factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)).to.be.revertedWith('signature mismatch')

      const newBalance = await token.balanceOf(expectedAddress)
      expect(originalBalance).to.be.equal(newBalance)
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      token = await TestTokenFactory.deploy()
      await token.deployed()
      await token.mint('200', expectedAddress)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req: DeployRequest = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedDeployRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ethers.utils.arrayify(ownerPrivateKey), { data: dataToSign })
      const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))
      const tx = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), suffixData, sig)
      const receipt = await tx.wait()

      const salt = ethers.utils.solidityKeccak256(['address', 'address', 'uint256'], [ownerAddress, recoverer, index])
      const expectedSalt = BigNumber.from(salt).toString()

      // Check the emitted event

      const event = factory.filters.Deployed(null, null)
      const eventEmitted = await factory.queryFilter(event)
      expect(eventEmitted[0].event).to.be.equal('Deployed')
      expect(eventEmitted[0].args.addr).to.be.equal(expectedAddress)
      expect(eventEmitted[0].args.salt).to.be.equal(expectedSalt)

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(BigNumber.from(deployPrice))
      expect(expectedBalance).to.be.equal(newBalance)

      // const isInitializedFunc = web3.eth.abi.encodeFunctionCall({
      //   name: 'isInitialized',
      //   type: 'function',
      //   inputs: []
      // }, [])
      const ABI = ['function isInitialized()']
      const iface = new ethers.utils.Interface(ABI)

      const trx = await ethers.provider.getTransaction(receipt.transactionHash)
      const isInitializedFunc = iface.encodeFunctionData('isInitialized()')
      // const trx = await web3.eth.getTransaction(logs[0].transactionHash)

      const newTrx = {
        from: trx.from,
        gasLimit: trx.gasLimit,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await ethers.provider.call(newTrx)

      // It should be initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))

      const initFuncABI = ['function initialize(address,address,address,uint256,uint256)']
      const initFuncABIif = new ethers.utils.Interface(initFuncABI)
      const initFunc = initFuncABIif.encodeFunctionData('initialize', [ownerAddress, token.address, recipientAddress, deployPrice, '0xD6D8'])

      // const initFunc = await web3.eth.abi.encodeFunctionCall({
      //   name: 'initialize',
      //   type: 'function',
      //   inputs: [{
      //     type: 'address',
      //     name: 'owner'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenAddr'
      //   },
      //   {
      //     type: 'address',
      //     name: 'tokenRecipient'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenAmount'
      //   },
      //   {
      //     type: 'uint256',
      //     name: 'tokenGas'
      //   }
      //   ]
      // }, [ownerAddress, token.address, recipientAddress, deployPrice, '0xD6D8'])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      const signer = await ethers.getSigner(trx.from)
      await expect(signer.sendTransaction(newTrx)).to.be.revertedWith('revert already initialized')
      // await expect(web3.eth.sendTransaction(newTrx), 'Already initialized')

      newTrx.data = isInitializedFunc
      result = await ethers.provider.call(newTrx)

      // The smart wallet should be still initialized
      expect(BigNumber.from(1)).to.be.equal(BigNumber.from(result))
    })
  })
})

import {
  SmartWalletInstance,
  TestTokenInstance,
  ProxyFactoryInstance,
  SimpleSmartWalletInstance,
  SimpleProxyFactoryInstance
} from '../types/truffle-contracts'
  // @ts-ignore
import { signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
import { toChecksumAddress, soliditySha3Raw } from 'web3-utils'
import { ethers } from 'ethers'
import chai from 'chai'
import { bytes32, getTestingEnvironment, stripHex } from './TestUtils'
import { Environment } from '../src/common/Environments'
import TypedRequestData, { DeployRequestDataType, ENVELOPING_PARAMS, ForwardRequestType, getDomainSeparatorHash, GsnRequestType, TypedDeployRequestData } from '../src/common/EIP712/TypedRequestData'
import { constants } from '../src/common/Constants'
import { DeployRequest } from '../src/common/EIP712/RelayRequest'

const keccak256 = web3.utils.keccak256

const TestToken = artifacts.require('TestToken')

contract('ProxyFactory', ([from]) => {
  const SmartWallet = artifacts.require('SmartWallet')
  const ProxyFactory = artifacts.require('ProxyFactory')
  let fwd: SmartWalletInstance
  let token: TestTokenInstance
  let factory: ProxyFactoryInstance
  let chainId: number
  const ownerPrivateKey = toBuffer(bytes32(1))
  let ownerAddress: string
  const versionHash = keccak256('2')
  const recipientPrivateKey = toBuffer(bytes32(1))
  let recipientAddress: string
  const typeHash = keccak256(`${GsnRequestType.typeName}(${ENVELOPING_PARAMS},${GsnRequestType.typeSuffix}`)

  let env: Environment

  const request: DeployRequest = {
    request: {
      from: constants.ZERO_ADDRESS,
      to: constants.ZERO_ADDRESS,
      value: '0',
      gas: '400000',
      nonce: '0',
      data: '0x',
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '1',
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
    chainId = (await getTestingEnvironment()).chainId
    ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)), chainId).toLowerCase()
    recipientAddress = toChecksumAddress(bufferToHex(privateToAddress(recipientPrivateKey)), chainId).toLowerCase()
    request.request.from = ownerAddress
    env = await getTestingEnvironment()
    fwd = await SmartWallet.new()
  })

  beforeEach(async () => {
    // A new factory for new create2 addresses each
    factory = await ProxyFactory.new(fwd.address, versionHash)
    request.relayData.callForwarder = factory.address
    request.relayData.domainSeparator = getDomainSeparatorHash(factory.address, chainId)
  })

  describe('#getCreationBytecode', () => {
    it('should return the expected bytecode', async () => {
      const expectedCode = '0x602D3D8160093D39F3363D3D373D3D3D3D363D73' +
            stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'

      const code = await factory.getCreationBytecode()
      chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))
    })
  })

  describe('#getRuntimeCodeHash', () => {
    it('should return the expected code hash', async () => {
      const expectedCode = '0x363D3D373D3D3D3D363D73' + stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'
      const expectedCodeHash = keccak256(expectedCode)

      const code = await factory.runtimeCodeHash()
      chai.expect(web3.utils.toBN(expectedCodeHash)).to.be.bignumber.equal(web3.utils.toBN(code))
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

      const salt: string = web3.utils.soliditySha3(
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'address', v: logicAddress },
        { t: 'bytes32', v: initParamsHash },
        { t: 'uint256', v: index }
      ) ?? ''

      const bytecodeHash: string = web3.utils.soliditySha3(
        { t: 'bytes', v: creationByteCode }
      ) ?? ''

      const _data: string = web3.utils.soliditySha3(
        { t: 'bytes1', v: '0xff' },
        { t: 'address', v: factory.address },
        { t: 'bytes32', v: salt },
        { t: 'bytes32', v: bytecodeHash }
      ) ?? ''

      const expectedAddress = toChecksumAddress('0x' + _data.slice(26, _data.length), env.chainId)
      assert.equal(create2Address, expectedAddress)
    })
  })

  describe('#createUserSmartWallet', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

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

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

      const salt = web3.utils.soliditySha3(
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'address', v: logicAddress },
        { t: 'bytes32', v: soliditySha3Raw({ t: 'bytes', v: initParams }) },
        { t: 'uint256', v: index }
      ) ?? ''

      const expectedSalt = web3.utils.toBN(salt).toString()

      expectEvent.inLogs(logs, 'Deployed', {
        addr: expectedAddress,
        salt: expectedSalt
      })
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

      const toSign: string = web3.utils.soliditySha3(
        { t: 'bytes2', v: '0x1910' },
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'address', v: logicAddress },
        { t: 'uint256', v: index },
        { t: 'bytes', v: initParams }
      ) ?? ''

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const { logs } = await factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed)

      const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

      chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))
    })

    it('should revert for an invalid signature', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x00'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const toSign: string = web3.utils.soliditySha3(
        { t: 'bytes2', v: '0x1910' },
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'address', v: logicAddress },
        { t: 'uint256', v: index },
        { t: 'bytes', v: initParams }
      ) ?? ''

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      let signatureCollapsed: string = ethers.utils.joinSignature(signature)

      signatureCollapsed = signatureCollapsed.substr(0, signatureCollapsed.length - 1).concat('0')

      await expectRevert.unspecified(factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed))
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

      const toSign: string = web3.utils.soliditySha3(
        { t: 'bytes2', v: '0x1910' },
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'address', v: logicAddress },
        { t: 'uint256', v: index },
        { t: 'bytes', v: initParams }
      ) ?? ''

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      const signatureCollapsed = ethers.utils.joinSignature(signature)

      const { logs } = await factory.createUserSmartWallet(ownerAddress, recoverer, logicAddress,
        index, initParams, signatureCollapsed)

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

      const isInitializedFunc = web3.eth.abi.encodeFunctionCall({
        name: 'isInitialized',
        type: 'function',
        inputs: []
      }, [])

      const trx = await web3.eth.getTransaction(logs[0].transactionHash)

      const newTrx = {
        from: trx.from,
        gas: trx.gas,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await web3.eth.call(newTrx)

      let resultStr = result as string

      // It should be initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))

      const initFunc = await web3.eth.abi.encodeFunctionCall({
        name: 'initialize',
        type: 'function',
        inputs: [{
          type: 'address',
          name: 'owner'
        },
        {
          type: 'address',
          name: 'logic'
        },
        {
          type: 'address',
          name: 'tokenAddr'
        },
        {
          type: 'bytes32',
          name: 'versionHash'
        },
        {
          type: 'bytes',
          name: 'initParams'
        },
        {
          type: 'bytes',
          name: 'transferData'
        }
        ]
      }, [ownerAddress, logicAddress, constants.ZERO_ADDRESS, versionHash, initParams, '0x00'])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      await expectRevert.unspecified(web3.eth.sendTransaction(newTrx), 'Already initialized')

      newTrx.data = isInitializedFunc
      result = await web3.eth.call(newTrx)
      resultStr = result as string

      // The smart wallet should be still initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))
    })
  })

  describe('#relayedUserSmartWalletCreation', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

      token = await TestToken.new()
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

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })

      // relayData information
      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))

      const { logs } = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig)

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

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(web3.utils.toBN(deployPrice))
      chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

      token = await TestToken.new()
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

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))
      const { logs } = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig)

      const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

      chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))
    })

    it('should revert for an invalid signature', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

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

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })

      req.request.tokenAmount = '9'

      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))

      await expectRevert.unspecified(factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig))

      const newBalance = await token.balanceOf(expectedAddress)
      chai.expect(originalBalance).to.be.bignumber.equal(newBalance)
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const logicAddress = constants.ZERO_ADDRESS
      const initParams = '0x'
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const versionHash = keccak256('2')

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer,
        logicAddress, soliditySha3Raw({ t: 'bytes', v: initParams }), index)

      token = await TestToken.new()
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

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })
      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + DeployRequestDataType.length) * 32))

      const { logs } = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig)

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

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(web3.utils.toBN(deployPrice))
      chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)

      const isInitializedFunc = web3.eth.abi.encodeFunctionCall({
        name: 'isInitialized',
        type: 'function',
        inputs: []
      }, [])

      const trx = await web3.eth.getTransaction(logs[0].transactionHash)

      const newTrx = {
        from: trx.from,
        gas: trx.gas,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await web3.eth.call(newTrx)

      let resultStr = result as string

      // It should be initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))

      const transferFunc = await web3.eth.abi.encodeFunctionCall({
        name: 'transfer',
        type: 'function',
        inputs: [{
          type: 'address',
          name: '_to'
        },
        {
          type: 'uint256',
          name: '_value'
        }
        ]
      }, [
        recipientAddress, deployPrice
      ])

      const initFunc = web3.eth.abi.encodeFunctionCall({
        name: 'initialize',
        type: 'function',
        inputs: [{
          type: 'address',
          name: 'owner'
        },
        {
          type: 'address',
          name: 'logic'
        },
        {
          type: 'address',
          name: 'tokenAddr'
        },
        {
          type: 'bytes32',
          name: 'versionHash'
        },
        {
          type: 'bytes',
          name: 'initParams'
        },
        {
          type: 'bytes',
          name: 'transferData'
        }
        ]
      }, [ownerAddress, logicAddress, token.address, versionHash, initParams, transferFunc])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      await expectRevert.unspecified(web3.eth.sendTransaction(newTrx), 'Already initialized')

      newTrx.data = isInitializedFunc

      result = await web3.eth.call(newTrx)
      resultStr = result as string

      // The smart wallet should be still initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))
    })
  })
}

)

contract('SimpleProxyFactory', ([from]) => {
  let fwd: SimpleSmartWalletInstance
  let token: TestTokenInstance
  let factory: SimpleProxyFactoryInstance
  let chainId: number
  const ownerPrivateKey = toBuffer(bytes32(1))
  let ownerAddress: string
  const versionHash = keccak256('2')
  const recipientPrivateKey = toBuffer(bytes32(1))
  let recipientAddress: string
  const typeHash = keccak256(`${GsnRequestType.typeName}(${ENVELOPING_PARAMS},${GsnRequestType.typeSuffix}`)
  const SimpleSmartWallet = artifacts.require('SimpleSmartWallet')
  const SimpleProxyFactory = artifacts.require('SimpleProxyFactory')
  let env: Environment

  const request: DeployRequest = {
    request: {
      from: constants.ZERO_ADDRESS,
      to: constants.ZERO_ADDRESS,
      value: '0',
      gas: '400000',
      nonce: '0',
      data: '0x',
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '1',
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
    chainId = (await getTestingEnvironment()).chainId
    ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)), chainId).toLowerCase()
    recipientAddress = toChecksumAddress(bufferToHex(privateToAddress(recipientPrivateKey)), chainId).toLowerCase()
    request.request.from = ownerAddress
    env = await getTestingEnvironment()
    fwd = await SimpleSmartWallet.new()
  })

  beforeEach(async () => {
    // A new factory for new create2 addresses each
    factory = await SimpleProxyFactory.new(fwd.address, versionHash)
    request.relayData.callForwarder = factory.address
    request.relayData.domainSeparator = getDomainSeparatorHash(factory.address, chainId)
  })

  describe('#getCreationBytecode', () => {
    it('should return the expected bytecode', async () => {
      const expectedCode = '0x602D3D8160093D39F3363D3D373D3D3D3D363D73' +
            stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'

      const code = await factory.getCreationBytecode()
      chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))
    })
  })

  describe('#getRuntimeCodeHash', () => {
    it('should return the expected code hash', async () => {
      const expectedCode = '0x363D3D373D3D3D3D363D73' + stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3'
      const expectedCodeHash = keccak256(expectedCode)

      const code = await factory.runtimeCodeHash()
      chai.expect(web3.utils.toBN(expectedCodeHash)).to.be.bignumber.equal(web3.utils.toBN(code))
    })
  })

  describe('#getSmartWalletAddress', () => {
    it('should create the correct create2 Address', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'
      const create2Address = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)
      const creationByteCode = await factory.getCreationBytecode()

      const salt: string = web3.utils.soliditySha3(
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'uint256', v: index }
      ) ?? ''

      const bytecodeHash: string = web3.utils.soliditySha3(
        { t: 'bytes', v: creationByteCode }
      ) ?? ''

      const _data: string = web3.utils.soliditySha3(
        { t: 'bytes1', v: '0xff' },
        { t: 'address', v: factory.address },
        { t: 'bytes32', v: salt },
        { t: 'bytes32', v: bytecodeHash }
      ) ?? ''

      const expectedAddress = toChecksumAddress('0x' + _data.slice(26, _data.length), env.chainId)
      assert.equal(create2Address, expectedAddress)
    })
  })

  describe('#createUserSmartWallet', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

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

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      const salt = web3.utils.soliditySha3(
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'uint256', v: index }
      ) ?? ''

      const expectedSalt = web3.utils.toBN(salt).toString()

      expectEvent.inLogs(logs, 'Deployed', {
        addr: expectedAddress,
        salt: expectedSalt
      })
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

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

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const { logs } = await factory.createUserSmartWallet(ownerAddress, recoverer, index, signatureCollapsed)

      const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

      chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))
    })

    it('should revert for an invalid signature', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const toSign: string = web3.utils.soliditySha3(
        { t: 'bytes2', v: '0x1910' },
        { t: 'address', v: ownerAddress },
        { t: 'address', v: recoverer },
        { t: 'uint256', v: index }
      ) ?? ''

      const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
      const signingKey = new ethers.utils.SigningKey(ownerPrivateKey)
      const signature = signingKey.signDigest(toSignAsBinaryArray)
      let signatureCollapsed: string = ethers.utils.joinSignature(signature)

      signatureCollapsed = signatureCollapsed.substr(0, signatureCollapsed.length - 1).concat('0')

      await expectRevert.unspecified(factory.createUserSmartWallet(ownerAddress, recoverer,
        index, signatureCollapsed))
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

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

      const isInitializedFunc = web3.eth.abi.encodeFunctionCall({
        name: 'isInitialized',
        type: 'function',
        inputs: []
      }, [])

      const trx = await web3.eth.getTransaction(logs[0].transactionHash)

      const newTrx = {
        from: trx.from,
        gas: trx.gas,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await web3.eth.call(newTrx)

      let resultStr = result as string

      // It should be initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))

      const initFunc = await web3.eth.abi.encodeFunctionCall({
        name: 'initialize',
        type: 'function',
        inputs: [{
          type: 'address',
          name: 'owner'
        },
        {
          type: 'address',
          name: 'tokenAddr'
        },
        {
          type: 'bytes32',
          name: 'versionHash'
        },
        {
          type: 'bytes',
          name: 'transferData'
        }
        ]
      }, [ownerAddress, constants.ZERO_ADDRESS, versionHash, '0x00'])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      await expectRevert.unspecified(web3.eth.sendTransaction(newTrx), 'Already initialized')

      newTrx.data = isInitializedFunc

      result = await web3.eth.call(newTrx)
      resultStr = result as string

      // The smart wallet should be still initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))
    })
  })

  describe('#relayedUserSmartWalletCreation', () => {
    it('should create the Smart Wallet in the expected address', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      token = await TestToken.new()
      await token.mint('200', expectedAddress)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })

      // relayData information
      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))

      const { logs } = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig)

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

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(web3.utils.toBN(deployPrice))
      chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)
    })

    it('should create the Smart Wallet with the expected proxy code', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      token = await TestToken.new()
      await token.mint('200', expectedAddress)

      const req = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })

      // expectedCode = runtime code only
      let expectedCode = await factory.getCreationBytecode()
      expectedCode = '0x' + expectedCode.slice(20, expectedCode.length)

      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))
      const { logs } = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig)

      const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

      chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))
    })

    it('should revert for an invalid signature', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })

      req.request.tokenAmount = '8' // change data after signature

      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))

      await expectRevert.unspecified(factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig))

      const newBalance = await token.balanceOf(expectedAddress)
      chai.expect(originalBalance).to.be.bignumber.equal(newBalance)
    })

    it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () => {
      const deployPrice = '0x01' // 1 token
      const recoverer = constants.ZERO_ADDRESS
      const index = '0'

      const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, recoverer, index)

      token = await TestToken.new()
      await token.mint('200', expectedAddress)

      const originalBalance = await token.balanceOf(expectedAddress)

      const req = {
        request: {
          ...request.request,
          tokenContract: token.address,
          tokenAmount: deployPrice
        },
        relayData: {
          ...request.relayData
        }
      }

      const dataToSign = new TypedRequestData(
        env.chainId,
        factory.address,
        req
      )

      const sig = signTypedData_v4(ownerPrivateKey, { data: dataToSign })
      const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))

      const { logs } = await factory.relayedUserSmartWalletCreation(req.request, getDomainSeparatorHash(factory.address, env.chainId), typeHash, suffixData, sig)

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

      // The Smart Wallet should have been charged for the deploy
      const newBalance = await token.balanceOf(expectedAddress)
      const expectedBalance = originalBalance.sub(web3.utils.toBN(deployPrice))
      chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)

      const isInitializedFunc = web3.eth.abi.encodeFunctionCall({
        name: 'isInitialized',
        type: 'function',
        inputs: []
      }, [])

      const trx = await web3.eth.getTransaction(logs[0].transactionHash)

      const newTrx = {
        from: trx.from,
        gas: trx.gas,
        to: expectedAddress,
        gasPrice: trx.gasPrice,
        value: trx.value,
        data: isInitializedFunc
      }

      // Call the isInitialized function
      let result = await web3.eth.call(newTrx)

      let resultStr = result as string

      // It should be initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))

      const transferFunc = await web3.eth.abi.encodeFunctionCall({
        name: 'transfer',
        type: 'function',
        inputs: [{
          type: 'address',
          name: '_to'
        },
        {
          type: 'uint256',
          name: '_value'
        }
        ]
      }, [
        recipientAddress, deployPrice
      ])

      const initFunc = await web3.eth.abi.encodeFunctionCall({
        name: 'initialize',
        type: 'function',
        inputs: [{
          type: 'address',
          name: 'owner'
        },
        {
          type: 'address',
          name: 'tokenAddr'
        },
        {
          type: 'bytes32',
          name: 'versionHash'
        },
        {
          type: 'bytes',
          name: 'transferData'
        }
        ]
      }, [ownerAddress, token.address, versionHash, transferFunc])

      newTrx.data = initFunc

      // Trying to manually call the initialize function again (it was called during deploy)
      await expectRevert.unspecified(web3.eth.sendTransaction(newTrx), 'Already initialized')

      newTrx.data = isInitializedFunc

      result = await web3.eth.call(newTrx)
      resultStr = result as string

      // The smart wallet should be still initialized
      chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))
    })
  })
}

)

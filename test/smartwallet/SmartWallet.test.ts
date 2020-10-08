import {
  SmartWalletInstance,
  TestSmartWalletInstance,
  TestForwarderTargetInstance,
  ProxyFactoryInstance
} from '../../types/truffle-contracts'

// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { ether, expectRevert } from '@openzeppelin/test-helpers'
import { toChecksumAddress } from 'web3-utils'
import { isRsk, Environment } from '../../src/common/Environments'
import { getTestingEnvironment, createProxyFactory, createSmartWallet } from '../TestUtils'
import { EIP712DomainType, EnvelopingRequestType, ENVELOPING_PARAMS, GsnRequestType } from '../../src/common/EIP712/EnvelopingTypedRequestData'

require('source-map-support').install({ errorFormatterForce: true })

const TestForwarderTarget = artifacts.require('TestForwarderTarget')

const SmartWallet = artifacts.require('SmartWallet')
const TestSmartWallet = artifacts.require('TestSmartWallet')

const keccak256 = web3.utils.keccak256

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

contract('SmartWallet', ([from]) => {
  // our generic params has 6 bytes32 values
  const countParams = EnvelopingRequestType.length

  let template: SmartWalletInstance

  let chainId: number

  let factory: ProxyFactoryInstance

  let sw: SmartWalletInstance

  const senderPrivKeyStr = bytes32(1)
  const senderPrivateKey = toBuffer(senderPrivKeyStr)
  const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

  before(async () => {
    template = await SmartWallet.new()
    factory = await createProxyFactory(template)

    chainId = (await getTestingEnvironment()).chainId

    sw = await createSmartWallet(senderAddress, factory, chainId, senderPrivKeyStr)
    console.log(`CHAINID: ${chainId}`)

    await sw.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )
  })

  describe('#registerRequestType', () => {
    it('should fail to register with invalid name', async () => {
      // this is an example of a typename that attempt to add a new field at the beginning.
      await expectRevert.unspecified(sw.registerRequestType('asd(uint a,Request asd)Request(', ')'), 'invalid typename')
    })

    it('should have a registered default type with no extra params', async () => {
      const logs = await template.contract.getPastEvents('RequestTypeRegistered', { fromBlock: 1 })
      assert.equal(logs[0].returnValues.typeStr, `ForwardRequest(${ENVELOPING_PARAMS})`)
    })

    it('should accept extension field', async () => {
      const ret = await sw.registerRequestType('test2', 'bool extra)')
      const { typeStr, typeHash } = ret.logs[0].args
      assert.equal(typeStr, `test2(${ENVELOPING_PARAMS},bool extra)`)
      assert.equal(typeHash, keccak256(typeStr))
    })

    it('should allow silently repeated registration', async () => {
      await sw.registerRequestType('test3', '')
      await sw.registerRequestType('test3', '')
    })
  })

  describe('#registerDomainSeparator', () => {
    it('registered domain should match local definition', async () => {
      const data = {
        domain: {
          name: 'domainName',
          version: 'domainVer',
          chainId,
          verifyingContract: sw.address
        },
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType
        }
      }

      const localDomainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
      const typehash = TypedDataUtils.hashType('EIP712Domain', data.types)
      const ret = await sw.registerDomainSeparator('domainName', 'domainVer')

      const { domainSeparator, domainValue } = ret.logs[0].args
      assert.equal(domainValue, web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [typehash, keccak256('domainName'), keccak256('domainVer'), data.domain.chainId, sw.address]))
      assert.equal(domainSeparator, localDomainSeparator)

      assert.equal(await sw.domains(localDomainSeparator), true)
    })
  })

  describe('registered typehash', () => {
    const fullType = `test4(${ENVELOPING_PARAMS},bool extra)`
    const hash = keccak256(fullType)
    it('should return false before registration', async () => {
      assert.equal(await sw.typeHashes(hash), false)
    })
    it('should return true after registration', async () => {
      const res = await sw.registerRequestType('test4', 'bool extra)')
      assert.equal(res.logs[0].args.typeStr, fullType)
      assert.equal(res.logs[0].args.typeHash, hash)
      assert.equal(true, await sw.typeHashes(hash))
    })
  })

  describe('#verify', () => {
    const typeName = `ForwardRequest(${ENVELOPING_PARAMS})`
    const typeHash = keccak256(typeName)
    let domainInfo: any

    let domainSeparator: string

    before('register domain separator', async () => {
      domainInfo = {
        name: 'domainName',
        version: 'domainVer',
        chainId,
        verifyingContract: sw.address
      }

      const data = {
        domain: domainInfo,
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType
        }
      }

      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
      await sw.registerDomainSeparator('domainName', 'domainVer')
    })

    describe('#verify failures', () => {
      const req = {
        to: addr(1),
        data: '0x',
        from: senderAddress,
        value: '0',
        nonce: 0,
        gas: 123,
        tokenRecipient: addr(2),
        tokenContract: addr(3),
        tokenAmount: 1,
        factory: addr(4)
      }

      it('should fail on unregistered domain separator', async () => {
        const dummyDomainSeparator = bytes32(1)

        await expectRevert(sw.verify(req, dummyDomainSeparator, typeHash, '0x', '0x'.padEnd(65 * 2 + 2, '1b')), 'unregistered domain separator')
      })

      it('should fail on wrong nonce', async () => {
        const env: Environment = await getTestingEnvironment()
        const message: string = isRsk(env) ? 'Returned error: VM execution error: nonce mismatch' : 'revert nonce mismatch'

        await expectRevert(sw.verify({
          ...req,
          nonce: 123
        }, domainSeparator, typeHash, '0x', '0x'), message)
      })
      it('should fail on invalid signature', async () => {
        await expectRevert(sw.verify(req, domainSeparator, typeHash, '0x', '0x'), 'invalid signature length')
        await expectRevert(sw.verify(req, domainSeparator, typeHash, '0x', '0x123456'), 'invalid signature length')
        await expectRevert(sw.verify(req, domainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65)), 'signature mismatch')
      })
    })
    describe('#verify success', () => {
      const req = {
        to: addr(1),
        data: '0x',
        value: '0',
        from: senderAddress,
        nonce: 0,
        gas: 123,
        tokenRecipient: addr(2),
        tokenContract: addr(3),
        tokenAmount: 1,
        factory: addr(4)
      }

      let data: EIP712TypedData

      before(() => {
        data = {
          domain: domainInfo,
          primaryType: 'ForwardRequest',
          types: {
            EIP712Domain: EIP712DomainType,
            ForwardRequest: EnvelopingRequestType
          },
          message: req
        }
        // sanity: verify that we calculated the type locally just like eth-utils:
        const calcType = TypedDataUtils.encodeType('ForwardRequest', data.types)
        assert.equal(calcType, typeName)
        const calcTypeHash = bufferToHex(TypedDataUtils.hashType('ForwardRequest', data.types))
        assert.equal(calcTypeHash, typeHash)
      })

      it('should verify valid signature', async () => {
        const sig = signTypedData_v4(senderPrivateKey, { data })
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

        await sw.verify(req, bufferToHex(domainSeparator), typeHash, '0x', sig)
      })

      it('should verify valid signature of extended type', async () => {
        const ExtendedMessageType = [
          ...EnvelopingRequestType,
          { name: 'extra', type: 'ExtraData' } // <--extension param. uses a typed structure - though could be plain field
        ]
        const ExtraDataType = [
          { name: 'extraAddr', type: 'address' }
        ]

        const extendedReq = {
          to: addr(1),
          data: '0x',
          value: '0',
          from: senderAddress,
          nonce: 0,
          gas: 123,
          tokenRecipient: addr(2),
          tokenContract: addr(3),
          tokenAmount: 1,
          factory: addr(4),
          extra: {
            extraAddr: addr(5)
          }
        }

        // we create extended data message
        const extendedData = {
          domain: data.domain,
          primaryType: 'ExtendedMessage',
          types: {
            EIP712Domain: EIP712DomainType,
            ExtendedMessage: ExtendedMessageType,
            ExtraData: ExtraDataType
          },
          message: extendedReq
        }

        const typeName = 'ExtendedMessage'
        const typeSuffix = 'ExtraData extra)ExtraData(address extraAddr)'

        const { logs } = await sw.registerRequestType(typeName, typeSuffix)
        const { typeHash } = logs[0].args
        const sig = signTypedData(senderPrivateKey, { data: extendedData })

        // same calculation of domainSeparator as with base (no-extension)
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', extendedData.domain, extendedData.types)

        // encode entire struct, to extract "suffixData" from it
        const encoded = TypedDataUtils.encodeData(extendedData.primaryType, extendedData.message, extendedData.types)
        // skip default params: typehash, and 5 params, so 32*6
        const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

        await sw.verify(extendedReq, bufferToHex(domainSeparator), typeHash, suffixData, sig)
      })
    })
  })

  describe('#verifyAndCall', () => {
    let data: EIP712TypedData
    let typeName: string
    let typeHash: string
    let recipient: TestForwarderTargetInstance
    let testfwd: TestSmartWalletInstance
    let domainSeparator: string

    before(async () => {
      typeName = `ForwardRequest(${ENVELOPING_PARAMS})`
      typeHash = web3.utils.keccak256(typeName)
      await sw.registerRequestType('TestCall', '')

      data = {
        domain: {
          name: 'Test Domain',
          version: '1',
          chainId,
          verifyingContract: sw.address
        },
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType,
          ForwardRequest: EnvelopingRequestType
        },
        message: {}
      }
      // sanity: verify that we calculated the type locally just like eth-utils:
      const calcType = TypedDataUtils.encodeType('ForwardRequest', data.types)
      assert.equal(calcType, typeName)
      const calcTypeHash = bufferToHex(TypedDataUtils.hashType('ForwardRequest', data.types))
      assert.equal(calcTypeHash, typeHash)

      recipient = await TestForwarderTarget.new(sw.address)
      testfwd = await TestSmartWallet.new()

      const ret = await sw.registerDomainSeparator(data.domain.name!, data.domain.version!)

      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))

      // validate registration matches local definition
      assert.equal(domainSeparator, ret.logs[0].args.domainSeparator)
    })

    it('should call function', async () => {
      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      // const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: 0,
        gas: 1e6,
        tokenRecipient: addr(2),
        tokenContract: addr(3),
        tokenAmount: 1,
        factory: addr(4)
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })
      const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

      // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
      // declared in solidity
      await sw.execute(req1, bufferToHex(domainSeparator), typeHash, '0x', sig)
      // @ts-ignore
      const logs = await recipient.getPastEvents('TestForwarderMessage')
      assert.equal(logs.length, 1, 'TestRecipient should emit')
      assert.equal(logs[0].args.realSender, senderAddress, 'TestRecipient should "see" real sender of meta-tx')
      assert.equal('1', (await sw.getNonce()).toString(), 'verifyAndCall should increment nonce')
    })

    it('should return revert message of target revert', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: (await sw.getNonce()).toString(),
        gas: 1e6,
        tokenRecipient: addr(2),
        tokenContract: addr(3),
        tokenAmount: 1,
        factory: addr(4)
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig)
      assert.equal(ret.logs[0].args.error, 'always fail')
    })

    it('should not be able to re-submit after revert (its repeated nonce)', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: 0,
        from: senderAddress,
        nonce: (await sw.getNonce()).toString(),
        gas: 1e6,
        tokenRecipient: addr(2),
        tokenContract: addr(3),
        tokenAmount: 1,
        factory: addr(4)
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig)
      assert.equal(ret.logs[0].args.error, 'always fail')
      assert.equal(ret.logs[0].args.success, false)

      await expectRevert.unspecified(testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig), 'nonce mismatch')
    })

    describe('value transfer', () => {
      let recipient: TestForwarderTargetInstance

      beforeEach(async () => {
        recipient = await TestForwarderTarget.new(sw.address)
      })
      afterEach('should not leave funds in the forwarder', async () => {
        assert.equal(await web3.eth.getBalance(sw.address), '0')
      })

      it('should fail to forward request if value specified but not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await sw.getNonce()).toString(),
          value: value.toString(),
          gas: 1e6,
          tokenRecipient: addr(2),
          tokenContract: addr(3),
          tokenAmount: 1,
          factory: addr(4)
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.success, false)
      })

      it('should fail to forward request if value specified but not enough not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await sw.getNonce()).toString(),
          value: ether('2').toString(),
          gas: 1e6,
          tokenRecipient: addr(2),
          tokenContract: addr(3),
          tokenAmount: 1,
          factory: addr(4)
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig, { value })
        assert.equal(ret.logs[0].args.success, false)
      })

      it('should forward request with value', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        // value = ether('0');
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await sw.getNonce()).toString(),
          value: value.toString(),
          gas: 1e6,
          tokenRecipient: addr(2),
          tokenContract: addr(3),
          tokenAmount: 1,
          factory: addr(4)
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig, { value })
        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)

        assert.equal(await web3.eth.getBalance(recipient.address), value.toString())
      })

      it('should forward all funds left in forwarder to "from" address', async () => {
        const senderPrivateKey = toBuffer(bytes32(2))
        const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        // value = ether('0');
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await sw.getNonce()).toString(),
          value: value.toString(),
          gas: 1e6,
          tokenRecipient: addr(2),
          tokenContract: addr(3),
          tokenAmount: 1,
          factory: addr(4)
        }

        const extraFunds = ether('4')

        await web3.eth.sendTransaction({ from, to: sw.address, value: extraFunds })

        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        // note: not transfering value in TX.
        const ret = await testfwd.callExecute(sw.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)

        assert.equal(await web3.eth.getBalance(senderAddress), extraFunds.sub(value).toString())
      })
    })
  })
})

import {
    MultiForwarderInstance
  } from '../types/truffle-contracts'
  // @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { toChecksumAddress } from 'web3-utils'
import { expectRevert } from '@openzeppelin/test-helpers'
import { getTestingEnvironment } from './TestUtils'

const MultiForwarder = artifacts.require('MultiForwarder')


function bytes32 (n: number): string {
    return '0x' + n.toString().repeat(64).slice(0, 64)
}

function addr (n: number): string {
    return '0x' + n.toString().repeat(40)
}

const keccak256 = web3.utils.keccak256

// Global EIP712 type definitions.
const EIP712DomainType = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' }
]
  
const ForwardRequestType = [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' }
]

contract('MultiForwarder', ([from]) => {
    const GENERIC_PARAMS = 'address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data'
    // our generic params has 6 bytes32 values
    const countParams = ForwardRequestType.length
  
    let mfwd: MultiForwarderInstance
    const senderPrivateKey = toBuffer(bytes32(1))
    const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))
  
    before(async () => {
      mfwd = await MultiForwarder.new()
      assert.equal(await mfwd.GENERIC_PARAMS(), GENERIC_PARAMS)
    })

    describe('#registerRequestType', () => {
        it('should fail to register with invalid name', async () => {
          // this is an example of a typename that attempt to add a new field at the beginning.
          await expectRevert(mfwd.registerRequestType('asd(uint a,Request asd)Request(', ')'), 'error')
        })
    
        it('should have a registered default type with no extra params', async () => {
          const logs = await mfwd.contract.getPastEvents('RequestTypeRegistered', { fromBlock: 1 })
          assert.equal(logs[0].returnValues.typeStr, `ForwardRequest(${GENERIC_PARAMS})`)
        })
    
        it('should accept extension field', async () => {
          const ret = await mfwd.registerRequestType('test2', 'bool extra)')
          const { typeStr, typeHash } = ret.logs[0].args
          assert.equal(typeStr, `test2(${GENERIC_PARAMS},bool extra)`)
          assert.equal(typeHash, keccak256(typeStr))
        })
    
        it('should allow silently repeated registration', async () => {
          await mfwd.registerRequestType('test3', '')
          await mfwd.registerRequestType('test3', '')
        })
      })

    describe('registered typehash', () => {
    const fullType = `test4(${GENERIC_PARAMS},bool extra)`
    const hash = keccak256(fullType)
    it('should return false before registration', async () => {
        assert.equal(await mfwd.typeHashes(hash), false)
    })
    it('should return true after registration', async () => {
        const res = await mfwd.registerRequestType('test4', 'bool extra)')
        assert.equal(res.logs[0].args.typeStr, fullType)
        assert.equal(res.logs[0].args.typeHash, hash)
        assert.equal(true, await mfwd.typeHashes(hash))
    })
    })

    describe('#verify', () => {
        const typeName = `ForwardRequest(${GENERIC_PARAMS})`
        const typeHash = keccak256(typeName)
        
        describe('#verify failures', () => {
            const dummyDomainSeparator = bytes32(1)
      
            const req = {
              to: addr(1),
              data: '0x',
              from: senderAddress,
              value: '0',
              nonce: 0,
              gas: 123
            }
      
            it('should fail on wrong nonce', async () => {
              await expectRevert(mfwd.verify({
                ...req,
                nonce: 123
              }, dummyDomainSeparator, typeHash, '0x', '0x'), 'nonce mismatch')
            })
            it('should fail on invalid signature', async () => {
                await expectRevert(mfwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x'), 'invalid signature length')
                await expectRevert(mfwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x123456'), 'invalid signature length')
                await expectRevert(mfwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65)), 'signature mismatch')
              })
        })
        describe('#verify success', () => {
            const req = {
              to: addr(1),
              data: '0x',
              value: '0',
              from: senderAddress,
              nonce: 0,
              gas: 123
            }
      
            let data: EIP712TypedData

            before(async () => {
                const env = await getTestingEnvironment()
                data = {
                  domain: {
                    name: 'Test Domain',
                    version: '1',
                    chainId: env.chainId,
                    verifyingContract: mfwd.address
                  },
                  primaryType: 'ForwardRequest',
                  types: {
                    EIP712Domain: EIP712DomainType,
                    ForwardRequest: ForwardRequestType
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
        
                await mfwd.verify(req, bufferToHex(domainSeparator), typeHash, '0x', sig)
            })
            it('should verify valid signature of extended type', async () => {
                const ExtendedMessageType = [
                  ...ForwardRequestType,
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
                  extra: {
                    extraAddr: addr(5)
                  }
                }
        
                // we create extended data message
                const typeName = 'ExtendedMessage'
                const typeSuffix = 'ExtraData extra)ExtraData(address extraAddr)'

                const extendedData = {
                  domain: data.domain,
                  primaryType: typeName,
                  types: {
                    EIP712Domain: EIP712DomainType,
                    ExtendedMessage: ExtendedMessageType,
                    ExtraData: ExtraDataType
                  },
                  message: extendedReq
                }
        
                const { logs } = await mfwd.registerRequestType(typeName, typeSuffix)
                const { typeHash } = logs[0].args
                const sig = signTypedData(senderPrivateKey, { data: extendedData })
        
                // same calculation of domainSeparator as with base (no-extension)
                const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', extendedData.domain, extendedData.types)
        
                // encode entire struct, to extract "suffixData" from it
                const encoded = TypedDataUtils.encodeData(extendedData.primaryType, extendedData.message, extendedData.types)
                // skip default params: typehash, and 5 params, so 32*6
                const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))
        
                await mfwd.verify(extendedReq, bufferToHex(domainSeparator), typeHash, suffixData, sig)
            })
        })
    })
})
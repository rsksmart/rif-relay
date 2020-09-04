import {
    MultiForwarderInstance,
    TestMultiForwarderTargetInstance,
    TestMultiForwarderInstance
  } from '../types/truffle-contracts'
  // @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData, EIP712Types } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer, BN } from 'ethereumjs-util'
import { toChecksumAddress } from 'web3-utils'
import { expectRevert, ether } from '@openzeppelin/test-helpers'
import { getTestingEnvironment } from './TestUtils'

const MultiForwarder = artifacts.require('MultiForwarder')
const TestMultiForwarderTarget = artifacts.require('TestMultiForwarderTarget')
const TestMultiForwarder = artifacts.require('TestMultiForwarder')


function bytes32 (n: number): string {
    return '0x' + n.toString().repeat(64).slice(0, 64)
}

function addr (n: number): string {
    return '0x' + n.toString().repeat(40)
}

// sanity: verify that we calculated the type locally just like eth-utils:
function sanitizedParameters (typeName: string, typeHash: string, dataTypes: EIP712Types) {
    const calcType = TypedDataUtils.encodeType('ForwardRequest', dataTypes)
    assert.equal(calcType, typeName)
    const calcTypeHash = bufferToHex(TypedDataUtils.hashType('ForwardRequest', dataTypes))
    assert.equal(calcTypeHash, typeHash)
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
					sanitizedParameters(typeName, typeHash, data.types);
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

			describe('#verifyAndCallOneReq', () => {
				let data: EIP712TypedData
				let typeName: string
				let typeHash: string
				let recipient: TestMultiForwarderTargetInstance
				let testmfwd: TestMultiForwarderInstance
				let domainSeparator: string

				before(async () => {
					const env = await getTestingEnvironment()
					typeName = `ForwardRequest(${GENERIC_PARAMS})`
					typeHash = web3.utils.keccak256(typeName)
					await mfwd.registerRequestType('TestCall', '')
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
						message: {}
					}
					sanitizedParameters(typeName, typeHash, data.types);
					recipient = await TestMultiForwarderTarget.new(mfwd.address)
					testmfwd = await TestMultiForwarder.new()
			
					domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
				})

				it('should call function', async () => {
					const func = recipient.contract.methods.emitMessage('hello').encodeABI()
			
					const fwReq = {
						to: recipient.address,
						data: func,
						value: '0',
						from: senderAddress,
						nonce: 0,
						gas: 1e6
					}

					const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
					const reqDetail = {
						req: fwReq,
						domainSeparator: domainSeparator,
						requestTypeHash: typeHash,
						suffixData: '0x',
						signature: sig,
					}
					// note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
					// declared in solidity
					await mfwd.execute([reqDetail])
					// @ts-ignore
					const logs = await recipient.getPastEvents('TestMultiForwarderMessage')
					assert.equal(logs.length, 1, 'TestRecipient should emit')
					assert.equal(logs[0].args.realSender, senderAddress, 'TestRecipient should "see" real sender of meta-tx')
					assert.equal('1', (await mfwd.getNonce(senderAddress)).toString(), 'verifyAndCall should increment nonce')
				})
				it('should return revert message of target revert', async () => {
					const func = recipient.contract.methods.testRevert().encodeABI()
			
					const fwReq = {
					to: recipient.address,
					data: func,
					value: '0',
					from: senderAddress,
					nonce: (await mfwd.getNonce(senderAddress)).toString(),
					gas: 1e6
					}
					const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
			
					const reqDetail = {
						req: fwReq,
						domainSeparator: domainSeparator,
						requestTypeHash: typeHash,
						suffixData: '0x',
						signature: sig,
					}
					// the helper simply emits the method return values
					const ret = await testmfwd.callExecute(mfwd.address, [reqDetail])
					assert.equal(ret.logs[0].args.lastSuccTx, 0) //On the spec, if the first tx fails, it retutrns in the lastSuccTx parameter a 0
					assert.equal(ret.logs[0].args.lastRetTx, 'always fail')
				})
				it('should not be able to re-submit after revert (its repeated nonce)', async () => {
					const func = recipient.contract.methods.testRevert().encodeABI()
			
					const fwReq = {
					to: recipient.address,
					data: func,
					value: 0,
					from: senderAddress,
					nonce: (await mfwd.getNonce(senderAddress)).toString(),
					gas: 1e6
					}
					const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
					const reqDetail = {
						req: fwReq,
						domainSeparator: domainSeparator,
						requestTypeHash: typeHash,
						suffixData: '0x',
						signature: sig,
					}
					// the helper simply emits the method return values

					const ret = await testmfwd.callExecute(mfwd.address, [reqDetail])
					assert.equal(ret.logs[0].args.lastSuccTx, 0)
					assert.equal(ret.logs[0].args.lastRetTx, 'always fail') //TODO: solved how to know the last tx failed
					await expectRevert(testmfwd.callExecute(mfwd.address, [reqDetail]), 'error')
				})
				
				describe('value transfer', () => {
					let recipient: TestMultiForwarderTargetInstance

					beforeEach(async () => {
						recipient = await TestMultiForwarderTarget.new(mfwd.address)
					})
					afterEach('should not leave funds in the forwarder', async () => {
						assert.equal(await web3.eth.getBalance(mfwd.address), '0')
					})

					it('should fail to forward request if value specified but not provided', async () => {
						const value = ether('1')
						const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
			 
						const fwReq = {
						  to: recipient.address,
						  data: func,
						  from: senderAddress,
						  nonce: (await mfwd.getNonce(senderAddress)).toString(),
						  value: value.toString(),
						  gas: 1e6
						}
						const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
						const reqDetail = {
							req: fwReq,
							domainSeparator: domainSeparator,
							requestTypeHash: typeHash,
							suffixData: '0x',
							signature: sig,
						}
						const ret = await testmfwd.callExecute(mfwd.address, [reqDetail])
						assert.equal(ret.logs[0].args.lastSuccTx, 0)
					  })
					  it('should fail to forward request if value specified but not enough not provided', async () => {
						const value = ether('1')
						const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
			 
						const fwReq = {
						  to: recipient.address,
						  data: func,
						  from: senderAddress,
						  nonce: (await mfwd.getNonce(senderAddress)).toString(),
						  value: ether('2').toString(),
						  gas: 1e6
						}
						const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
						const reqDetail = {
							req: fwReq,
							domainSeparator: domainSeparator,
							requestTypeHash: typeHash,
							suffixData: '0x',
							signature: sig,
						}
						const ret = await testmfwd.callExecute(mfwd.address, [reqDetail], { value })
						assert.equal(ret.logs[0].args.lastSuccTx, 0)
					})
					it('should forward request with value', async () => {
						const value = ether('1')
						const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
			 
						// value = ether('0');
						const fwReq = {
						  to: recipient.address,
						  data: func,
						  from: senderAddress,
						  nonce: (await mfwd.getNonce(senderAddress)).toString(),
						  value: value.toString(),
						  gas: 1e6
						}
						const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
						const reqDetail = {
							req: fwReq,
							domainSeparator: domainSeparator,
							requestTypeHash: typeHash,
							suffixData: '0x',
							signature: sig,
						}
						const ret = await testmfwd.callExecute(mfwd.address, [reqDetail], { value })
						assert.equal(ret.logs[0].args.lastSuccTx, 1) //TODO: If it's the result of a transfer value, it must verify retValue and also the usedGas?
						assert.equal(ret.logs[0].args.lastRetTx, '')
						assert.equal(await web3.eth.getBalance(recipient.address), value.toString())
					})

					it('should forward all funds left in forwarder to "from" address', async () => {
						const senderPrivateKey = toBuffer(bytes32(2))
						const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))
			 
						const value = ether('1')
						const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
			 
						// value = ether('0');
						const fwReq = {
						  to: recipient.address,
						  data: func,
						  from: senderAddress,
						  nonce: (await mfwd.getNonce(senderAddress)).toString(),
						  value: value.toString(),
						  gas: 1e6
						}
			 
						const extraFunds = ether('4')
						await web3.eth.sendTransaction({ from, to: mfwd.address, value: extraFunds })
			 
						const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq } })
						const reqDetail = {
							req: fwReq,
							domainSeparator: domainSeparator,
							requestTypeHash: typeHash,
							suffixData: '0x',
							signature: sig,
						}
						// note: not transfering value in TX.
						const ret = await testmfwd.callExecute(mfwd.address, [reqDetail])
						console.log(ret.logs)
						assert.equal(ret.logs[0].args.lastSuccTx, 1) //TODO: If it's the result of a transfer value, it must verify retValue and also the usedGas?
						assert.equal(ret.logs[0].args.lastRetTx, '')
			 
						// assert.equal(await web3.eth.getBalance(senderAddress), extraFunds.sub(value).toString())
					 })

					 it.only('should forward two requests with value', async () => {
						const value = ether('2')
						const reqValue = ether('1')
						const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

						const nonce = await mfwd.getNonce(senderAddress);
			 
						const fwReq1 = {
						  to: recipient.address,
						  data: func,
						  from: senderAddress,
						  nonce: nonce.toString(),
						  value: reqValue.toString(),
						  gas: 1e6
						}

						const fwReq2 = {
							to: recipient.address,
							data: func,
							from: senderAddress,
							nonce: (nonce.add(new BN(1))).toString(),
							value: reqValue.toString(),
							gas: 1e6
						  }

						console.log(fwReq1, fwReq2)

						const sig1 = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq1 } })

						console.log(sig1)
						const reqDetail1 = {
							req: fwReq1,
							domainSeparator: domainSeparator,
							requestTypeHash: typeHash,
							suffixData: '0x',
							signature: sig1,
						}

						const sig2 = signTypedData_v4(senderPrivateKey, { data: { ...data, message: fwReq2 } })
						const reqDetail2 = {
							req: fwReq2,
							domainSeparator: domainSeparator,
							requestTypeHash: typeHash,
							suffixData: '0x',
							signature: sig2
						}
						console.log(sig2)

						const ret = await testmfwd.callExecute(mfwd.address, [reqDetail1, reqDetail2], { value })
						//assert.equal(ret.logs[0].args.error, '')
						//assert.equal(ret.logs[0].args.success, true)
						console.log(ret.logs[0])

						assert.equal(await web3.eth.getBalance(recipient.address), value.toString())
					})
				})
			})
		})
	})
})
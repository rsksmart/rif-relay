import {
  ForwarderInstance,
  TestForwarderInstance,
  TestForwarderTargetInstance,
  TestTokenInstance,
  ProxyFactoryInstance
} from '../types/truffle-contracts'
// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer, BN } from 'ethereumjs-util'
import { ether, expectRevert } from '@openzeppelin/test-helpers'
import { toChecksumAddress } from 'web3-utils'
import ForwardRequest from '../src/common/EIP712/ForwardRequest'
import { ethers } from 'ethers'

const TestForwarderTarget = artifacts.require('TestForwarderTarget')

const Forwarder = artifacts.require('Forwarder')
const TestToken = artifacts.require('TestToken')
const TestForwarder = artifacts.require('TestForwarder')
const ProxyFactory = artifacts.require('ProxyFactory')


const keccak256 = web3.utils.keccak256

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

// Global EIP712 type definitions.
// (read from helper package?)
const EIP712DomainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const TokenPaymentType = [
  { name: 'tokenRecipient', type: 'address' },
  { name: 'tokenContract', type: 'address' },
  { name: 'paybackTokens', type: 'uint256' },
  { name: 'tokenGas', type: 'uint256' }
]

const ForwardRequestType = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'gas', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'data', type: 'bytes' },
  ...TokenPaymentType,
  { name: 'isDeploy', type: 'bool' },

]

contract('Forwarder', ([from]) => {
  const GENERIC_PARAMS = 'address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 paybackTokens,uint256 tokenGas,bool isDeploy'
  // our generic params has 6 bytes32 values
  const countParams = ForwardRequestType.length

  let fwdTemplate: ForwarderInstance //Template code used by the Smart Wallet
  let token: TestTokenInstance
  let factory : ProxyFactoryInstance //Creator of Smart Wallets
  let fwd: ForwarderInstance //RSK forwarder != GSN2 Forwarder. In RSK, this is the smart wallet, which has one owner
  let fwdTypeRegistrationBlock: number //Block at which the Smart Wallet was created (ergo, initialized)

  const senderPrivateKey = toBuffer(bytes32(1))
  const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))
  const logicAddress = addr(0)
  const initParams = "0x00"
  const logicInitGas = "0x00"

  before(async () => {
    token = await TestToken.new()
    fwdTemplate = await Forwarder.new()
    assert.equal(await fwdTemplate.GENERIC_PARAMS(), GENERIC_PARAMS)

    factory = await ProxyFactory.new(fwdTemplate.address)

    const toSign:string = "" + web3.utils.soliditySha3(
    {t:"bytes2",v:'0x1910'}, 
    {t:"address",v:senderAddress}, 
    {t:"address",v:logicAddress}, 
    {t:"uint256",v:logicInitGas},
    {t:"bytes",v:initParams}
    )
    const toSignAsBinaryArray = ethers.utils.arrayify(toSign);
    const signingKey = new ethers.utils.SigningKey(senderPrivateKey);
    const signature = signingKey.signDigest(toSignAsBinaryArray);
    const signatureCollapsed = ethers.utils.joinSignature(signature);
    await factory.createUserSmartWallet(senderAddress, logicAddress, logicInitGas, initParams, signatureCollapsed)
    const fwdAddress = await factory.getSmartWalletAddress(senderAddress, logicAddress, initParams)
    fwd = await Forwarder.at(fwdAddress);
    const txResult = await fwd.registerRequestType(`ForwardRequest`, '');
    fwdTypeRegistrationBlock = txResult.logs[0].blockNumber;
  })

  describe('#registerRequestType', () => {
    it('should fail to register with invalid name', async () => {
      // this is an example of a typename that attempt to add a new field at the beginning.
      await expectRevert.unspecified(fwd.registerRequestType('asd(uint a,Request asd)Request(', ''), 'invalid typename')
    })

    it('should have a registered default type with no extra params', async () => {
      let logs = await fwdTemplate.contract.getPastEvents('RequestTypeRegistered', { fromBlock: 1 })
      assert.equal(logs[0].returnValues.typeStr, `ForwardRequest(${GENERIC_PARAMS})`)

      logs = await fwd.contract.getPastEvents('RequestTypeRegistered', { fromBlock: fwdTypeRegistrationBlock })
      assert.equal(logs[0].returnValues.typeStr, `ForwardRequest(${GENERIC_PARAMS})`)
    })

    it('should accept extension field', async () => {
      const ret = await fwd.registerRequestType('test2', 'bool extra)')
      const { typeStr, typeHash } = ret.logs[0].args
      assert.equal(typeStr, `test2(${GENERIC_PARAMS},bool extra)`)
      assert.equal(typeHash, keccak256(typeStr))
    })

    it('should allow silently repeated registration', async () => {
      await fwd.registerRequestType('test3', '')
      await fwd.registerRequestType('test3', '')
    })
  })

  describe('registered typehash', () => {
    const fullType = `test4(${GENERIC_PARAMS},bool extra)`
    const hash = keccak256(fullType)
    it('should return false before registration', async () => {
      assert.equal(await fwd.typeHashes(hash), false)
    })
    it('should return true after registration', async () => {
      const res = await fwd.registerRequestType('test4', 'bool extra)')
      assert.equal(res.logs[0].args.typeStr, fullType)
      assert.equal(res.logs[0].args.typeHash, hash)
      assert.equal(true, await fwd.typeHashes(hash))
    })
  })

  describe('#verify', () => {
    const typeName = `ForwardRequest(${GENERIC_PARAMS})`
    const typeHash = keccak256(typeName)
    
    beforeEach(async () => {
      assert.equal(await fwd.GENERIC_PARAMS(), GENERIC_PARAMS)
    })
    describe('#verify failures', () => {
      const dummyDomainSeparator = bytes32(1)
      let tknPayment
      let req : any
      before(() => {
        tknPayment = {
          tokenRecipient: addr(2),
          tokenContract: token.address,
          paybackTokens: '0',
          tokenGas: 1e6
        }
  
        req = {
          to: addr(1),
          data: '0x',
          from: senderAddress,
          value: '0',
          nonce: 0,
          gas: 123,
          ...tknPayment,
          isDeploy: false
        }
      })

      it('should fail on wrong nonce', async () => {
        await expectRevert(fwd.verify({
          ...req,
          nonce: 123
        }, dummyDomainSeparator, typeHash, '0x', '0x'), 'VM execution error: nonce mismatch')
      })
      it('should fail on invalid signature', async () => {
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x'), 'Returned error: VM execution error: ECDSA: invalid signature length')
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x123456'), 'Returned error: VM execution error: ECDSA: invalid signature length')
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65)), 'VM execution error: signature mismatch')
      })
    })
    describe('#verify success', () => {

      let data: EIP712TypedData
      let tknPayment
      let req : any

      before(() => {
        tknPayment = {
          tokenRecipient: addr(1),
          tokenContract: token.address,
          paybackTokens: '0',
          tokenGas: 1e6
        }
  
        req = {
          to: addr(1),
          data: '0x',
          value: '0',
          from: senderAddress,
          nonce: 0,
          gas: 123,
          ...tknPayment,
          isDeploy: false
        }

        data = {
          domain: {
            name: 'Test Domain',
            version: '1',
            chainId: 1234,
            verifyingContract: fwd.address
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

        await fwd.verify(req, bufferToHex(domainSeparator), typeHash, '0x', sig)
      })

      it('should verify valid signature of extended type', async () => {
        const ExtendedMessageType = [
          ...ForwardRequestType,
          { name: 'extra', type: 'ExtraData' } // <--extension param. uses a typed structure - though could be plain field
        ]
        const ExtraDataType = [
          { name: 'extraAddr', type: 'address' }
        ]

        const tknPayment = {
          tokenRecipient: addr(2),
          tokenContract: token.address,
          paybackTokens: '0',
          tokenGas: 1e6
        }

        const extendedReq = {
          to: addr(1),
          data: '0x',
          value: '0',
          from: senderAddress,
          nonce: 0,
          gas: 123,
          ...tknPayment,
          isDeploy: false,
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

        const { logs } = await fwd.registerRequestType(typeName, typeSuffix)
        const { typeHash } = logs[0].args
        const sig = signTypedData(senderPrivateKey, { data: extendedData })

        // same calculation of domainSeparator as with base (no-extension)
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', extendedData.domain, extendedData.types)

        // encode entire struct, to extract "suffixData" from it
        const encoded = TypedDataUtils.encodeData(extendedData.primaryType, extendedData.message, extendedData.types)
        // skip default params: typehash, and 5 params, so 32*6
        const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

        await fwd.verify(extendedReq, bufferToHex(domainSeparator), typeHash, suffixData, sig)
      })
    })
  })

  describe('#verifyAndCall', () => {
    let data: EIP712TypedData
    let typeName: string
    let typeHash: string
    let recipient: TestForwarderTargetInstance
    let testfwd: TestForwarderInstance
    let domainSeparator: string
    let tokensPaid : number

    before(async () => {
      typeName = `ForwardRequest(${GENERIC_PARAMS})`
      typeHash = web3.utils.keccak256(typeName)
      await fwd.registerRequestType('TestCall', '')
      tokensPaid = 1
      data = {
        domain: {
          name: 'Test Domain',
          version: '1',
          chainId: 1234,
          verifyingContract: fwd.address
        },
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType,
          ForwardRequest: ForwardRequestType
        },
        message: {}
      }
      // sanity: verify that we calculated the type locally just like eth-utils:
      const calcType = TypedDataUtils.encodeType('ForwardRequest', data.types)
      assert.equal(calcType, typeName)
      const calcTypeHash = bufferToHex(TypedDataUtils.hashType('ForwardRequest', data.types))
      assert.equal(calcTypeHash, typeHash)
      testfwd = await TestForwarder.new()

      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
    })

    beforeEach(async () => {
      recipient = await TestForwarderTarget.new(fwd.address)
      await token.mint('1000', fwd.address)
    })

    it('should return revert message of token payment revert', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()
      const tknPayment = {
        tokenRecipient: recipient.address,
        tokenContract: token.address,
        paybackTokens: '1001', 
        tokenGas: 1e6
      }
      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: (await fwd.getNonce()).toString(),
        gas: 1e6,
        ...tknPayment,
        isDeploy: false
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)

      const tknBalance = await token.balanceOf(recipient.address)
      assert.isTrue(new BN(0).eq(tknBalance))

      assert.equal(ret.logs[0].args.success, false)
      assert.equal(ret.logs[0].args.lastTxSucc, 0)
      assert.equal(ret.logs[0].args.error, 'ERC20: transfer amount exceeds balance')
    })

    it('should call function', async () => {
      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const initialNonce = await fwd.getNonce()

      const tknPayment = {
        tokenRecipient: recipient.address,
        tokenContract: token.address,
        paybackTokens: tokensPaid.toString(),
        tokenGas: 1e6
      }

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: initialNonce.toString(),
        gas: 1e6,
        ...tknPayment,
        isDeploy: false
      }
      console.log(initialNonce.toString())
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })
      const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

      // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
      // declared in solidity
      await fwd.execute(req1, bufferToHex(domainSeparator), typeHash, '0x', sig)

      const tknBalance = await token.balanceOf(recipient.address)
      assert.isTrue(new BN(tokensPaid).eq(tknBalance))
      // @ts-ignore
      const logs = await recipient.getPastEvents('TestForwarderMessage')
      assert.equal(logs.length, 1, 'TestRecipient should emit')
      assert.equal(logs[0].args.realSender, senderAddress, 'TestRecipient should "see" real sender of meta-tx')
      assert.equal((await fwd.getNonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
    })

    it('should return revert message of target revert', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()
      const tknPayment = {
        tokenRecipient: recipient.address,
        tokenContract: token.address,
        paybackTokens: tokensPaid.toString(), 
        tokenGas: 1e6
      }
      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: (await fwd.getNonce()).toString(),
        gas: 1e6,
        ...tknPayment,
        isDeploy: false
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)

      const tknBalance = await token.balanceOf(recipient.address)
      assert.isTrue(new BN(tokensPaid).eq(tknBalance))

      assert.equal(ret.logs[0].args.success, false)
      assert.equal(ret.logs[0].args.lastTxSucc, 1)
      assert.equal(ret.logs[0].args.error, 'always fail')
    })

    it('should not be able to re-submit after revert (its repeated nonce)', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()
      const tknPayment = {
        tokenRecipient: addr(2),
        tokenContract: token.address,
        paybackTokens: '0',
        tokenGas: 1e6
      }
      const req1 = {
        to: recipient.address,
        data: func,
        value: 0,
        from: senderAddress,
        nonce: (await fwd.getNonce()).toString(),
        gas: 1e6,
        ...tknPayment,
        isDeploy: false
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
      assert.equal(ret.logs[0].args.error, 'always fail')
      assert.equal(ret.logs[0].args.success, false)

      await expectRevert.unspecified(testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig), 'nonce mismatch')
    })

    describe('value transfer', async () => {
      let recipient: TestForwarderTargetInstance
      let tokensPaid = 1;

      beforeEach(async () => {
        recipient = await TestForwarderTarget.new(fwd.address)
        await token.mint('1000', fwd.address)
      })


      afterEach('should not leave funds in the forwarder', async () => {
        assert.equal(await web3.eth.getBalance(fwd.address), '0')
      })

      it('should fail to forward request if value specified but not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
        const tknPayment = {
          tokenRecipient: recipient.address,
          tokenContract: token.address,
          paybackTokens: tokensPaid.toString(),
          tokenGas: 1e6
        }
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce()).toString(),
          value: value.toString(),
          gas: 1e6,
          ...tknPayment,
          isDeploy: false
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.success, false)
        assert.equal(ret.logs[0].args.lastTxSucc, 1)

        const tknBalance = await token.balanceOf(recipient.address)
        assert.isTrue(new BN(tokensPaid).eq(tknBalance))
      })

      it('should fail to forward request if value specified but not enough not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
        const tknPayment = {
          tokenRecipient: recipient.address,
          tokenContract: token.address,
          paybackTokens: tokensPaid.toString(),
          tokenGas: 1e6
        }
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce()).toString(),
          value: ether('2').toString(),
          gas: 1e6,
          ...tknPayment,
          isDeploy: false
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig, { value })
        assert.equal(ret.logs[0].args.success, false)
        assert.equal(ret.logs[0].args.lastTxSucc, 1)

        const tknBalance = await token.balanceOf(recipient.address)
        assert.isTrue(new BN(tokensPaid).eq(tknBalance))
      })

      it('should forward request with value', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
        const tknPayment = {
          tokenRecipient: recipient.address,
          tokenContract: token.address,
          paybackTokens: tokensPaid.toString(),
          tokenGas: 1e6
        }
        // value = ether('0');
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce()).toString(),
          value: value.toString(),
          gas: 1e6,
          ...tknPayment,
          isDeploy: false
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig, { value })

        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)
        assert.equal(ret.logs[0].args.lastTxSucc, 2)

        const tknBalance = await token.balanceOf(recipient.address)
        assert.isTrue(new BN(tokensPaid).eq(tknBalance))

        assert.equal(await web3.eth.getBalance(recipient.address), value.toString())
      })

      it('should forward all funds left in forwarder to the owner EOA address', async () => {

        //Modified to comform RSK Forwarder
        
        //The owner of the SmartWallet might have a balance != 0
        const ownerOriginalBalance = await web3.eth.getBalance(senderAddress);
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        const tknPayment = {
          tokenRecipient: recipient.address,
          tokenContract: token.address,
          paybackTokens: tokensPaid.toString(),
          tokenGas: 1e6
        }
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress, //the owner of the smart wallet
          nonce: (await fwd.getNonce()).toString(),
          value: value.toString(),
          gas: 1e6,
          ...tknPayment,
          isDeploy: false
        }

        const extraFunds = ether('4')

        //Put in the smart wallet 4 ethers
        await web3.eth.sendTransaction({ from, to: fwd.address, value: extraFunds })

        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        //This request moves 1 ether to the end contract (recipient)
        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)
        assert.equal(ret.logs[0].args.lastTxSucc, 2)

        //Since the tknPayment is paying the recipient, the called contract (recipient) must have the balance of those tokensPaid
        //Ideally it should pay the relayWorker or paymaster
        const tknBalance = await token.balanceOf(recipient.address)
        assert.isTrue(new BN(tokensPaid).eq(tknBalance))

        //The value=1 ether of value transfered should now be in the balance of the called contract (recipient)
        const valBalance = await web3.eth.getBalance(recipient.address)
        assert.isTrue(new BN(value).eq(new BN(valBalance)))

        //The rest of value (4-1 = 3 ether), in possession of the smart wallet, must return to the owner EOA once the execute()
        //is called
        assert.equal(await web3.eth.getBalance(senderAddress), new BN(ownerOriginalBalance).add(extraFunds.sub(value)).toString())
      })
    })
  })
})

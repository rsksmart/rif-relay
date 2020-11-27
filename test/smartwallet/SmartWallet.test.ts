import {
  SmartWalletInstance,
  TestSmartWalletInstance,
  TestForwarderTargetInstance,
  ProxyFactoryInstance,
  TestTokenInstance,
  TestRecipientInstance,
  SimpleSmartWalletInstance,
  SimpleProxyFactoryInstance
} from '../../types/truffle-contracts'

// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { BN, bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { ether, expectRevert } from '@openzeppelin/test-helpers'
import { toChecksumAddress } from 'web3-utils'
import { isRsk, Environment } from '../../src/common/Environments'
import { getTestingEnvironment, createProxyFactory, createSmartWallet, bytes32, createSimpleProxyFactory, createSimpleSmartWallet } from '../TestUtils'
import TypedRequestData, { getDomainSeparatorHash, ForwardRequestType, ENVELOPING_PARAMS, GsnRequestType } from '../../src/common/EIP712/TypedRequestData'
import { constants } from '../../src/common/Constants'

require('source-map-support').install({ errorFormatterForce: true })

const keccak256 = web3.utils.keccak256
const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const TestTokenRecipient = artifacts.require('TestTokenRecipient')
const TestToken = artifacts.require('TestToken')
const typeHash = keccak256(`${GsnRequestType.typeName}(${ENVELOPING_PARAMS},${GsnRequestType.typeSuffix}`)
const TestSmartWallet = artifacts.require('TestSmartWallet')

const options = [
  {
    title: 'SmartWallet',
    simple: false
  },
  {
    title: 'SimpleSmartWallet',
    simple: true
  }
]

options.forEach(element => {
  contract(element.title, ([defaultAccount, otherAccount]) => {
    const countParams = ForwardRequestType.length
    const senderPrivateKey = toBuffer(bytes32(1))
    let chainId: number
    let senderAddress: string
    let template: SmartWalletInstance | SimpleSmartWalletInstance
    let factory: ProxyFactoryInstance | SimpleProxyFactoryInstance
    let token: TestTokenInstance
    let sw: SmartWalletInstance | SimpleSmartWalletInstance
    let domainSeparatorHash: string

    const request = {
      request: {
        from: constants.ZERO_ADDRESS,
        to: constants.ZERO_ADDRESS,
        value: '0',
        gas: '1000000',
        nonce: '0',
        data: '0x',
        tokenRecipient: constants.ZERO_ADDRESS,
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '1',
        factory: constants.ZERO_ADDRESS,
        recoverer: constants.ZERO_ADDRESS,
        index: '0'
      },
      relayData: {
        pctRelayFee: '1',
        baseRelayFee: '1',
        gasPrice: '1',
        relayWorker: constants.ZERO_ADDRESS,
        forwarder: constants.ZERO_ADDRESS,
        paymaster: constants.ZERO_ADDRESS,
        paymasterData: '0x',
        clientId: '1'
      }
    }

    before(async () => {
      chainId = (await getTestingEnvironment()).chainId
      senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)), chainId).toLowerCase()
      request.request.from = senderAddress
      token = await TestToken.new()
      request.request.tokenContract = token.address

      if (element.simple) {
        const SimpleSmartWallet = artifacts.require('SimpleSmartWallet')
        template = await SimpleSmartWallet.new()
        factory = await createSimpleProxyFactory(template)
        sw = await createSimpleSmartWallet(senderAddress, factory, senderPrivateKey, chainId)
      } else {
        const SmartWallet = artifacts.require('SmartWallet')
        template = await SmartWallet.new()
        factory = await createProxyFactory(template)
        sw = await createSmartWallet(senderAddress, factory, senderPrivateKey, chainId)
      }

      request.relayData.forwarder = sw.address
      domainSeparatorHash = getDomainSeparatorHash(sw.address, chainId)
    })

    describe('#verify', () => {
      describe('#verify failures', () => {
        it('should fail on unregistered domain separator', async () => {
          const dummyDomainSeparator = bytes32(1)
          const dataToSign = new TypedRequestData(
            chainId,
            sw.address,
            request
          )
          const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))
          const sig = signTypedData_v4(senderPrivateKey, { data: dataToSign })
          // TODO: when the RSKJ node includes the functionality to return the revert reason for require we need to remove the .unspecified from the expectRevert.
          await expectRevert.unspecified(sw.verify(request.request, dummyDomainSeparator, typeHash, suffixData, sig), 'unregistered domain separator')
        })

        it('should fail on wrong nonce', async () => {
          const env: Environment = await getTestingEnvironment()
          const message: string = isRsk(env) ? 'Returned error: VM execution error: nonce mismatch' : 'revert nonce mismatch'

          const req = {
            request: {
              ...request.request,
              nonce: '123'
            },
            relayData: {
              ...request.relayData
            }
          }
          const dataToSign = new TypedRequestData(
            chainId,
            sw.address,
            req
          )
          const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))
          const sig = signTypedData_v4(senderPrivateKey, { data: dataToSign })

          // TODO: when the RSKJ node includes the functionality to return the revert reason for require we need to remove the .unspecified from the expectRevert.
          await expectRevert.unspecified(sw.verify(req.request, domainSeparatorHash, typeHash, suffixData, sig), message)
        })
        it('should fail on invalid signature', async () => {
          const dataToSign = new TypedRequestData(
            chainId,
            sw.address,
            request
          )
          const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))
          const sig: string = signTypedData_v4(senderPrivateKey, { data: dataToSign })

          // TODO: when the RSKJ node includes the functionality to return the revert reason for require we need to remove the .unspecified from the expectRevert.
          await expectRevert.unspecified(sw.verify(request.request, domainSeparatorHash, typeHash, suffixData, '0x'), 'invalid signature length')
          await expectRevert.unspecified(sw.verify(request.request, domainSeparatorHash, typeHash, suffixData, '0x123456'), 'invalid signature length')
          await expectRevert.unspecified(sw.verify(request.request, domainSeparatorHash, typeHash, suffixData, '0x' + '1b'.repeat(65)), 'signature mismatch')
          const newSig = sig.replace('a', 'b').replace('1', '2').replace('3', '4').replace('5', '6').replace('7', '8')
          await expectRevert.unspecified(sw.verify(request.request, domainSeparatorHash, typeHash, suffixData, newSig), 'signature mismatch')
        })
      })
      describe('#verify success', () => {
        before(async () => {
          request.request.nonce = (await sw.nonce()).toString()
        })

        it('should verify valid signature', async () => {
          request.request.nonce = (await sw.nonce()).toString()
          const dataToSign = new TypedRequestData(
            chainId,
            sw.address,
            request
          )
          const sig: string = signTypedData_v4(senderPrivateKey, { data: dataToSign })
          const suffixData = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))

          await sw.verify(request.request, domainSeparatorHash, typeHash, suffixData, sig)
        })
      })
    })

    describe('#verifyAndCall', () => {
      let recipient: TestForwarderTargetInstance
      let testfwd: TestSmartWalletInstance

      before(async () => {
        await token.mint('1000', sw.address)

        recipient = await TestForwarderTarget.new()
        testfwd = await TestSmartWallet.new()

        request.request.tokenRecipient = recipient.address
        request.request.tokenAmount = '0'
      })

      it('should return revert message of token payment revert', async () => {
        const func = recipient.contract.methods.testRevert().encodeABI()

        const req1 = { ...request }
        req1.request.to = recipient.address
        req1.request.data = func
        req1.request.nonce = (await sw.nonce()).toString()
        req1.request.tokenAmount = '10000000000'

        const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

        const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
        const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

        const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

        // the helper simply emits the method return values
        const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig)
        const tknBalance = await token.balanceOf(recipient.address)

        assert.isTrue(new BN(0).eq(tknBalance))
        assert.equal(ret.logs[0].args.success, false)
        assert.equal(ret.logs[0].args.lastSuccTx, 0)
        assert.equal(ret.logs[0].args.error, 'ERC20: transfer amount exceeds balance')
      })

      it('should call function', async () => {
        const func = recipient.contract.methods.emitMessage('hello').encodeABI()
        const initialRecipientBalance = await token.balanceOf(recipient.address)

        const initialNonce = (await sw.nonce())

        const req1 = { ...request }
        req1.request.data = func
        req1.request.to = recipient.address
        req1.request.nonce = initialNonce.toString()
        req1.request.tokenAmount = '1'

        const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

        const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
        const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))
        // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
        // declared in solidity
        await sw.execute(req1.request, domainSeparatorHash, typeHash, suffixData, sig)

        const tknBalance = await token.balanceOf(recipient.address)
        assert.equal(tknBalance.sub(initialRecipientBalance).toString(), new BN(1).toString())
        // @ts-ignore
        const logs = await recipient.getPastEvents('TestForwarderMessage')
        assert.equal(logs.length, 1, 'TestRecipient should emit')
        assert.equal(logs[0].args.origin, defaultAccount, 'test "from" account is the tx.origin')
        assert.equal(logs[0].args.msgSender, sw.address, 'msg.sender must be the smart wallet address')

        assert.equal((await sw.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
      })

      it('should return revert message of target revert', async () => {
        const func = recipient.contract.methods.testRevert().encodeABI()
        const initialRecipientBalance = await token.balanceOf(recipient.address)

        const req1 = { ...request }
        req1.request.data = func
        req1.request.to = recipient.address
        req1.request.nonce = (await sw.nonce()).toString()
        req1.request.tokenAmount = '1'

        const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

        const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

        const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
        const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

        // the helper simply emits the method return values
        const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig)
        assert.equal(ret.logs[0].args.error, 'always fail')
        assert.equal(ret.logs[0].args.lastSuccTx, 1)

        // Payment must have happened regardless of the revert
        const tknBalance = await token.balanceOf(recipient.address)
        assert.equal(tknBalance.toString(), initialRecipientBalance.add(new BN(1)).toString())
      })

      it('should not be able to re-submit after revert (its repeated nonce)', async () => {
        const func = recipient.contract.methods.testRevert().encodeABI()
        const initialRecipientBalance = await token.balanceOf(recipient.address)

        const req1 = { ...request }
        req1.request.data = func
        req1.request.to = recipient.address
        req1.request.nonce = (await sw.nonce()).toString()
        req1.request.tokenAmount = '1'

        const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

        const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

        const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
        const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

        // the helper simply emits the method return values
        const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig)
        assert.equal(ret.logs[0].args.error, 'always fail')
        assert.equal(ret.logs[0].args.success, false)
        assert.equal(ret.logs[0].args.lastSuccTx, 1)

        const tknBalance = await token.balanceOf(recipient.address)
        assert.equal(tknBalance.toString(), initialRecipientBalance.add(new BN(1)).toString())

        await expectRevert.unspecified(testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig), 'nonce mismatch')

        const tknBalance2 = await token.balanceOf(recipient.address)
        assert.equal(tknBalance.toString(), tknBalance2.toString())
      })

      describe('value transfer', () => {
        let recipient: TestForwarderTargetInstance
        const tokensPaid = 1

        before(async () => {
          await token.mint('1000', sw.address)
        })
        beforeEach(async () => {
          recipient = await TestForwarderTarget.new()
        })
        afterEach('should not leave funds in the forwarder', async () => {
          assert.equal(await web3.eth.getBalance(sw.address), '0')
        })

        it('should fail to forward request if value specified but not provided', async () => {
          const value = ether('1')
          const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
          const initialRecipientBalance = await token.balanceOf(recipient.address)

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = '1'
          req1.request.value = value.toString()
          req1.request.tokenRecipient = recipient.address

          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)
          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

          const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
          const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

          const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig, { value: '0' })
          assert.equal(ret.logs[0].args.success, false)
          assert.equal(ret.logs[0].args.lastSuccTx, 1)
          // Token transfer happens first
          const tknBalance = await token.balanceOf(recipient.address)
          assert.equal(tknBalance.toString(), (initialRecipientBalance.add(new BN(1))).toString())
        })

        it('should fail to forward request if value specified but not enough not provided', async () => {
          const value = ether('1')
          const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
          const initialRecipientBalance = await token.balanceOf(recipient.address)

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = '1'
          req1.request.value = ether('2').toString()
          req1.request.tokenRecipient = recipient.address

          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)
          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
          const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

          const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig, { value })
          assert.equal(ret.logs[0].args.success, false)
          assert.equal(ret.logs[0].args.lastSuccTx, 1)
          // Token transfer happens first
          const tknBalance = await token.balanceOf(recipient.address)
          assert.equal(tknBalance.toString(), (initialRecipientBalance.add(new BN(1))).toString())
        })

        it('should forward request with value', async () => {
          const value = ether('1')
          const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
          const initialRecipientBalance = await token.balanceOf(recipient.address)
          const initialRecipientEtherBalance = await web3.eth.getBalance(recipient.address)

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = '1'
          req1.request.value = value.toString()
          req1.request.tokenRecipient = recipient.address

          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

          const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
          const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

          const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig, { value })
          assert.equal(ret.logs[0].args.error, '')
          assert.equal(ret.logs[0].args.success, true)
          assert.equal(ret.logs[0].args.lastSuccTx, 2)

          assert.equal(await web3.eth.getBalance(recipient.address), (new BN(initialRecipientEtherBalance).add(value)).toString())

          const tknBalance = await token.balanceOf(recipient.address)
          assert.equal(tknBalance.toString(), (initialRecipientBalance.add(new BN(1))).toString())
        })

        it('should forward all funds left in forwarder to "from" address', async () => {
          // The owner of the SmartWallet might have a balance != 0
          const ownerOriginalBalance = await web3.eth.getBalance(senderAddress)
          const recipientOriginalBalance = await web3.eth.getBalance(recipient.address)
          const smartWalletBalance = await web3.eth.getBalance(sw.address)
          assert.equal(smartWalletBalance, '0', 'SmartWallet balance is not zero')

          const value = ether('1')
          const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = tokensPaid.toString()
          req1.request.value = value.toString()
          req1.request.tokenRecipient = recipient.address

          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

          const extraFunds = ether('4')
          await web3.eth.sendTransaction({ from: defaultAccount, to: sw.address, value: extraFunds })

          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

          const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
          const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

          // note: not transfering value in TX.
          const ret = await testfwd.callExecute(sw.address, req1.request, domainSeparatorHash, typeHash, suffixData, sig)
          assert.equal(ret.logs[0].args.error, '')
          assert.equal(ret.logs[0].args.success, true)
          assert.equal(ret.logs[0].args.lastSuccTx, 2)

          // Since the tknPayment is paying the recipient, the called contract (recipient) must have the balance of those tokensPaid
          // Ideally it should pay the relayWorker or paymaster
          const tknBalance = await token.balanceOf(recipient.address)
          assert.isTrue(BigInt(tokensPaid) === BigInt(tknBalance))

          // The value=1 ether of value transfered should now be in the balance of the called contract (recipient)
          const valBalance = await web3.eth.getBalance(recipient.address)

          assert.isTrue(BigInt(value.toString()) === (BigInt(valBalance) - BigInt(recipientOriginalBalance)))

          // The rest of value (4-1 = 3 ether), in possession of the smart wallet, must return to the owner EOA once the execute()
          // is called
          assert.equal(await web3.eth.getBalance(senderAddress), (BigInt(ownerOriginalBalance) + BigInt(extraFunds) - BigInt(value.toString())).toString())
        })
      })
    })

    describe('#verifyAndCallByOwner', () => {
      let recipient: TestForwarderTargetInstance
      let template: SimpleSmartWalletInstance | SmartWalletInstance
      let factory: SimpleProxyFactoryInstance | ProxyFactoryInstance
      let sw: SimpleSmartWalletInstance | SmartWalletInstance
      const otherAccountPrivateKey: Buffer = Buffer.from('0c06818f82e04c564290b32ab86b25676731fc34e9a546108bf109194c8e3aae', 'hex')

      before(async () => {
        console.log('Running tests using accont: ', otherAccount)

        if (element.simple) {
          const SimpleSmartWallet = artifacts.require('SimpleSmartWallet')
          template = await SimpleSmartWallet.new()
          factory = await createSimpleProxyFactory(template)
          sw = await createSimpleSmartWallet(otherAccount, factory, otherAccountPrivateKey, chainId)
        } else {
          const SmartWallet = artifacts.require('SmartWallet')
          template = await SmartWallet.new()
          factory = await createProxyFactory(template)
          sw = await createSmartWallet(otherAccount, factory, otherAccountPrivateKey, chainId)
        }

        await token.mint('1000', sw.address)
        recipient = await TestForwarderTarget.new()
      })

      it('should call function', async () => {
        const func = recipient.contract.methods.emitMessage('hello').encodeABI()

        const initialNonce = await sw.nonce()
        await sw.directExecute(recipient.address, func, { from: otherAccount })

        // @ts-ignore
        const logs = await recipient.getPastEvents('TestForwarderMessage')
        assert.equal(logs.length, 1, 'TestRecipient should emit')
        assert.equal(logs[0].args.origin, otherAccount, 'test "from" account is the tx.origin')
        assert.equal(logs[0].args.msgSender, sw.address, 'msg.sender must be the smart wallet address')

        assert.equal((await sw.nonce()).toString(), initialNonce.toString(), 'direct execute should NOT increment nonce')
      })

      it('should NOT call function if msg.sender is not the SmartWallet owner', async () => {
        const func = recipient.contract.methods.emitMessage('hello').encodeABI()
        await expectRevert.unspecified(sw.directExecute(recipient.address, func, { from: defaultAccount }), 'Not the owner of the SmartWallet')
      })

      it('should return revert message of target revert', async () => {
        const func = recipient.contract.methods.testRevert().encodeABI()
        await sw.directExecute(recipient.address, func, { from: otherAccount })
        const result = await sw.directExecute.call(recipient.address, func, { from: otherAccount })

        const revertMessage = Buffer.from(result[1].slice(result[1].length - 64, result[1].length), 'hex')
        const reducedBuff = revertMessage.slice(0, 11)
        const restBuff = revertMessage.slice(11, revertMessage.length)
        assert.equal(restBuff.readBigInt64BE(), BigInt(0), 'must be zero')
        assert.equal(reducedBuff.toString(), 'always fail', 'Incorrect revert message received')
      })

      describe('value transfer', () => {
        let recipient: TestForwarderTargetInstance

        beforeEach(async () => {
          recipient = await TestForwarderTarget.new()
        })
        afterEach('should not leave funds in the forwarder', async () => {
          assert.equal(await web3.eth.getBalance(sw.address), '0')
        })

        it('should forward request with value', async () => {
          const value = ether('1')
          const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
          const initialRecipientEtherBalance = await web3.eth.getBalance(recipient.address)
          const initialSenderBalance = await web3.eth.getBalance(otherAccount)
          const ret = await sw.directExecute(recipient.address, func, { from: otherAccount, value: value.toString(), gasPrice: value.toString() })
          const gasUsedToCall = BigInt(ret.receipt.cumulativeGasUsed) * BigInt(value.toString()) // Gas price = 1 ether
          const finalRecipientEtherBalance = await web3.eth.getBalance(recipient.address)
          const finalSenderBalance = await web3.eth.getBalance(otherAccount)
          assert.equal(BigInt(finalRecipientEtherBalance).toString(), (BigInt(initialRecipientEtherBalance) + BigInt(value.toString())).toString())
          assert.equal(BigInt(finalSenderBalance).toString(), (BigInt(initialSenderBalance) - BigInt(value.toString()) - gasUsedToCall).toString())
        })

        it('should forward all funds left in forwarder to "from" address', async () => {
          // The owner of the SmartWallet might have a balance != 0
          const ownerOriginalBalance = await web3.eth.getBalance(otherAccount)
          const recipientOriginalBalance = await web3.eth.getBalance(recipient.address)

          const value = ether('1')
          const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

          const extraFunds = ether('4')
          // Put in the smart wallet 4 ethers
          await web3.eth.sendTransaction({ from: defaultAccount, to: sw.address, value: extraFunds })

          // note: not transfering value in TX.
          const ret = await sw.directExecute(recipient.address, func, { from: otherAccount, gasPrice: value.toString(), value: value.toString() })
          const gasUsedToCall = BigInt(ret.receipt.cumulativeGasUsed) * BigInt(value.toString()) // Gas price = 1 ether

          // The value=1 ether of value transfered should now be in the balance of the called contract (recipient)
          const valBalance = await web3.eth.getBalance(recipient.address)
          assert.isTrue(BigInt(value.toString()) === (BigInt(valBalance) - BigInt(recipientOriginalBalance)))

          // The rest of value (4-1 = 3 ether), in possession of the smart wallet, must return to the owner EOA once the execute()
          // is called
          assert.equal(await web3.eth.getBalance(otherAccount), (BigInt(ownerOriginalBalance) + BigInt(extraFunds) - BigInt(value) - BigInt(gasUsedToCall)).toString())
        })
      })
    })
  })
})

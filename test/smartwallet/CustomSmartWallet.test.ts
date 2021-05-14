import {
  CustomSmartWalletFactoryInstance,
  CustomSmartWalletInstance,
  NonCompliantTestTokenInstance,
  NonRevertTestTokenInstance,
  SmartWalletFactoryInstance,
  SmartWalletInstance,
  TestForwarderTargetInstance,
  TestSmartWalletInstance,
  TestTokenInstance,
  TetherTokenInstance
} from '../../types/truffle-contracts'

// @ts-ignore
import {EIP712TypedData, signTypedData_v4, TypedDataUtils} from 'eth-sig-util'
import {BN, bufferToHex, privateToAddress, toBuffer} from 'ethereumjs-util'
import {toBN} from 'web3-utils'
import {bytes32, containsEvent, getTestingEnvironment} from '../TestUtils'
import TypedRequestData, {ForwardRequestType, getDomainSeparatorHash} from '../../src/common/EIP712/TypedRequestData'
import {constants} from '../../src/common/Constants'
import {RelayRequest} from '../../src/common/EIP712/RelayRequest'
import { ether, expectRevert, expectEvent } from '@openzeppelin/test-helpers'

require('source-map-support').install({ errorFormatterForce: true })

const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const TestToken = artifacts.require('TestToken')
const TetherToken = artifacts.require('TetherToken')
const NonRevertTestToken = artifacts.require('NonRevertTestToken')
const NonCompliantTestToken = artifacts.require('NonCompliantTestToken')
const TestSmartWallet = artifacts.require('TestSmartWallet')
const SuccessCustomLogic = artifacts.require('SuccessCustomLogic')
const FailureCustomLogic = artifacts.require('FailureCustomLogic')
const CustomSmartWallet = artifacts.require('CustomSmartWallet')

const options = [
  {
    title: 'CustomSmartWallet',
    simple: false
  }
]

const tokens = [
  {
    title: 'TestToken',
    tokenIndex: 0
  }
]

async function fillTokens (tokenIndex: number, token: TestTokenInstance|TetherTokenInstance|NonRevertTestTokenInstance|NonCompliantTestTokenInstance, recipient: string, amount: string): Promise<void> {
  switch (tokenIndex) {
    case 0:
      await (token as TestTokenInstance).mint(amount, recipient)
      break
    case 1:
      await (token as TetherTokenInstance).issue(amount)
      await (token as TetherTokenInstance).transfer(recipient, amount)
      break
    case 2:
      await (token as NonRevertTestTokenInstance).mint(amount, recipient)
      break
    case 3:
      await (token as NonCompliantTestTokenInstance).mint(amount, recipient)
      break
  }
}

async function getTokenBalance (tokenIndex: number, token: TestTokenInstance|TetherTokenInstance|NonRevertTestTokenInstance|NonCompliantTestTokenInstance, account: string): Promise<BN> {
  let balance: BN = toBN(-1)
  switch (tokenIndex) {
    case 0:
      balance = await (token as TestTokenInstance).balanceOf(account)
      break
    case 1:
      balance = await (token as TetherTokenInstance).balanceOf.call(account)
      break
    case 2:
      balance = await (token as NonRevertTestTokenInstance).balanceOf(account)
      break
    case 3:
      balance = await (token as NonCompliantTestTokenInstance).balanceOf(account)
      break
  }
  return balance
}

tokens.forEach(tokenToUse => {
    contract(`Custom Smart Wallet using ${tokenToUse.title}`, ([defaultAccount, otherAccount, recovererAccount, payerAccount]) => {
      const countParams = ForwardRequestType.length
      const senderPrivateKey = toBuffer(bytes32(1))
      let chainId: number
      let senderAddress: string
      let template: SmartWalletInstance | CustomSmartWalletInstance
      let factory: CustomSmartWalletFactoryInstance | SmartWalletFactoryInstance
      let token: TestTokenInstance | TetherTokenInstance | NonRevertTestTokenInstance | NonCompliantTestTokenInstance
      let sw: SmartWalletInstance | CustomSmartWalletInstance
      let domainSeparatorHash: string

      const request: RelayRequest = {
        request: {
          relayHub: constants.ZERO_ADDRESS,
          from: constants.ZERO_ADDRESS,
          to: constants.ZERO_ADDRESS,
          value: '0',
          gas: '1000000',
          nonce: '0',
          data: '0x',
          tokenContract: constants.ZERO_ADDRESS,
          tokenAmount: '1',
          tokenGas: '50000'
        },
        relayData: {
          gasPrice: '1',
          domainSeparator: '0x',
          relayWorker: constants.ZERO_ADDRESS,
          callForwarder: constants.ZERO_ADDRESS,
          callVerifier: constants.ZERO_ADDRESS
        }
      }

      before(async () => {
        chainId = (await getTestingEnvironment()).chainId
        senderAddress = bufferToHex(privateToAddress(senderPrivateKey)).toLowerCase()
        request.request.from = senderAddress

        switch (tokenToUse.tokenIndex) {
          case 0:
            token = await TestToken.new()
            break
          case 1:
            token = await TetherToken.new(1000000000, 'TetherToken', 'USDT', 18)
            break
          case 2:
            token = await NonRevertTestToken.new()
            break
          case 3:
            token = await NonCompliantTestToken.new()
            break
        }
        request.request.tokenContract = token.address
      })

      beforeEach(async () => {
        sw = await CustomSmartWallet.new();
        request.relayData.callForwarder = sw.address
        request.relayData.domainSeparator = getDomainSeparatorHash(sw.address, chainId)
        domainSeparatorHash = request.relayData.domainSeparator
      });

      describe('#verifyAndCall', () => {
        let recipient: TestForwarderTargetInstance
        let testfwd: TestSmartWalletInstance

        const worker = defaultAccount

        beforeEach(async () => {
          await fillTokens(tokenToUse.tokenIndex, token, sw.address, '1000')

          recipient = await TestForwarderTarget.new()
          testfwd = await TestSmartWallet.new()

          request.request.tokenAmount = '0'
        })

        it('should call function with custom logic', async () => {
          // Init smart wallet and
          const customLogic = await SuccessCustomLogic.new()
          await sw.initialize(senderAddress, customLogic.address, token.address, defaultAccount, "0", "400000", "0x");

          const func = recipient.contract.methods.emitMessage('hello').encodeABI()
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const initialSWalletTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          const initialNonce = await sw.nonce()

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = initialNonce.toString()
          req1.request.tokenAmount = '1'
          req1.request.relayHub = defaultAccount
          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1);
          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
          const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))
          // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
          // declared in solidity

          const result = await sw.execute(domainSeparatorHash, suffixData, req1.request, sig, { from: worker  });

          assert(containsEvent(customLogic.abi, result.receipt.rawLogs, "LogicCalled"), "Should call custom logic")

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
          assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')
 
          assert.equal((await sw.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
        });

        it('should return revert message of logic revert', async () => {
          const customLogic = await FailureCustomLogic.new()
          await sw.initialize(senderAddress, customLogic.address, token.address, defaultAccount, "0", "400000", "0x");

          const hub = await TestSmartWallet.new();

          const func = recipient.contract.methods.emitMessage('hello').encodeABI()
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const initialSWalletTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          const initialNonce = await sw.nonce()

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = initialNonce.toString()
          req1.request.tokenAmount = '1'
          req1.request.relayHub = hub.address
          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1);
          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
          const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))
          // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
          // declared in solidity

          const result = await hub.callExecute(sw.address, req1.request, domainSeparatorHash, suffixData,  sig, { from: worker  });
          assert.equal(result.logs[0].args.error, 'always fail', "Incorrect message")
          assert.equal(result.logs[0].args.success, false, "Should have failed")

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
          assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')
 
          assert.equal((await sw.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
        });


        it('should not be able to re-submit after revert', async () => {
          const customLogic = await FailureCustomLogic.new()
          await sw.initialize(senderAddress, customLogic.address, token.address, defaultAccount, "0", "400000", "0x");

          const hub = await TestSmartWallet.new();

          const func = recipient.contract.methods.emitMessage('hello').encodeABI()
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const initialSWalletTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          const initialNonce = await sw.nonce()

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = initialNonce.toString()
          req1.request.tokenAmount = '1'
          req1.request.relayHub = hub.address
          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1);
          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
          const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))
          // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
          // declared in solidity

          const result = await hub.callExecute(sw.address, req1.request, domainSeparatorHash, suffixData,  sig, { from: worker  });
          assert.equal(result.logs[0].args.error, 'always fail', "Incorrect message")
          assert.equal(result.logs[0].args.success, false, "Should have failed")

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
         
          assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
          assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')
           
          await expectRevert.unspecified(hub.callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig, { from: worker }), 'nonce mismatch')

          const tknBalance2 = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance2 = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          assert.equal(tknBalance2.toString(), tknBalance.toString(), 'Incorrect new worker token balance')
          assert.equal(swTknBalance2.toString(), swTknBalance.toString(), 'Incorrect new smart wallet token balance')
 
          assert.equal((await sw.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
        })
        
      }); 
    })
  })

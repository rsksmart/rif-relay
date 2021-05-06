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
import {bytes32, createCustomSmartWallet, createCustomSmartWalletFactory, getTestingEnvironment} from '../TestUtils'
import TypedRequestData, {ForwardRequestType, getDomainSeparatorHash} from '../../src/common/EIP712/TypedRequestData'
import {constants} from '../../src/common/Constants'
import {RelayRequest} from '../../src/common/EIP712/RelayRequest'

require('source-map-support').install({ errorFormatterForce: true })

const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const TestToken = artifacts.require('TestToken')
const TetherToken = artifacts.require('TetherToken')
const NonRevertTestToken = artifacts.require('NonRevertTestToken')
const NonCompliantTestToken = artifacts.require('NonCompliantTestToken')
const TestSmartWallet = artifacts.require('TestSmartWallet')
const SuccessCustomLogic = artifacts.require('SuccessCustomLogic')

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

      let customLogic = null

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
        customLogic = await SuccessCustomLogic.new()
        const CustomSmartWallet = artifacts.require('CustomSmartWallet')
        template = await CustomSmartWallet.new()
        factory = await createCustomSmartWalletFactory(template)
        console.log('Using custom logic with address', customLogic.address)
        sw = await createCustomSmartWallet(defaultAccount, senderAddress, factory, senderPrivateKey, chainId, customLogic.address)

        request.relayData.callForwarder = sw.address
        request.relayData.domainSeparator = getDomainSeparatorHash(sw.address, chainId)
        domainSeparatorHash = request.relayData.domainSeparator
      })

      describe('#verifyAndCall', () => {
        let recipient: TestForwarderTargetInstance
        let testfwd: TestSmartWalletInstance

        const worker = defaultAccount

        before(async () => {
          await fillTokens(tokenToUse.tokenIndex, token, sw.address, '1000')

          recipient = await TestForwarderTarget.new()
          testfwd = await TestSmartWallet.new()

          request.request.tokenAmount = '0'
        })

        it('should call function with custom logic', async () => {
          const func = recipient.contract.methods.emitMessage('hello').encodeABI()
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const initialSWalletTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          const initialNonce = (await sw.nonce())

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = initialNonce.toString()
          req1.request.tokenAmount = '1'
          req1.request.relayHub = defaultAccount
          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
          const suffixData = bufferToHex(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))
          // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
          // declared in solidity
          await sw.execute(domainSeparatorHash, suffixData, req1.request, sig, { from: worker })

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          assert.equal(tknBalance.sub(initialWorkerTokenBalance).toString(), new BN(1).toString(), 'Incorrect new worker token balance')
          assert.equal(initialSWalletTokenBalance.sub(swTknBalance).toString(), new BN(1).toString(), 'Incorrect new smart wallet token balance')

          // @ts-ignore
          // const customLogicLogs = await customLogic.getPastEvents('LogicCalled')
          // assert.equal(customLogicLogs.length, 1, 'CustomLogic should emit')

          const logs = await recipient.getPastEvents('TestForwarderMessage')
          assert.equal(logs.length, 1, 'TestRecipient should emit')
          assert.equal(logs[0].args.origin, defaultAccount, 'test "from" account is the tx.origin')
          assert.equal(logs[0].args.msgSender, sw.address, 'msg.sender must be the smart wallet address')

          assert.equal((await sw.nonce()).toString(), initialNonce.add(new BN(1)).toString(), 'verifyAndCall should increment nonce')
        })
      })
    })
  })

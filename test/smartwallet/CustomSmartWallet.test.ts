import {
  TestSmartWalletInstance,
  TestForwarderTargetInstance,
  TestTokenInstance,
  CustomSmartWalletInstance,
  CustomSmartWalletFactoryInstance,
  SmartWalletInstance,
  SmartWalletFactoryInstance,
  TetherTokenInstance,
  NonRevertTestTokenInstance,
  NonCompliantTestTokenInstance
} from '../../types/truffle-contracts'

// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { BN, bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { ether, expectRevert } from '@openzeppelin/test-helpers'
import { toBN, toChecksumAddress } from 'web3-utils'
import { isRsk, Environment } from '../../src/common/Environments'
import { getTestingEnvironment, createCustomSmartWalletFactory, createCustomSmartWallet, bytes32, createSmartWalletFactory, createSmartWallet } from '../TestUtils'
import TypedRequestData, { getDomainSeparatorHash, ForwardRequestType } from '../../src/common/EIP712/TypedRequestData'
import { constants } from '../../src/common/Constants'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'

require('source-map-support').install({ errorFormatterForce: true })

const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const TestToken = artifacts.require('TestToken')
const TetherToken = artifacts.require('TetherToken')
const NonRevertTestToken = artifacts.require('NonRevertTestToken')
const NonCompliantTestToken = artifacts.require('NonCompliantTestToken')
const SuccessCustomLogic = artifacts.require('SuccessCustomLogic')
const CustomSmartWallet = artifacts.require('CustomSmartWallet')

const tokens = [
  {
    title: 'TestToken',
    tokenIndex: 0
  },
  {
    title: 'TetherToken',
    tokenIndex: 1
  },
  {
    title: 'NonRevertTestToken',
    tokenIndex: 2
  },
  {
    title: 'NonCompliantTestToken',
    tokenIndex: 3
  }
]

async function createToken(tokenToUse: { title: string; tokenIndex: number }): Promise<TestTokenInstance | TetherTokenInstance | NonRevertTestTokenInstance | NonCompliantTestTokenInstance> {
  switch (tokenToUse.tokenIndex) {
    default:
    case 0:
      return await TestToken.new()
    case 1:
      return await TetherToken.new(1000000000, 'TetherToken', 'USDT', 18)
    case 2:
      return await NonRevertTestToken.new()
    case 3:
      return await NonCompliantTestToken.new()
  }
}



async function fillTokens(tokenIndex: number, token: TestTokenInstance | TetherTokenInstance | NonRevertTestTokenInstance | NonCompliantTestTokenInstance, recipient: string, amount: string): Promise<void> {
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

async function getTokenBalance(tokenIndex: number, token: TestTokenInstance | TetherTokenInstance | NonRevertTestTokenInstance | NonCompliantTestTokenInstance, account: string): Promise<BN> {
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
  contract(`CustomSmartWallet using ${tokenToUse.title}`, ([defaultAccount, otherAccount, recovererAccount, payerAccount]) => {
    const countParams = ForwardRequestType.length
    const senderPrivateKey = toBuffer(bytes32(1))
    let chainId: number
    let senderAddress: string
    let template: CustomSmartWalletInstance
    let factory: CustomSmartWalletFactoryInstance
    let token: TestTokenInstance | TetherTokenInstance | NonRevertTestTokenInstance | NonCompliantTestTokenInstance
    let wallet: CustomSmartWalletInstance
    let domainSeparatorHash: string

    let request: RelayRequest;

    async function clearEnvironment() {
      chainId = (await getTestingEnvironment()).chainId
      senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)), chainId).toLowerCase()

    }

    before(clearEnvironment)

    describe('#verify', () => {

      describe('#verifyAndCallByOwnerWithCustomLogic', () => {
        let recipient: TestForwarderTargetInstance
        const otherAccountPrivateKey: Buffer = Buffer.from('0c06818f82e04c564290b32ab86b25676731fc34e9a546108bf109194c8e3aae', 'hex')
        const otherAccountAddress = toChecksumAddress(bufferToHex(privateToAddress(otherAccountPrivateKey)), chainId).toLowerCase()

        it('should call logic', async () => {

          console.log('Running tests using account: ', otherAccount)
          token = await createToken(tokenToUse);
          const wallet = await CustomSmartWallet.new()
          await fillTokens(tokenToUse.tokenIndex, token, wallet.address, '1000')
          recipient = await TestForwarderTarget.new()

          const logic: any = await SuccessCustomLogic.new();
          const initRes = await wallet.initialize(otherAccount, logic.address, token.address, senderAddress, "0", "0", "0x", {from: otherAccount, gas: "400000"});
          console.log(initRes.receipt.logs)
          
          // await createCustomSmartWallet(defaultAccount, otherAccount, factory, otherAccountPrivateKey, chainId, logic.address);
          
          const func = recipient.contract.methods.emitMessage('hello').encodeABI()

          const response = await wallet.directExecute(recipient.address, func, { from: otherAccount })
          // @ts-ignore
          const recipientLogs = await recipient.getPastEvents('TestForwarderMessage')
          const logicLogs = await logic.getPastEvents('LogicCalled')
          console.log(response)
          console.log(recipientLogs);
          console.log(logicLogs);
          console.log(response.logs);
          console.log(response.receipt.rawLogs);
          console.log(response.receipt.logs);
          assert.equal(recipientLogs.length, 0, 'TestRecipient should not emit')
          assert.equal(logicLogs.length, 1, 'LogicCalled should emit')
          assert.equal(logicLogs[0].args.origin, otherAccount, 'test "from" account is the tx.origin')
          assert.equal(logicLogs[0].args.msgSender, wallet.address, 'msg.sender must be the smart wallet address')
        })

      });
    })
  });
})

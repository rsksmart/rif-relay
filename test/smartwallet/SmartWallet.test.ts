// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils } from 'eth-sig-util'
import { getTestingEnvironment, createCustomSmartWalletFactory, createCustomSmartWallet, bytes32, createSmartWalletFactory, createSmartWallet, encodeRevertReason, stripHex } from '../TestUtils'
import TypedRequestData, { getDomainSeparatorHash, ForwardRequestType } from '../../src/common/EIP712/TypedRequestData'
import { constants } from '../../src/common/Constants'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import { TestForwarderTarget, TestSmartWallet, CustomSmartWallet, CustomSmartWalletFactory, CustomSmartWallet__factory, NonCompliantTestToken, NonCompliantTestToken__factory, NonRevertTestToken, NonRevertTestToken__factory, SmartWallet, SmartWalletFactory, SmartWallet__factory, TestForwarderTarget__factory, TestSmartWallet__factory, TestToken, TestToken__factory, TetherToken, TetherToken__factory } from '../../typechain'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'

// require('source-map-support').install({ errorFormatterForce: true })

const options = [
  {
    title: 'CustomSmartWallet',
    simple: false
  },
  {
    title: 'SmartWallet',
    simple: true
  }
]

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

async function fillTokens (tokenIndex: number, token: TestToken|TetherToken|NonRevertTestToken|NonCompliantTestToken, recipient: string, amount: string): Promise<void> {
  switch (tokenIndex) {
    case 0:
      await (token as TestToken).mint(amount, recipient)
      break
    case 1:
      await (token as TetherToken).issue(amount)
      await (token as TetherToken).transfer(recipient, amount)
      break
    case 2:
      await (token as NonRevertTestToken).mint(amount, recipient)
      break
    case 3:
      await (token as NonCompliantTestToken).mint(amount, recipient)
      break
  }
}

async function getTEtherTokenBalance (token: TestToken|TetherToken|NonRevertTestToken|NonCompliantTestToken, account: string): Promise<BigNumber> {
  const tx = await (token as TetherToken).populateTransaction.balanceOf(account)
  const auxBalance = await ethers.provider.call(tx)
  return BigNumber.from(auxBalance)
}

async function getTokenBalance (tokenIndex: number, token: TestToken|TetherToken|NonRevertTestToken|NonCompliantTestToken, account: string): Promise<BigNumber> {
  let balance: BigNumber = BigNumber.from(-1)
  switch (tokenIndex) {
    case 0:
      balance = await (token as TestToken).balanceOf(account)
      break
    case 1:
      balance = await getTEtherTokenBalance(token, account)
      break
    case 2:
      balance = await (token as NonRevertTestToken).balanceOf(account)
      break
    case 3:
      balance = await (token as NonCompliantTestToken).balanceOf(account)
      break
  }
  return balance
}

options.forEach(element => {
  tokens.forEach(tokenToUse => {
    describe(`${element.title} using ${tokenToUse.title}`, () => {
      let TestForwarderTarget: TestForwarderTarget__factory
      let TestSmartWallet: TestSmartWallet__factory
      let TestToken: TestToken__factory
      let TetherToken: TetherToken__factory
      let NonRevertTestToken: NonRevertTestToken__factory
      let NonCompliantTestToken: NonCompliantTestToken__factory
      let defaultAccount: string
      let defaultAccountSigner: SignerWithAddress
      let otherAccount: string
      let otherAccountSigner: SignerWithAddress
      let recovererAccount: string
      let recovererAccountSigner: SignerWithAddress
      let payerAccountSigner: SignerWithAddress
      const countParams = ForwardRequestType.length
      const senderPrivateKey = ethers.utils.arrayify(bytes32(1))
      let chainId: number
      let senderAddress: string
      let template: SmartWallet | CustomSmartWallet
      let factory: CustomSmartWalletFactory | SmartWalletFactory
      let token: TestToken | TetherToken | NonRevertTestToken | NonCompliantTestToken
      let sw: SmartWallet | CustomSmartWallet
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
        TestForwarderTarget = await ethers.getContractFactory('TestForwarderTarget') as TestForwarderTarget__factory
        TestToken = await ethers.getContractFactory('TestToken') as TestToken__factory
        TetherToken = await ethers.getContractFactory('TetherToken') as TetherToken__factory
        NonRevertTestToken = await ethers.getContractFactory('NonRevertTestToken') as NonRevertTestToken__factory
        NonCompliantTestToken = await ethers.getContractFactory('NonCompliantTestToken') as NonCompliantTestToken__factory
        TestSmartWallet = await ethers.getContractFactory('TestSmartWallet') as TestSmartWallet__factory
        [defaultAccountSigner, otherAccountSigner, recovererAccountSigner, payerAccountSigner] = await ethers.getSigners()
        defaultAccount = await defaultAccountSigner.getAddress()
        otherAccount = await otherAccountSigner.getAddress()
        recovererAccount = await recovererAccountSigner.getAddress()
        chainId = (await getTestingEnvironment()).chainId
        senderAddress = ethers.utils.computeAddress(senderPrivateKey).toLowerCase()
        request.request.from = senderAddress

        switch (tokenToUse.tokenIndex) {
          case 0:
            token = await TestToken.deploy()
            break
          case 1:
            token = await TetherToken.deploy(1000000000, 'TetherToken', 'USDT', 18)
            break
          case 2:
            token = await NonRevertTestToken.deploy()
            break
          case 3:
            token = await NonCompliantTestToken.deploy()
            break
        }
        await token.deployed()
        request.request.tokenContract = token.address

        if (element.simple) {
          const SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
          template = await SmartWallet.deploy()
          factory = await createSmartWalletFactory(template)
          sw = await createSmartWallet(defaultAccount, senderAddress, factory, senderPrivateKey, chainId)
        } else {
          const CustomSmartWallet = await ethers.getContractFactory('CustomSmartWallet') as CustomSmartWallet__factory
          template = await CustomSmartWallet.deploy()
          factory = await createCustomSmartWalletFactory(template)
          sw = await createCustomSmartWallet(defaultAccount, senderAddress, factory, senderPrivateKey, chainId)
        }
        await template.deployed()
        request.relayData.callForwarder = sw.address
        request.relayData.domainSeparator = getDomainSeparatorHash(sw.address, chainId)
        domainSeparatorHash = request.relayData.domainSeparator
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
            const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))
            const sig = signTypedData_v4(senderPrivateKey, { data: dataToSign })
            await expect(sw.verify(dummyDomainSeparator, suffixData, request.request, sig)).revertedWith('Invalid domain separator')
          })

          it('should fail on wrong nonce', async () => {
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
            const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))
            const sig = signTypedData_v4(senderPrivateKey, { data: dataToSign })

            await expect(sw.verify(domainSeparatorHash, suffixData, req.request, sig)).to.revertedWith('nonce mismatch')
          })
          it('should fail on invalid signature', async () => {
            const dataToSign = new TypedRequestData(
              chainId,
              sw.address,
              request
            )
            const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))

            await expect(sw.verify(domainSeparatorHash, suffixData, request.request, '0x')).to.revertedWith('ECDSA: invalid signature length')
            await expect(sw.verify(domainSeparatorHash, suffixData, request.request, '0x123456')).to.revertedWith('ECDSA: invalid signature length')
            await expect(sw.verify(domainSeparatorHash, suffixData, request.request, '0x' + '1b'.repeat(65))).to.revertedWith('signature mismatch')
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
            const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types).slice((1 + ForwardRequestType.length) * 32))

            await sw.verify(domainSeparatorHash, suffixData, request.request, sig)
          })
        })
      })

      describe('#verifyAndCall', () => {
        let recipient: TestForwarderTarget
        let testfwd: TestSmartWallet
        let worker: string
        let workerSigner: SignerWithAddress

        before(async () => {
          worker = defaultAccount
          workerSigner = defaultAccountSigner
          await fillTokens(tokenToUse.tokenIndex, token, sw.address, '1000')

          recipient = await TestForwarderTarget.deploy()
          await recipient.deployed()
          testfwd = await TestSmartWallet.deploy()
          await testfwd.deployed()
          request.request.tokenAmount = '0'
        })

        it('should return revert message of token payment revert', async () => {
          const func = (await recipient.populateTransaction.testRevert()).data ?? ''
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const initialSWalletTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          const req1 = { ...request }
          req1.request.to = recipient.address
          req1.request.data = func
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = '10000000000'
          req1.request.relayHub = testfwd.address
          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

          const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
          const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32))

          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

          await expect(testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig)).to.revertedWith('Unable to pay for relay')

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          expect(initialWorkerTokenBalance).to.be.eq(tknBalance, 'Worker token balance changed')
          expect(initialSWalletTokenBalance).to.be.eq(swTknBalance, 'Smart Wallet token balance changed')
        })

        it('should call function', async () => {
          const func = (await recipient.populateTransaction.emitMessage('hello')).data ?? ''

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
          const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))
          // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
          // declared in solidity
          await sw.connect(workerSigner).execute(domainSeparatorHash, suffixData, req1.request, sig)

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          const swTknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          expect(tknBalance.sub(initialWorkerTokenBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new worker token balance')
          expect(initialSWalletTokenBalance.sub(swTknBalance)).to.be.equal(BigNumber.from(1), 'Incorrect new smart wallet token balance')

          const event = recipient.filters.TestForwarderMessage(null, null, null)
          const eventEmitted = await recipient.queryFilter(event)

          expect(eventEmitted.length).to.be.eq(1, 'TestRecipient should emit')
          expect(eventEmitted[0].args.origin).to.be.eq(defaultAccount, 'test "from" account is the tx.origin')
          expect(eventEmitted[0].args.msgSender).to.be.eq(sw.address, 'msg.sender must be the smart wallet address')

          expect((await sw.nonce()).toString()).to.be.eq(initialNonce.add(BigNumber.from(1)), 'verifyAndCall should increment nonce')
        })

        it('should return revert message of target revert', async () => {
          const func = (await recipient.populateTransaction.testRevert()).data ?? ''
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = '1'
          req1.request.relayHub = testfwd.address

          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

          const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
          const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32))

          // the helper simply emits the method return values
          await expect(testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig)).to
            .emit(testfwd, 'Result').withArgs(false, 'always fail')
          // assert.equal(ret.logs[0].args.error, 'always fail')
          // assert.equal(ret.logs[0].args.success, false)

          // Payment must have happened regardless of the revert
          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          expect(tknBalance).to.be.equal(initialWorkerTokenBalance.add(BigNumber.from(1)))
        })

        it('should not be able to re-submit after revert (its repeated nonce)', async () => {
          const func = (await recipient.populateTransaction.testRevert()).data ?? ''
          const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)

          const req1 = { ...request }
          req1.request.data = func
          req1.request.to = recipient.address
          req1.request.nonce = (await sw.nonce()).toString()
          req1.request.tokenAmount = '1'
          req1.request.relayHub = testfwd.address

          const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

          const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

          const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
          const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32))

          // the helper simply emits the method return values
          await expect(testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig)).to
            .emit(testfwd, 'Result').withArgs(false, 'always fail')

          const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          expect(tknBalance).to.be.equal(initialWorkerTokenBalance.add(BigNumber.from(1)))

          await expect(testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig)).to.revertedWith('nonce mismatch')

          const tknBalance2 = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
          expect(tknBalance).to.be.equal(tknBalance2)
        })

        describe('value transfer', () => {
          let worker: string
          let workerSigner: SignerWithAddress
          let recipient: TestForwarderTarget
          const tokensPaid = 1

          before(async () => {
            worker = defaultAccount
            workerSigner = defaultAccountSigner
            await fillTokens(tokenToUse.tokenIndex, token, sw.address, '1000')
          })
          beforeEach(async () => {
            recipient = await TestForwarderTarget.deploy()
          })
          afterEach('should not leave funds in the forwarder', async () => {
            expect(await ethers.provider.getBalance(sw.address)).to.be.equal(0)
          })

          it('should fail to forward request if value specified but not provided', async () => {
            const value = ethers.utils.parseEther('1')
            const func = (await recipient.populateTransaction.mustReceiveEth(value)).data ?? ''
            // const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()
            const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)

            const req1 = { ...request }
            req1.request.data = func
            req1.request.to = recipient.address
            req1.request.nonce = (await sw.nonce()).toString()
            req1.request.tokenAmount = '1'
            req1.request.value = value.toString()
            req1.request.relayHub = testfwd.address

            const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)
            const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

            const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
            const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32))

            await testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig, { value: '0' })
            const event = testfwd.filters.Result(null, null)
            const eventEmitted = await testfwd.queryFilter(event)
            expect(eventEmitted[0].args.success).to.be.false

            // Token transfer happens first
            const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
            expect(tknBalance).to.be.equal(initialWorkerTokenBalance.add(BigNumber.from(1)))
          })

          it('should fail to forward request if value specified but not enough not provided', async () => {
            const value = ethers.utils.parseEther('1')
            const func = (await recipient.populateTransaction.mustReceiveEth(value)).data ?? ''
            const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)

            const req1 = { ...request }
            req1.request.data = func
            req1.request.to = recipient.address
            req1.request.nonce = (await sw.nonce()).toString()
            req1.request.tokenAmount = '1'
            req1.request.value = ethers.utils.parseEther('2').toString()
            req1.request.relayHub = testfwd.address

            const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)
            const sig = signTypedData_v4(senderPrivateKey, { data: reqData })
            const suffixData = ethers.utils.hexlify(TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types).slice((1 + countParams) * 32))

            await testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig, { value })
            const event = testfwd.filters.Result(null, null)
            const eventEmitted = await testfwd.queryFilter(event)
            expect(eventEmitted[0].args.success).to.be.false

            // assert.equal(ret.logs[0].args.success, false)
            // Token transfer happens first
            const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
            expect(tknBalance).to.be.equal(initialWorkerTokenBalance.add(BigNumber.from(1)))
          })

          it('should forward request with value', async () => {
            const value = ethers.utils.parseEther('1')
            const func = (await recipient.populateTransaction.mustReceiveEth(value)).data ?? ''
            const initialWorkerTokenBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
            const initialRecipientEtherBalance = await ethers.provider.getBalance(recipient.address)

            const req1 = { ...request }
            req1.request.data = func
            req1.request.to = recipient.address
            req1.request.nonce = (await sw.nonce()).toString()
            req1.request.tokenAmount = '1'
            req1.request.value = value.toString()
            req1.request.relayHub = testfwd.address

            const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

            const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

            const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
            const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32))

            await expect(testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig, { value })).to
              .emit(testfwd, 'Result').withArgs(true, '')
            // assert.equal(ret.logs[0].args.error, '')
            // assert.equal(ret.logs[0].args.success, true)

            expect(await ethers.provider.getBalance(recipient.address)).to.be.equal(BigNumber.from(initialRecipientEtherBalance).add(value))

            const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
            expect(tknBalance).to.be.equal(initialWorkerTokenBalance.add(BigNumber.from(1)))
          })

          it('should forward all funds left in forwarder to "from" address', async () => {
            // The owner of the SmartWallet might have a balance != 0
            const tokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
            const ownerOriginalBalance = await ethers.provider.getBalance(senderAddress)
            const recipientOriginalBalance = await ethers.provider.getBalance(recipient.address)
            const smartWalletBalance = await ethers.provider.getBalance(sw.address)
            expect(smartWalletBalance).to.be.equal(0, 'SmartWallet balance is not zero')

            const value = ethers.utils.parseEther('1')
            const func = (await recipient.populateTransaction.mustReceiveEth(value)).data ?? ''
            const req1 = { ...request }
            req1.request.data = func
            req1.request.to = recipient.address
            req1.request.nonce = (await sw.nonce()).toString()
            req1.request.tokenAmount = tokensPaid.toString()
            req1.request.value = value.toString()
            req1.request.relayHub = testfwd.address

            const reqData: EIP712TypedData = new TypedRequestData(chainId, sw.address, req1)

            const extraFunds = ethers.utils.parseEther('4')
            await defaultAccountSigner.sendTransaction({ to: sw.address, value: extraFunds })

            const sig = signTypedData_v4(senderPrivateKey, { data: reqData })

            const encoded = TypedDataUtils.encodeData(reqData.primaryType, reqData.message, reqData.types)
            const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32))

            // note: not transfering value in TX.
            await expect(testfwd.connect(workerSigner).callExecute(sw.address, req1.request, domainSeparatorHash, suffixData, sig)).to
              .emit(testfwd, 'Result').withArgs(true, '')
            // assert.equal(ret.logs[0].args.error, '')
            // assert.equal(ret.logs[0].args.success, true)

            // Since the tknPayment is paying the recipient, the called contract (recipient) must have the balance of those tokensPaid
            // Ideally it should pay the relayWorker or verifier
            const tknBalance = await getTokenBalance(tokenToUse.tokenIndex, token, worker)
            expect(tokensPaid).to.be.equal(tknBalance.sub(tokenBalanceBefore))

            // The value=1 RBTC of value transfered should now be in the balance of the called contract (recipient)
            const valBalance = await ethers.provider.getBalance(recipient.address)

            expect(value).to.be.equal(valBalance.sub(recipientOriginalBalance))

            // The rest of value (4-1 = 3 RBTC), in possession of the smart wallet, must return to the owner EOA once the execute()
            // is called
            expect(await ethers.provider.getBalance(senderAddress)).to.be.equal(ownerOriginalBalance.add(extraFunds).sub(value))
          })
        })
      })

      describe('#verifyAndCallByOwner', () => {
        let recipient: TestForwarderTarget
        let template: SmartWallet | CustomSmartWallet
        let factory: SmartWalletFactory | CustomSmartWalletFactory
        let sw: SmartWallet | CustomSmartWallet
        const privKey = '0x0c06818f82e04c564290b32ab86b25676731fc34e9a546108bf109194c8e3aae'
        const otherAccountPrivateKey = ethers.utils.arrayify(privKey)
        before(async () => {
          console.log('Running tests using account: ', otherAccount)

          if (element.simple) {
            const SmartWallet: SmartWallet__factory = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
            template = await SmartWallet.deploy()
            await template.deployed()
            factory = await createSmartWalletFactory(template)
            sw = await createSmartWallet(defaultAccount, otherAccount, factory, otherAccountPrivateKey, chainId)
          } else {
            const CustomSmartWallet: CustomSmartWallet__factory = await ethers.getContractFactory('CustomSmartWallet') as CustomSmartWallet__factory
            template = await CustomSmartWallet.deploy()
            await template.deployed()
            factory = await createCustomSmartWalletFactory(template)
            sw = await createCustomSmartWallet(defaultAccount, otherAccount, factory, otherAccountPrivateKey, chainId)
          }

          await fillTokens(tokenToUse.tokenIndex, token, sw.address, '1000')
          recipient = await TestForwarderTarget.deploy()
          await template.deployed()
        })

        it('should call function', async () => {
          const func = (await recipient.populateTransaction.emitMessage('hello')).data ?? ''

          const initialNonce = await sw.nonce()

          await sw.connect(otherAccountSigner).directExecute(recipient.address, func)

          const event = recipient.filters.TestForwarderMessage(null, null, null)
          const eventEmitted = await recipient.queryFilter(event)
          expect(eventEmitted.length).to.be.equal(1, 'TestRecipient should emit')
          expect(eventEmitted[0].args.origin).to.be.equal(otherAccount, 'test "from" account is the tx.origin')
          expect(eventEmitted[0].args.msgSender).to.be.equal(sw.address, 'msg.sender must be the smart wallet address')

          expect(await sw.nonce()).to.be.equal(initialNonce, 'direct execute should NOT increment nonce')
        })

        it('should NOT call function if msg.sender is not the SmartWallet owner', async () => {
          const func = (await recipient.populateTransaction.emitMessage('hello')).data ?? ''
          await expect(sw.connect(defaultAccountSigner).directExecute(recipient.address, func)).to.revertedWith('Not the owner of the SmartWallet')
        })

        it('should return revert message of target revert', async () => {
          const func = (await recipient.populateTransaction.testRevert()).data ?? ''
          await sw.connect(otherAccountSigner).directExecute(recipient.address, func)

          const tx = await sw.connect(otherAccount).populateTransaction.directExecute(recipient.address, func)
          const result = await ethers.provider.call(tx)
          expect(result).to.include(stripHex(encodeRevertReason('always fail').toString()))
          // const revertMessage = result.slice(result.length - 64, result.length)
          // console.log(revertMessage)
          // const reducedBuff = revertMessage.slice(0, 11)
          // const restBuff = revertMessage.slice(11, revertMessage.length)
          // expect(restBuff.readBigInt64BE()).to.be.equal(BigInt(0), 'must be zero')
          // expect(reducedBuff.toString()).to.be.equal('always fail', 'Incorrect revert message received')
        })

        describe('value transfer', () => {
          let recipient: TestForwarderTarget

          beforeEach(async () => {
            const TestForwarderTarget = await ethers.getContractFactory('TestForwarderTarget') as TestForwarderTarget__factory
            recipient = await TestForwarderTarget.deploy()
            await recipient.deployed()
          })
          afterEach('should not leave funds in the forwarder', async () => {
            expect(await ethers.provider.getBalance(sw.address)).to.be.equal(0)
          })

          it('should forward request with value', async () => {
            const value = ethers.utils.parseEther('1')
            const func = (await recipient.populateTransaction.mustReceiveEth(value)).data ?? ''
            const initialRecipientEtherBalance = await ethers.provider.getBalance(recipient.address)
            const initialSenderBalance = await ethers.provider.getBalance(otherAccount)
            const ret = await sw.connect(otherAccountSigner).directExecute(recipient.address, func, { value: value.toString(), gasPrice: value.toString() })
            const gasUsedToCall = BigNumber.from((await ret.wait()).cumulativeGasUsed).mul(BigNumber.from(value.toString())) // Gas price = 1 RBTC
            const finalRecipientEtherBalance = await ethers.provider.getBalance(recipient.address)
            const finalSenderBalance = await ethers.provider.getBalance(otherAccount)
            expect(finalRecipientEtherBalance).to.be.equal(initialRecipientEtherBalance.add(value))
            expect(finalSenderBalance).to.be.equal(initialSenderBalance.sub(value).sub(gasUsedToCall))
          })

          it('should forward all funds left in forwarder to "from" address', async () => {
            // The owner of the SmartWallet might have a balance != 0
            const ownerOriginalBalance = await ethers.provider.getBalance(otherAccount)
            const recipientOriginalBalance = await ethers.provider.getBalance(recipient.address)

            const value = ethers.utils.parseEther('1')
            const func = (await recipient.populateTransaction.mustReceiveEth(value)).data ?? ''

            const extraFunds = ethers.utils.parseEther('4')
            // Put in the smart wallet 4 RBTC
            await defaultAccountSigner.sendTransaction({ to: sw.address, value: extraFunds })

            // note: not transfering value in TX.
            const ret = await sw.connect(otherAccountSigner).directExecute(recipient.address, func, { gasPrice: value.toString(), value: value.toString() })
            const gasUsedToCall = ((await ret.wait()).cumulativeGasUsed).mul(value) // Gas price = 1 RBTC

            // The value=1 RBTC of value transfered should now be in the balance of the called contract (recipient)
            const valBalance = await ethers.provider.getBalance(recipient.address)
            expect(value).to.be.equal(valBalance.sub(recipientOriginalBalance))

            // The rest of value (4-1 = 3 RBTC), in possession of the smart wallet, must return to the owner EOA once the execute()
            // is called
            expect(await ethers.provider.getBalance(otherAccount)).to.be.equal(ownerOriginalBalance.add(extraFunds).sub(value).sub(gasUsedToCall))
          })
        })
      })

      describe('#recover', () => {
        let template: SmartWallet | CustomSmartWallet
        let factory: SmartWalletFactory | CustomSmartWalletFactory
        let sw: SmartWallet | CustomSmartWallet
        const privKey = '0x0c06818f82e04c564290b32ab86b25676731fc34e9a546108bf109194c8e3aae'
        const otherAccountPrivateKey = ethers.utils.arrayify(privKey)

        const tokenToSend = 1000
        before(async () => {
          if (element.simple) {
            const SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
            template = await SmartWallet.deploy()
            await template.deployed()
            factory = await createSmartWalletFactory(template)
            sw = await createSmartWallet(defaultAccount, otherAccount, factory, otherAccountPrivateKey, chainId, constants.ZERO_ADDRESS, '0', '0', recovererAccount)
          } else {
            const CustomSmartWallet = await ethers.getContractFactory('CustomSmartWallet') as CustomSmartWallet__factory
            template = await CustomSmartWallet.deploy()
            await template.deployed()
            factory = await createCustomSmartWalletFactory(template)
            sw = await createCustomSmartWallet(defaultAccount, otherAccount, factory, otherAccountPrivateKey, chainId, constants.ZERO_ADDRESS, '0x',
              constants.ZERO_ADDRESS, '0', '0', recovererAccount)
          }

          await fillTokens(tokenToUse.tokenIndex, token, sw.address, tokenToSend.toString())
        })

        it('should recover wallet funds', async () => {
          const tokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          const balanceBefore = await ethers.provider.getBalance(sw.address)

          const recovererTokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
          const recovererBalanceBefore = await ethers.provider.getBalance(recovererAccount)

          const valueToSend = 1
          const gasPrice = 60000000

          await payerAccountSigner.sendTransaction({ to: sw.address, value: valueToSend, gasPrice })

          const tokenTransferCall = (await token.populateTransaction.transfer(recovererAccount, tokenBalanceBefore)).data ?? ''
          // const tokenTransferCall = web3.eth.abi.encodeFunctionCall({
          //   name: 'transfer',
          //   type: 'function',
          //   inputs: [
          //     {
          //       type: 'address',
          //       name: 'recipient'
          //     }, {
          //       type: 'uint256',
          //       name: 'amount'
          //     }
          //   ]
          // },
          // [recovererAccount, tokenBalanceBefore.toNumber().toString()])
          let txResp
          if (element.simple) {
            txResp = await (sw as SmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, 0, tokenTransferCall, { gasPrice })
          } else {
            txResp = await (sw as CustomSmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, constants.ZERO_ADDRESS, 0, constants.SHA3_NULL_S, tokenTransferCall, { gasPrice })
          }

          const recoverCallCostDirectCalculation = ((await txResp.wait()).cumulativeGasUsed).mul(gasPrice)

          const tokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          const balanceAfter = await ethers.provider.getBalance(sw.address)

          const recovererTokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
          const recovererBalanceAfter = await ethers.provider.getBalance(recovererAccount)

          // native crypto balance transferred to recoverer = balanceBefore + valueToSend
          // recovererBalanceBefore - recoverCost + valueToSend + balanceBefore = recovererBalanceAfter
          // recovererBalanceBefore + valueToSend + balanceBefore - recovererBalanceAfter = recoverCost
          const recoverCallCostIndirectCalculation = recovererBalanceBefore.add(valueToSend).add(balanceBefore).sub(recovererBalanceAfter)
          expect(recoverCallCostDirectCalculation).to.be.equal(recoverCallCostIndirectCalculation, 'Recover cost mismatch')

          expect(tokenBalanceAfter).to.be.equal(0, 'Token balance of the SmartWallet must be 0')
          expect(balanceAfter).to.be.equal('0', 'RBTC Balance of the SmartWallet must be 0')

          // valueToSend + balanceBefore  = recovererBalanceAfter + recoverCost - recovererBalanceBefore
          expect(BigNumber.from(valueToSend).add(balanceBefore)).to.be.equal(recovererBalanceAfter.add(recoverCallCostDirectCalculation).sub(recovererBalanceBefore), 'Recoverer must receive all the RBTC funds of the SmartWallet')

          // The final token balance of the recoverer is its initial token balance plus the token balance of the Smart Wallet before the recover() call
          expect(recovererTokenBalanceAfter).to.be.equal(recovererTokenBalanceBefore.add(tokenBalanceBefore), 'Recoverer must receive all token funds of the SmartWallet')
        })

        it('should fail if sender is not the recoverer', async () => {
          const tokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)

          const recovererTokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
          const recovererBalanceBefore = await ethers.provider.getBalance(recovererAccount)

          const valueToSend = 1

          const gasPrice = 60000000

          await payerAccountSigner.sendTransaction({ to: sw.address, value: valueToSend, gasPrice })
          const balanceAfterValueSendBeforeRecover = await ethers.provider.getBalance(sw.address)

          const tokenTransferCall = (await token.populateTransaction.transfer(recovererAccount, tokenBalanceBefore)).data ?? ''
          // const tokenTransferCall = web3.eth.abi.encodeFunctionCall({
          //   name: 'transfer',
          //   type: 'function',
          //   inputs: [
          //     {
          //       type: 'address',
          //       name: 'recipient'
          //     }, {
          //       type: 'uint256',
          //       name: 'amount'
          //     }
          //   ]
          // },
          // [recovererAccount, tokenBalanceBefore.toNumber().toString()])

          if (element.simple) {
            await expect((sw as SmartWallet).connect(defaultAccountSigner).recover(otherAccount, factory.address, template.address, token.address, 0, tokenTransferCall, { gasPrice })).to.revertedWith('Invalid recoverer')
          } else {
            await expect((sw as CustomSmartWallet).connect(defaultAccountSigner).recover(otherAccount, factory.address, template.address, token.address, constants.ZERO_ADDRESS, 0, constants.SHA3_NULL_S, tokenTransferCall, { gasPrice })).to.revertedWith('Invalid recoverer')
          }

          const tokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          const balanceAfter = await ethers.provider.getBalance(sw.address)

          const recovererTokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
          const recovererBalanceAfter = await ethers.provider.getBalance(recovererAccount)

          expect(tokenBalanceAfter).to.be.equal(tokenBalanceBefore, 'Token balance of the SmartWallet must be the same')
          expect(balanceAfter).to.be.equal(balanceAfterValueSendBeforeRecover, 'RBTC Balance of the SmartWallet must be the same')

          expect(recovererTokenBalanceAfter).to.be.equal(recovererTokenBalanceBefore, 'Token balance of the recoverer must be the same')

          expect(recovererBalanceAfter).to.be.equal(recovererBalanceBefore, 'Recoverer balance must be be the same')
        })

        it('should recover wallet RBTC funds even if destination contract call fails', async () => {
          const tokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          const balanceBefore = await ethers.provider.getBalance(sw.address)

          const recovererTokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
          const recovererBalanceBefore = await ethers.provider.getBalance(recovererAccount)

          const valueToSend = 1
          const gasPrice = 60000000

          await payerAccountSigner.sendTransaction({ to: sw.address, value: valueToSend, gasPrice })
          const balanceAfterValueSendBeforeRecover = await ethers.provider.getBalance(sw.address)

          let txResp

          const tokenTransferCall = (await token.populateTransaction.transfer(recovererAccount, tokenBalanceBefore.add(1))).data ?? ''
          // const tokenTransferCall = web3.eth.abi.encodeFunctionCall({
          //   name: 'transfer',
          //   type: 'function',
          //   inputs: [
          //     {
          //       type: 'address',
          //       name: 'recipient'
          //     }, {
          //       type: 'uint256',
          //       name: 'amount'
          //     }
          //   ]
          // },
          // [recovererAccount, (tokenBalanceBefore.toNumber() + 1).toString()]) // SmartWallet does not have this amount of tokens

          if (tokenToUse.tokenIndex !== 1) {
            if (element.simple) {
              txResp = await (sw as SmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, 0, tokenTransferCall, { gasPrice })
            } else {
              txResp = await (sw as CustomSmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, constants.ZERO_ADDRESS, 0, constants.SHA3_NULL_S, tokenTransferCall, { gasPrice })
            }

            const recoverCallCostDirectCalculation = ((await txResp.wait()).cumulativeGasUsed).mul(gasPrice)

            const tokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
            const balanceAfter = await ethers.provider.getBalance(sw.address)

            const recovererTokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
            const recovererBalanceAfter = await ethers.provider.getBalance(recovererAccount)

            // native crypto balance transferred to recoverer = balanceBefore + valueToSend
            // recovererBalanceBefore - recoverCost + valueToSend + balanceBefore = recovererBalanceAfter
            // recovererBalanceBefore + valueToSend + balanceBefore - recovererBalanceAfter = recoverCost
            const recoverCallCostIndirectCalculation = recovererBalanceBefore.add(valueToSend).add(balanceBefore).sub(recovererBalanceAfter)
            expect(recoverCallCostDirectCalculation).to.be.equal(recoverCallCostIndirectCalculation, 'Recover cost mismatch')

            expect(tokenBalanceAfter).to.be.equal(tokenBalanceBefore, 'Token balance of the SmartWallet must be the same')
            expect(balanceAfter).to.be.equal('0', 'RBTC Balance of the SmartWallet must be 0')

            // valueToSend + balanceBefore  = recovererBalanceAfter + recoverCost - recovererBalanceBefore
            expect(BigNumber.from(valueToSend).add(balanceBefore)).to.be.equal(recovererBalanceAfter.add(recoverCallCostDirectCalculation).sub(recovererBalanceBefore), 'Recoverer must receive all the RBTC funds of the SmartWallet')

            expect(recovererTokenBalanceAfter.toNumber()).to.be.equal(recovererTokenBalanceBefore, 'Recoverer token balance must be the same')
          } else { // Tether token depletes the gas on error (it uses 'assert' instead of 'require'), so in this case the whole transaction will revert
            const maxGasLimit = 100000
            if (element.simple) {
              await expect((sw as SmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, 0, tokenTransferCall, { gasPrice, gasLimit: maxGasLimit })).to.reverted
            } else {
              await expect((sw as CustomSmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, constants.ZERO_ADDRESS, 0, constants.SHA3_NULL_S, tokenTransferCall, { gasPrice, gasLimit: maxGasLimit })).to.reverted
            }

            const balanceLost = BigNumber.from(maxGasLimit).mul(gasPrice)
            const tokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
            const balanceAfter = await ethers.provider.getBalance(sw.address)

            const recovererTokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
            const recovererBalanceAfter = await ethers.provider.getBalance(recovererAccount)

            expect(tokenBalanceAfter).to.be.equal(tokenBalanceBefore, 'Token balance of the SmartWallet must be the same')
            expect(balanceAfter).to.be.equal(balanceAfterValueSendBeforeRecover, 'RBTC Balance of the SmartWallet must be the same')

            expect(recovererTokenBalanceAfter).to.be.equal(recovererTokenBalanceBefore, 'Token balance of the recoverer must be the same')

            expect(recovererBalanceAfter).to.be.equal(recovererBalanceBefore.sub(balanceLost), 'Recoverer balance must be less due to the lost gas')
          }
        })
        it('should recover wallet RBTC funds even if destination contract call fails - 2', async () => {
          const tokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
          const balanceBefore = await ethers.provider.getBalance(sw.address)

          const recovererTokenBalanceBefore = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
          const recovererBalanceBefore = await ethers.provider.getBalance(recovererAccount)

          const valueToSend = 1
          const gasPrice = 60000000

          await payerAccountSigner.sendTransaction({ to: sw.address, value: valueToSend, gasPrice })
          const balanceAfterValueSendBeforeRecover = await ethers.provider.getBalance(sw.address)

          let txResp
          const tokenTransferCall = (await token.populateTransaction.transfer(recovererAccount, tokenBalanceBefore.add(1))).data ?? ''
          // const tokenTransferCall = web3.eth.abi.encodeFunctionCall({
          //   name: 'transfer',
          //   type: 'function',
          //   inputs: [
          //     {
          //       type: 'address',
          //       name: 'recipient'
          //     }, {
          //       type: 'uint256',
          //       name: 'amount'
          //     }
          //   ]
          // },
          // [constants.ZERO_ADDRESS, (tokenBalanceBefore.toNumber() + 1).toString()]) // SmartWallet does not have this amount of tokens, and recipient is address(0) so OZ ERC20 will also revert

          if (tokenToUse.tokenIndex !== 1) {
            if (element.simple) {
              txResp = await (sw as SmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, 0, tokenTransferCall, { gasPrice })
            } else {
              txResp = await (sw as CustomSmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, constants.ZERO_ADDRESS, 0, constants.SHA3_NULL_S, tokenTransferCall, { gasPrice })
            }

            const recoverCallCostDirectCalculation = (await txResp.wait()).cumulativeGasUsed.mul(gasPrice)

            const tokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
            const balanceAfter = await ethers.provider.getBalance(sw.address)

            const recovererTokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
            const recovererBalanceAfter = await ethers.provider.getBalance(recovererAccount)

            // native crypto balance transferred to recoverer = balanceBefore + valueToSend
            // recovererBalanceBefore - recoverCost + valueToSend + balanceBefore = recovererBalanceAfter
            // recovererBalanceBefore + valueToSend + balanceBefore - recovererBalanceAfter = recoverCost
            const recoverCallCostIndirectCalculation = recovererBalanceBefore.add(valueToSend).add(balanceBefore).sub(recovererBalanceAfter)
            expect(recoverCallCostDirectCalculation).to.be.equal(recoverCallCostIndirectCalculation, 'Recover cost mismatch')

            expect(tokenBalanceAfter).to.be.equal(tokenBalanceBefore, 'Token balance of the SmartWallet must be the same')
            expect(balanceAfter).to.be.equal(0, 'RBTC Balance of the SmartWallet must be 0')

            // valueToSend + balanceBefore  = recovererBalanceAfter + recoverCost - recovererBalanceBefore
            expect(BigNumber.from(valueToSend).add(balanceBefore)).to.be.equal(recovererBalanceAfter.add(recoverCallCostDirectCalculation).sub(recovererBalanceBefore), 'Recoverer must receive all the RBTC funds of the SmartWallet')

            expect(recovererTokenBalanceAfter).to.be.equal(recovererTokenBalanceBefore, 'Recoverer token balance must be the same')
          } else { // Tether token depletes the gas on error (it uses 'assert' instead of 'require'), so in this case the whole transaction will revert
            const maxGasLimit = 100000
            if (element.simple) {
              await expect((sw as SmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, 0, tokenTransferCall, { gasPrice, gasLimit: maxGasLimit })).to.reverted
            } else {
              await expect((sw as CustomSmartWallet).connect(recovererAccountSigner).recover(otherAccount, factory.address, template.address, token.address, constants.ZERO_ADDRESS, 0, constants.SHA3_NULL_S, tokenTransferCall, { gasPrice, gasLimit: maxGasLimit })).to.reverted
            }

            const balanceLost = BigNumber.from(maxGasLimit).mul(gasPrice)
            const tokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, sw.address)
            const balanceAfter = await ethers.provider.getBalance(sw.address)

            const recovererTokenBalanceAfter = await getTokenBalance(tokenToUse.tokenIndex, token, recovererAccount)
            const recovererBalanceAfter = await ethers.provider.getBalance(recovererAccount)

            expect(tokenBalanceAfter).to.be.equal(tokenBalanceBefore, 'Token balance of the SmartWallet must be the same')
            expect(balanceAfter).to.be.equal(balanceAfterValueSendBeforeRecover, 'RBTC Balance of the SmartWallet must be the same')

            expect(recovererTokenBalanceAfter).to.be.equal(recovererTokenBalanceBefore, 'Token balance of the recoverer must be the same')

            expect(recovererBalanceAfter).to.be.equal(recovererBalanceBefore.sub(balanceLost), 'Recoverer balance must be less due to the lost gas')
          }
        })
      })
    })
  })
})

/* eslint-disable @typescript-eslint/require-await */
// This rule seems to be flickering and buggy - does not understand async arrow functions correctly
import { balance, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'

import { Transaction, TransactionOptions } from 'ethereumjs-tx'
import { privateToAddress, stripZeros, toBuffer } from 'ethereumjs-util'
import { encode } from 'rlp'
import { expect } from 'chai'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getLocalEip712Signature } from '../src/common/Utils'
import TypedRequestData, { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { isRsk, Environment } from '../src/common/Environments'
import {
  PenalizerInstance,
  RelayHubInstance, StakeManagerInstance,
  TestVerifierEverythingAcceptedInstance,
  TestRecipientInstance,
  SmartWalletInstance,
  ProxyFactoryInstance
} from '../types/truffle-contracts'

import { deployHub, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { getRawTxOptions } from '../src/relayclient/ContractInteractor'

import TransactionResponse = Truffle.TransactionResponse

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const SmartWallet = artifacts.require('SmartWallet')
const clientId = '0'

contract('RelayHub Penalizations', function ([_, relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker, reporterRelayManager]) { // eslint-disable-line no-unused-vars
  // const chainId = defaultEnvironment.chainId

  let stakeManager: StakeManagerInstance
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let verifier: TestVerifierEverythingAcceptedInstance
  let env: Environment
  let transactionOptions: TransactionOptions
  let forwarder: string
  let smartWallet: SmartWalletInstance
  let gaslessAccount: AccountKeypair
  // TODO: 'before' is a bad thing in general. Use 'beforeEach', this tests all depend on each other!!!

  async function prepareRelayCall (): Promise<{
    gasPrice: BN
    gasLimit: BN
    relayRequest: RelayRequest
    signature: string
  } > {
    const env: Environment = await getTestingEnvironment()
    const chainId: number = env.chainId

    const gasPrice = new BN('1')
    const gasLimit = new BN('5000000')
    const txData = recipient.contract.methods.emitMessage('').encodeABI()

    const relayRequest: RelayRequest = {
      request: {
        to: recipient.address,
        data: txData,
        from: gaslessAccount.address,
        nonce: (await smartWallet.nonce()).toString(),
        value: '0',
        gas: gasLimit.toString(),
        tokenRecipient: constants.ZERO_ADDRESS,
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '0',
        recoverer: constants.ZERO_ADDRESS,
        index: '0'
      },
      relayData: {
        gasPrice: gasPrice.toString(),
        relayWorker,
        callForwarder: forwarder,
        callVerifier: verifier.address,
        domainSeparator: getDomainSeparatorHash(forwarder, chainId),
        isSmartWalletDeploy: false,
        clientId
      }
    }
    const dataToSign = new TypedRequestData(
      chainId,
      forwarder,
      relayRequest
    )
    const signature = getLocalEip712Signature(
      dataToSign,
      gaslessAccount.privateKey
    )
    return {
      gasPrice,
      gasLimit,
      relayRequest,
      signature
    }
  }

  // Receives a function that will penalize the relay and tests that call for a penalization, including checking the
  // emitted event and penalization reward transfer. Returns the transaction receipt.
  async function expectPenalization (penalizeWithOpts: (opts: Truffle.TransactionDetails) => Promise<TransactionResponse>, rskDifference: number = 0): Promise<TransactionResponse> {
    const reporterBalanceTracker = await balance.tracker(reporterRelayManager)
    const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)
    const stakeInfo = await stakeManager.stakes(relayManager)
    // @ts-ignore (names)
    const stake = stakeInfo.stake
    const expectedReward = stake.divn(2)

    // A gas price of zero makes checking the balance difference simpler
    // RSK: Setting gasPrice to 1 since the RSKJ node doesn't support transactions with a gas price lower than 0.06 gwei
    const receipt = await penalizeWithOpts({
      from: reporterRelayManager,
      gasPrice: 1
    })

    expectEvent.inLogs(receipt.logs, 'StakePenalized', {
      relayManager: relayManager,
      beneficiary: reporterRelayManager,
      reward: expectedReward
    })

    const delta = (await reporterBalanceTracker.delta())
    const halfStake = stake.divn(2)
    const difference = halfStake.sub(delta)

    // The reporter gets half of the stake
    // expect(delta).to.be.bignumber.aproximately(halfStake)

    // Since RSKJ doesn't support a transaction gas price below 0.06 gwei we need to change the assert
    expect(difference).to.be.bignumber.at.most(new BN(rskDifference))

    // The other half is burned, so RelayHub's balance is decreased by the full stake
    expect(await stakeManagerBalanceTracker.delta()).to.be.bignumber.equals(stake.neg())

    return receipt
  }

  describe('penalizations', function () {
    const stake = ether('1')

    before(async function () {
      gaslessAccount = await getGaslessAccount()

      for (const addr of [relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker]) {
        console.log(addr)
      }

      stakeManager = await StakeManager.new()
      penalizer = await Penalizer.new()
      relayHub = await deployHub(stakeManager.address, penalizer.address)
      env = await getTestingEnvironment()
      const networkId = await web3.eth.net.getId()
      const chain = await web3.eth.net.getNetworkType()
      transactionOptions = getRawTxOptions(env.chainId, networkId, chain)

      const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
      smartWallet = await createSmartWallet(gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)
      forwarder = smartWallet.address

      recipient = await TestRecipient.new()

      verifier = await TestVerifierEverythingAccepted.new()
      await stakeManager.stakeForAddress(relayManager, 1000, {
        from: relayOwner,
        value: ether('1'),
        gasPrice: '1'
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner, gasPrice: '1' })
      await relayHub.addRelayWorkers([relayWorker], { from: relayManager, gasPrice: '1' })
      // @ts-ignore
      Object.keys(StakeManager.events).forEach(function (topic) {
        // @ts-ignore
        RelayHub.network.events[topic] = StakeManager.events[topic]
      })
      // @ts-ignore
      Object.keys(StakeManager.events).forEach(function (topic) {
        // @ts-ignore
        Penalizer.network.events[topic] = StakeManager.events[topic]
      })

      await stakeManager.stakeForAddress(reporterRelayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(reporterRelayManager, relayHub.address, { from: relayOwner })
    })

    describe('penalization access control (relay manager only)', function () {
      before(async function () {
        const env: Environment = await getTestingEnvironment()
        const receipt: any = await web3.eth.sendTransaction({ from: thirdRelayWorker, to: other, value: ether('0.5'), gasPrice: '1' })
        const transactionHash = receipt.transactionHash;

        ({
          data: penalizableTxData,
          signature: penalizableTxSignature
        } = await getDataAndSignatureFromHash(transactionHash, env))
      })

      let penalizableTxData: string
      let penalizableTxSignature: string

      it('penalizeIllegalTransaction', async function () {
        await expectRevert.unspecified(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, { from: other }),
          'Unknown relay manager'
        )
      })
      it('penalizeRepeatedNonce', async function () {
        await expectRevert.unspecified(
          penalizer.penalizeRepeatedNonce(penalizableTxData, penalizableTxSignature, penalizableTxData, penalizableTxSignature, relayHub.address, { from: other }),
          'Unknown relay manager'
        )
      })
    })

    describe('penalizable behaviors', function () {
      const encodedCallArgs = {
        sender: '',
        recipient: '0x1820b744B33945482C17Dc37218C01D858EBc714',
        data: '0x1234',
        baseFee: 1000,
        fee: 10,
        gasPrice: 50,
        gasLimit: 1000000,
        nonce: 0,
        callVerifier: constants.ZERO_ADDRESS
      }

      // RSK requires a different relay's private key, original was '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c'
      const relayCallArgs = {
        gasPrice: 50,
        gasLimit: 1000000,
        nonce: 0,
        privateKey: '88fcad7d65de4bf854b88191df9bf38648545e7e5ea367dff6e025b06a28244d' // RSK relay's private key
      }

      before(async function () {
        encodedCallArgs.sender = gaslessAccount.address
        // Pablo: This is not passing in RSK. Looks like the account's
        // private key is not what's defined in relayCallArgs.privateKey
        // in the RSK case.
        // @ts-ignore
        expect('0x' + privateToAddress('0x' + relayCallArgs.privateKey).toString('hex')).to.equal(relayWorker.toLowerCase())
        // TODO: I don't want to refactor everything here, but this value is not available before 'before' is run :-(
        encodedCallArgs.callVerifier = verifier.address
      })

      beforeEach('staking for relay', async function () {
        await stakeManager.stakeForAddress(relayManager, 1000, {
          value: stake,
          from: relayOwner,
          gasPrice: '1'
        })
        await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner, gasPrice: '1' })
      })

      describe('repeated relay nonce', function () {
        it('penalizes transactions with same nonce and different data', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId

          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs, chainId, env), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(Object.assign({}, encodedCallArgs, { data: '0xabcd' }), relayCallArgs, chainId, env), chainId)

          const rskDifference: number = isRsk(env) ? 200000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('penalizes transactions with same nonce and different gas limit', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId

          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs, chainId, env), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { gasLimit: 100 }), chainId, env), chainId)

          const rskDifference: number = isRsk(env) ? 150000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('penalizes transactions with same nonce and different value', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId

          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs, chainId, env), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { value: 100 }), chainId, env), chainId)

          const rskDifference: number = isRsk(env) ? 150000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('does not penalize transactions with same nonce and data, value, gasLimit, destination', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId

          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs, chainId, env), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs, Object.assign({}, relayCallArgs, { gasPrice: 70 }), chainId, env), chainId) // only gasPrice may be different

          await expectRevert.unspecified(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'tx is equal'
          )
        })

        it('does not penalize transactions with different nonces', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId

          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs, chainId, env), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs, Object.assign({}, relayCallArgs, { nonce: 1 }), chainId, env), chainId)

          await expectRevert.unspecified(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'Different nonce'
          )
        })

        it('does not penalize transactions with same nonce from different relays', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId

          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs, chainId, env), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { privateKey: '0123456789012345678901234567890123456789012345678901234567890123' }), chainId, env), chainId)

          await expectRevert.unspecified(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'Different signer'
          )
        })
      })

      describe('illegal call', function () {
        it('does not penalize legal relay transactions', async function () {
          const env: Environment = await getTestingEnvironment()

          // relayCall is a legal transaction
          const { gasPrice, gasLimit, relayRequest, signature } = await prepareRelayCall()

          const relayCallTx = await relayHub.relayCall(relayRequest, signature, {
            from: relayWorker,
            gas: gasLimit.add(new BN(1e6)),
            gasPrice
          })

          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, env)
          await expectRevert.unspecified(
            penalizer.penalizeIllegalTransaction(relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address, { from: reporterRelayManager, gasPrice: 1 }),
            'Legal relay transaction'
          )
        })

        // TODO: this tests are excessive, and have a lot of tedious build-up
        it('penalizes relay transactions to addresses other than RelayHub', async function () {
          const env: Environment = await getTestingEnvironment()

          // Relay sending ether to another account
          // const { transactionHash } = await send.ether(relayWorker, other, ether('0.5'))
          const receipt: any = await web3.eth.sendTransaction({ from: relayWorker, to: other, value: ether('0.5'), gasPrice: '1' })
          const transactionHash = receipt.transactionHash
          const { data, signature } = await getDataAndSignatureFromHash(transactionHash, env)

          const rskDifference: number = isRsk(env) ? 100000 : 0

          await expectPenalization(async (opts) => await penalizer.penalizeIllegalTransaction(data, signature, relayHub.address, opts), rskDifference)
        })

        it('penalizes relay worker transactions to illegal RelayHub functions (stake)', async function () {
          const env: Environment = await getTestingEnvironment()

          // Relay staking for a second relay
          const { tx } = await stakeManager.stakeForAddress(other, 1000, {
            value: ether('1'),
            from: relayWorker,
            gasPrice: '1'
          })
          const { data, signature } = await getDataAndSignatureFromHash(tx, env)

          const rskDifference: number = isRsk(env) ? 100000 : 0

          await expectPenalization(async (opts) => await penalizer.penalizeIllegalTransaction(data, signature, relayHub.address, opts), rskDifference)
        })

        // External Gas limit was removed from relayCall
        it.skip('should penalize relays for lying about transaction gas limit RelayHub', async function () {
          const env: Environment = await getTestingEnvironment()

          const { gasPrice, gasLimit, relayRequest, signature } = await prepareRelayCall()

          const relayCallTx = await relayHub.relayCall(relayRequest, signature, {
            from: relayWorker,
            gas: gasLimit.add(new BN(1e6)),
            gasPrice
          })

          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, env)

          const rskDifference: number = isRsk(env) ? 105000 : 0

          await expectPenalization(
            async (opts) => await penalizer.penalizeIllegalTransaction(relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address, opts), rskDifference
          )
        })
      })
    })

    describe('penalizable relay states', function () {
      context('with penalizable transaction', function () {
        let penalizableTxData: string
        let penalizableTxSignature: string

        beforeEach(async function () {
          const env: Environment = await getTestingEnvironment()

          // Relays are not allowed to transfer Ether
          // const { transactionHash } = await send.ether(thirdRelayWorker, other, ether('0.5'));
          const receipt: any = await web3.eth.sendTransaction({ from: thirdRelayWorker, to: other, value: ether('0.5'), gasPrice: '1' })
          const transactionHash = receipt.transactionHash;

          ({
            data: penalizableTxData,
            signature: penalizableTxSignature
          } = await getDataAndSignatureFromHash(transactionHash, env))
        })

        // All of these tests use the same penalization function (we one we set up in the beforeEach block)
        async function penalize (rskDifference: number = 0): Promise<TransactionResponse> {
          return await expectPenalization(async (opts) => await penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, opts), rskDifference)
        }

        context('with not owned relay worker', function () {
          it('account cannot be penalized', async function () {
            await expectRevert.unspecified(penalize(), 'Unknown relay worker')
          })
        })

        context('with staked and locked relay manager and ', function () {
          beforeEach(async function () {
            await stakeManager.stakeForAddress(relayManager, 1000, {
              from: relayOwner,
              value: ether('1'),
              gasPrice: '1'
            })
            await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner, gasPrice: '1' })
            await relayHub.addRelayWorkers([thirdRelayWorker], { from: relayManager, gasPrice: '1' })
          })

          // TODO enable these tests
          it.skip('relay can be penalized', async function () {
            await penalize()
          })

          it('relay cannot be penalized twice', async function () {
            const env: Environment = await getTestingEnvironment()

            const rskDifference: number = isRsk(env) ? 100000 : 0

            await penalize(rskDifference)
            await expectRevert.unspecified(penalize(), 'relay manager not staked')
          })
        })
      })
    })

    function encodeRelayCallEIP155 (encodedCallArgs: any, relayCallArgs: any, chainId: number, env: Environment): Transaction {
      const privateKey = Buffer.from(relayCallArgs.privateKey, 'hex')
      const relayWorker = '0x' + privateToAddress(privateKey).toString('hex')
      // TODO: 'encodedCallArgs' is no longer needed. just keep the RelayRequest in test
      const relayRequest: RelayRequest =
        {
          request: {
            to: encodedCallArgs.recipient,
            data: encodedCallArgs.data,
            from: encodedCallArgs.sender,
            nonce: encodedCallArgs.nonce.toString(),
            value: '0',
            gas: encodedCallArgs.gasLimit.toString(),
            tokenRecipient: constants.ZERO_ADDRESS,
            tokenContract: constants.ZERO_ADDRESS,
            tokenAmount: '0',
            recoverer: constants.ZERO_ADDRESS,
            index: '0'
          },
          relayData: {
            gasPrice: encodedCallArgs.gasPrice.toString(),
            relayWorker,
            isSmartWalletDeploy: false,
            domainSeparator: getDomainSeparatorHash(forwarder, env.chainId),
            callForwarder: forwarder,
            callVerifier: encodedCallArgs.callVerifier,
            clientId
          }
        }
      const encodedCall = relayHub.contract.methods.relayCall(relayRequest, '0xabcdef123456').encodeABI()

      const transaction = new Transaction({
        nonce: relayCallArgs.nonce,
        gasLimit: relayCallArgs.gasLimit,
        gasPrice: relayCallArgs.gasPrice,
        to: relayHub.address,
        value: relayCallArgs.value,
        data: encodedCall
      }, transactionOptions)

      transaction.sign(Buffer.from(relayCallArgs.privateKey, 'hex'))
      return transaction
    }

    async function getDataAndSignatureFromHash (txHash: string, env: Environment): Promise<{ data: string, signature: string }> {
      // @ts-ignore
      const rpcTx = await web3.eth.getTransaction(txHash)
      // eslint: this is stupid how many checks for 0 there are
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!env.chainId && parseInt(rpcTx.v, 16) > 28) {
        throw new Error('Missing ChainID for EIP-155 signature')
      }
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (env.chainId && !isRsk(env) && parseInt(rpcTx.v, 16) <= 28) {
        throw new Error('Passed ChainID for non-EIP-155 signature')
      }
      // @ts-ignore
      const tx = new Transaction({
        nonce: new BN(rpcTx.nonce),
        gasPrice: new BN(rpcTx.gasPrice),
        gasLimit: new BN(rpcTx.gas),
        to: rpcTx.to,
        value: new BN(rpcTx.value),
        data: rpcTx.input,
        // @ts-ignore
        v: rpcTx.v,
        // @ts-ignore
        r: rpcTx.r,
        // @ts-ignore
        s: rpcTx.s
      }, transactionOptions)

      return getDataAndSignature(tx, env.chainId)
    }

    function getDataAndSignature (tx: Transaction, chainId: number): { data: string, signature: string } {
      const input = [tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (chainId) {
        input.push(
          toBuffer(chainId),
          stripZeros(toBuffer(0)),
          stripZeros(toBuffer(0))
        )
      }
      let v = parseInt(tx.v.toString('hex'), 16)
      if (v > 28) {
        v -= chainId * 2 + 8
      }
      const data = `0x${encode(input).toString('hex')}`
      const signature = `0x${'00'.repeat(32 - tx.r.length) + tx.r.toString('hex')}${'00'.repeat(
        32 - tx.s.length) + tx.s.toString('hex')}${v.toString(16)}`
      return {
        data,
        signature
      }
    }
  })
})

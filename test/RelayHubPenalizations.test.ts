/* eslint-disable @typescript-eslint/require-await */
// This rule seems to be flickering and buggy - does not understand async arrow functions correctly
import { balance, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'

import { Transaction, TransactionOptions } from 'ethereumjs-tx'
import { privateToAddress, stripZeros, toBuffer } from 'ethereumjs-util'
import { encode } from 'rlp'
import { expect } from 'chai'

import { cloneRelayRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { isRsk, Environment } from '../src/common/Environments'
import {
  PenalizerInstance,
  RelayHubInstance,
  SmartWalletInstance,
  SmartWalletFactoryInstance
} from '../types/truffle-contracts'

import { deployHub, getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { getRawTxOptions } from '../src/common/ContractInteractor'

import TransactionResponse = Truffle.TransactionResponse

const RelayHub = artifacts.require('RelayHub')
const Penalizer = artifacts.require('Penalizer')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const SmartWallet = artifacts.require('SmartWallet')

const RANDOM_TX_SIGNATURE = '0x74be69218f14e914f53573644b4b0efe304f5e5d7e215642a9b6f34de09486f9601f0f34320acbd448bd051831df36b43d54be30b01e61930875ab2b6d4ada391b'

contract('RelayHub Penalizations', function ([defaultAccount, relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker, reporterRelayManager]) { // eslint-disable-line no-unused-vars
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let env: Environment
  let transactionOptions: TransactionOptions

  const relayRequest: RelayRequest =
  {
    request: {
      relayHub: constants.ZERO_ADDRESS,
      to: '0x1820b744B33945482C17Dc37218C01D858EBc714',
      data: '0x1234',
      from: constants.ZERO_ADDRESS,
      nonce: '0',
      value: '0',
      gas: '1000000',
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '0',
      tokenGas: '0'
    },
    relayData: {
      gasPrice: '50',
      relayWorker,
      domainSeparator: '',
      callForwarder: constants.ZERO_ADDRESS,
      callVerifier: constants.ZERO_ADDRESS
    }
  }

  // RSK requires a different relay's private key, original was '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c'
  const relayCallArgs = {
    gasPrice: 50,
    gasLimit: 1000000,
    nonce: 0,
    privateKey: '88fcad7d65de4bf854b88191df9bf38648545e7e5ea367dff6e025b06a28244d' // RSK relay's private key
  }

  describe('penalizations', function () {
    const stake = ether('1')

    before(async function () {
      for (const addr of [relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker]) {
        console.log(addr)
      }

      penalizer = await Penalizer.new()
      relayHub = await deployHub(penalizer.address)
      env = await getTestingEnvironment()
      const networkId = await web3.eth.net.getId()
      const chain = await web3.eth.net.getNetworkType()
      transactionOptions = getRawTxOptions(env.chainId, networkId, chain)

      await relayHub.stakeForAddress(relayManager, 1000, {
        from: relayOwner,
        value: ether('1'),
        gasPrice: '1'
      })

      await relayHub.addRelayWorkers([relayWorker], { from: relayManager, gasPrice: '1' })
      // @ts-ignore
      Object.keys(RelayHub.events).forEach(function (topic) {
        // @ts-ignore
        RelayHub.network.events[topic] = RelayHub.events[topic]
      })
      // @ts-ignore
      Object.keys(RelayHub.events).forEach(function (topic) {
        // @ts-ignore
        Penalizer.network.events[topic] = RelayHub.events[topic]
      })

      await relayHub.stakeForAddress(reporterRelayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })
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

      it('penalizeRepeatedNonce', async function () {
        await expectRevert(
          penalizer.penalizeRepeatedNonce(penalizableTxData, penalizableTxSignature, penalizableTxData, penalizableTxSignature, relayHub.address, { from: other }),
          'Unknown relay manager'
        )
      })
    })

    describe('penalization access control (relay hub only)', function () {
      it('revert with unknown relay hub message', async () => {
        await expectRevert(
          penalizer.fulfill(RANDOM_TX_SIGNATURE),
          'Unknown relay hub'
        )
      })
    })

    describe('penalizable behaviors', function () {
      describe('repeated relay nonce', function () {
        beforeEach('staking for relay', async function () {
          await relayHub.stakeForAddress(relayManager, 1000, {
            value: stake,
            from: relayOwner,
            gasPrice: '1'
          })
        })

        it('penalizes transactions with same nonce and different data', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)

          relayRequest.request.data = '0xabcd'

          const txDataSigB = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)

          const rskDifference: number = isRsk(env) ? 210000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('penalizes transactions with same nonce and different gas limit', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { gasLimit: 100 }), chainId, env)

          const rskDifference: number = isRsk(env) ? 185000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('penalizes transactions with same nonce and different value', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { value: 100 }), chainId, env)

          const rskDifference: number = isRsk(env) ? 185000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('does not penalize transactions with same nonce and data, value, gasLimit, destination', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { gasPrice: 70 }), chainId, env) // only gasPrice may be different

          await expectRevert(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'tx is equal'
          )
        })

        it('does not penalize transactions with different nonces', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { nonce: 1 }), chainId, env)

          await expectRevert(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'Different nonce'
          )
        })

        it('does not penalize transactions with same nonce from different relays', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const privateKey: string = '0123456789012345678901234567890123456789012345678901234567890123'
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { privateKey: privateKey }), chainId, env)

          await expectRevert(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'Different signer'
          )
        })

        it('does not penalize with the same pair of transactions twice', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { value: 100 }), chainId, env)

          const rskDifference: number = isRsk(env) ? 185000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )

          // stake relayer again to attempt to penalize again with the same set of transactions. It must fail.
          await relayHub.stakeForAddress(relayManager, 1000, {
            from: relayOwner,
            value: ether('1'),
            gasPrice: '1'
          })

          await expectRevert(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'Transactions already penalized'
          )

          // attempt to penalize with one of the previous transactions a new one. It must succeed
          const txDataSigC = getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { value: 200 }), chainId, env)

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigC.data, txDataSigC.signature, relayHub.address, opts), rskDifference
          )
        })
      })
    })

    function encodeRelayCallEIP155 (relayRequest: RelayRequest, relayCallArgs: any): Transaction {
      const privateKey = Buffer.from(relayCallArgs.privateKey, 'hex')
      const relayWorker = '0x' + privateToAddress(privateKey).toString('hex')

      relayRequest.relayData.relayWorker = relayWorker

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

      return getDataAndSignatureFromTx(tx, env.chainId)
    }

    function getDataAndSignature (relayRequest: RelayRequest, relayCallArgs: any, chainId: number, env: Environment): { data: string, signature: string } {
      const tx = encodeRelayCallEIP155(relayRequest, relayCallArgs)
      return getDataAndSignatureFromTx(tx, chainId)
    }

    function getDataAndSignatureFromTx (tx: Transaction, chainId: number): { data: string, signature: string } {
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

    async function createRelayRequest (): Promise<RelayRequest> {
      const smartWallet = await getSmartWalletAddress()
      const verifier = await TestVerifierEverythingAccepted.new()

      const r: RelayRequest = cloneRelayRequest(relayRequest)
      r.request.from = smartWallet.address
      r.request.relayHub = relayHub.address
      r.relayData.callForwarder = smartWallet.address
      r.relayData.callVerifier = verifier.address
      r.relayData.domainSeparator = getDomainSeparatorHash(smartWallet.address, env.chainId)

      return r
    }

    async function getSmartWalletAddress (): Promise<SmartWalletInstance> {
      const gaslessAccount: AccountKeypair = await getGaslessAccount()

      const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
      const factory: SmartWalletFactoryInstance = await createSmartWalletFactory(smartWalletTemplate)
      const smartWallet: SmartWalletInstance = await createSmartWallet(defaultAccount, gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)

      return smartWallet
    }
  })

  // Receives a function that will penalize the relay and tests that call for a penalization, including checking the
  // emitted event and penalization reward transfer. Returns the transaction receipt.
  async function expectPenalization (penalizeWithOpts: (opts: Truffle.TransactionDetails) => Promise<TransactionResponse>, rskDifference: number = 0): Promise<TransactionResponse> {
    const reporterBalanceTracker = await balance.tracker(reporterRelayManager)
    const stakeBalanceTracker = await balance.tracker(relayHub.address)
    const stakeInfo = await relayHub.stakes(relayManager)
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
    expect(await stakeBalanceTracker.delta()).to.be.bignumber.equals(stake.neg())

    return receipt
  }
})

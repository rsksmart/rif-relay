import BN from 'bn.js'
import { ether, expectEvent } from '@openzeppelin/test-helpers'

import { calculateTransactionMaxPossibleGas, getLocalEip712Signature } from '../src/common/Utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import { defaultEnvironment, isRsk, Environment } from '../src/common/Environments'
import RelayRequest, { cloneRelayRequest } from '../src/common/EIP712/RelayRequest'

import {
  RelayHubInstance,
  TestPaymasterVariableGasLimitsInstance,
  StakeManagerInstance,
  IForwarderInstance,
  PenalizerInstance,
  SmartWalletInstance,
  ProxyFactoryInstance,
  TestTokenRecipientInstance,
  TestRecipientInstance
} from '../types/truffle-contracts'
import { deployHub, createProxyFactory, createSmartWallet, getTestingEnvironment, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'

const SmartWallet = artifacts.require('SmartWallet')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestTokenRecipient = artifacts.require('TestTokenRecipient')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterVariableGasLimits = artifacts.require('TestPaymasterVariableGasLimits')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

contract('RelayHub gas calculations', function ([_, relayOwner, relayWorker, relayManager, senderAddress, other]) {
  const unstakeDelay = 1000
  const baseFee = new BN('300')
  const fee = new BN('10')
  const gasPrice = new BN('10')
  const gasLimit = new BN('1000000')
  const externalGasLimit = 5e6.toString()
  const paymasterData = '0x'
  const clientId = '1'

  const senderNonce = new BN('0')
  const magicNumbers = {
    istanbul: {
      pre: 5451,
      post: 1644
    },
    rsk: {
      pre: 831,
      post: 1010
    }
  }

  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let tokenRecipient: TestTokenRecipientInstance
  let recipient: TestRecipientInstance
  let paymaster: TestPaymasterVariableGasLimitsInstance
  let forwarderInstance: IForwarderInstance
  let encodedFunction
  let signature: string
  let relayRequest: RelayRequest
  let forwarder: string

  let chainId: number
  let env: Environment

  let gaslessAccount: AccountKeypair

  beforeEach(async function prepareForHub () {
    env = await getTestingEnvironment()
    chainId = env.chainId
    gaslessAccount = await getGaslessAccount()

    const sWalletTemplate: SmartWalletInstance = await SmartWallet.new()
    const factory: ProxyFactoryInstance = await createProxyFactory(sWalletTemplate)
    forwarderInstance = await createSmartWallet(gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
    forwarder = forwarderInstance.address
    tokenRecipient = await TestTokenRecipient.new()
    paymaster = await TestPaymasterVariableGasLimits.new()
    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    relayHub = await deployHub(stakeManager.address, penalizer.address)

    await paymaster.setRelayHub(relayHub.address)

    await relayHub.depositFor(paymaster.address, {
      value: ether('1'),
      from: other
    })

    await stakeManager.stakeForAddress(relayManager, unstakeDelay, {
      value: ether('2'),
      from: relayOwner
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    await relayHub.registerRelayServer(0, fee, '', { from: relayManager })
    encodedFunction = tokenRecipient.contract.methods.transfer(gaslessAccount.address, '5').encodeABI()

    relayRequest = {
      request: {
        to: tokenRecipient.address,
        data: encodedFunction,
        from: gaslessAccount.address,
        nonce: senderNonce.toString(),
        value: '0',
        gas: gasLimit.toString(),
        tokenRecipient: constants.ZERO_ADDRESS,
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '0',
        factory: constants.ZERO_ADDRESS, // only set if this is a deploy request
        recoverer: constants.ZERO_ADDRESS,
        index: '0'
      },
      relayData: {
        baseRelayFee: baseFee.toString(),
        pctRelayFee: fee.toString(),
        gasPrice: gasPrice.toString(),
        relayWorker,
        forwarder,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }

    }
    const dataToSign = new TypedRequestData(
      chainId,
      forwarder,
      relayRequest
    )
    signature = getLocalEip712Signature(
      dataToSign,
      gaslessAccount.privateKey
    )
  })

  describe('#calculateCharge()', function () {
    it('should calculate fee correctly', async function () {
      const gasUsed = 1e8
      const gasPrice = 1e9
      const baseRelayFee = 1000000
      const pctRelayFee = 10
      const relayData = {
        pctRelayFee,
        baseRelayFee,
        gasPrice,
        gasLimit: 0,
        relayWorker,
        forwarder,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }
      const charge = await relayHub.calculateCharge(gasUsed.toString(), relayData)
      const expectedCharge = baseRelayFee + gasUsed * gasPrice * (pctRelayFee + 100) / 100
      assert.equal(charge.toString(), expectedCharge.toString())
    })
  })

  describe('#relayCall()', function () {
    it('should set correct gas limits and pass correct \'maxPossibleGas\' to the \'preRelayedCall\'',
      async function () {
        const magicCosts = isRsk(env) ? magicNumbers.rsk : magicNumbers.istanbul
        const transactionGasLimit = gasLimit.mul(new BN(3))
        const res = await relayHub.relayCall(10e6, relayRequest, signature, '0x', transactionGasLimit, {
          from: relayWorker,
          gas: transactionGasLimit.toString(),
          gasPrice
        })

        const { tx } = res
        const gasLimits = await paymaster.getGasLimits()

        const hubOverhead = (await relayHub.gasOverhead()).toNumber()
        const maxPossibleGas = calculateTransactionMaxPossibleGas({
          gasLimits,
          hubOverhead,
          relayCallGasLimit: gasLimit.toString()
        })

        await expectEvent.inTransaction(tx, TestPaymasterVariableGasLimits, 'SampleRecipientPreCallWithValues', {
          gasleft: (gasLimits.preRelayedCallGasLimit.sub(new BN(magicCosts.pre))).toString(),
          maxPossibleGas: maxPossibleGas.toString()
        })

        await expectEvent.inTransaction(tx, TestPaymasterVariableGasLimits, 'SampleRecipientPostCallWithValues', {
          gasleft: (gasLimits.postRelayedCallGasLimit.sub(new BN(magicCosts.post))).toString()
        })
      })

    // note: since adding the revert reason to the emit, post overhead is dynamic
    it('should set correct gas limits and pass correct \'gasUsedWithoutPost\' to the \'postRelayCall\'', async () => {
      const gasPrice = 1e9
      const estimatePostGas = (await paymaster.postRelayedCall.estimateGas('0x', true, '0x0', {
        gasPrice,
        pctRelayFee: 0,
        baseRelayFee: 0,
        relayWorker,
        forwarder,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }, { from: relayHub.address })) - 21000

      const externalGasLimit = 5e6
      const tx = await relayHub.relayCall(10e6, relayRequest, signature, '0x', externalGasLimit, {
        from: relayWorker,
        gas: externalGasLimit.toString(),
        gasPrice
      })

      const pmlogs = await paymaster.contract.getPastEvents()
      const pmPostLog = pmlogs.find((e: any) => e.event === 'SampleRecipientPostCallWithValues')

      const gasUseWithoutPost = parseInt(pmPostLog.returnValues.gasUseWithoutPost)

      console.log(`Gas used without post = ${gasUseWithoutPost}`)

      const usedGas = parseInt(tx.receipt.gasUsed)

      console.log(`Gas used = ${usedGas}`)

      const diff = isRsk(env) ? 10_000 : 100
      assert.closeTo(gasUseWithoutPost, usedGas - estimatePostGas, diff,
        `postOverhead: increase by ${usedGas - estimatePostGas - gasUseWithoutPost}\
        \n\tpostOverhead: ${defaultEnvironment.relayHubConfiguration.postOverhead + usedGas - estimatePostGas - gasUseWithoutPost},\n`
      )
    })

    it('should revert an attempt to use more than allowed gas for preRelayedCall', async function () {
      // TODO: extract preparation to 'before' block
      const misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      // await misbehavingPaymaster.setTrustedForwarder(forwarder)
      await misbehavingPaymaster.setRelayHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: ether('0.1') })
      await misbehavingPaymaster.setOverspendAcceptGas(true)

      const senderNonce = (await forwarderInstance.nonce()).toString()
      const relayRequestMisbehaving = cloneRelayRequest(relayRequest)
      relayRequestMisbehaving.relayData.paymaster = misbehavingPaymaster.address
      relayRequestMisbehaving.request.nonce = senderNonce
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequestMisbehaving
      )
      const signature = getLocalEip712Signature(
        dataToSign,
        gaslessAccount.privateKey
      )

      const viewRelayCallResponse =
        await relayHub.contract.methods
          .relayCall(10e6, relayRequestMisbehaving, signature, '0x', externalGasLimit)
          .call({
            from: relayRequestMisbehaving.relayData.relayWorker,
            gas: externalGasLimit,
            gasPrice: gasPrice
          })

      assert.equal(viewRelayCallResponse[0], false)
      assert.equal(viewRelayCallResponse[1], null) // no revert string on out-of-gas

      const res = await relayHub.relayCall(10e6, relayRequestMisbehaving, signature, '0x', externalGasLimit, {
        from: relayRequestMisbehaving.relayData.relayWorker,
        gas: externalGasLimit,
        gasPrice: gasPrice
      })

      assert.equal('TransactionRejectedByPaymaster', res.logs[0].event)
      assert.equal(res.logs[0].args.reason, null)
    })
  })

  async function getBalances (): Promise<{
    paymasters: BN
    relayWorkers: BN
    relayManagers: BN
  }> {
    const paymasters = await relayHub.balanceOf(paymaster.address)
    // @ts-ignore
    const relayWorkers = new BN(await web3.eth.getBalance(relayWorker))
    const relayManagers = await relayHub.balanceOf(relayManager)
    return {
      paymasters,
      relayWorkers,
      relayManagers
    }
  }

  async function diffBalances (startBalances: {
    paymasters: BN
    relayWorkers: BN
    relayManagers: BN
  }): Promise<{
      paymasters: BN
      relayWorkers: BN
      relayManagers: BN
    }> {
    const balances = await getBalances()
    return {
      paymasters: startBalances.paymasters.sub(balances.paymasters),
      relayWorkers: startBalances.relayWorkers.sub(balances.relayWorkers),
      relayManagers: startBalances.relayManagers.sub(balances.relayManagers)
    }
  }

  function logOverhead (weiActualCharge: BN, workerGasUsed: BN): void {
    const gasDiff = workerGasUsed.sub(weiActualCharge).div(gasPrice).toString()
    if (gasDiff !== '0') {
      console.log('== zero-fee unmatched gas. RelayHubConfiguration.gasOverhead should be increased by: ' + gasDiff.toString())
      defaultEnvironment.relayHubConfiguration.gasOverhead += parseInt(gasDiff)
      console.log(`=== fixed:\n\tgasOverhead: ${defaultEnvironment.relayHubConfiguration.gasOverhead},\n`)
    }
  }

  context('charge calculation should not depend on return/revert value of request', () => {
    [[true, 0], [true, 20], [false, 0], [false, 50]]
      .forEach(([doRevert, len, b]) => {
        it(`should calculate overhead regardless of return value len (${len}) or revert (${doRevert})`, async () => {
          const recipient = await TestRecipient.new()
          const beforeBalances = getBalances()
          const senderNonce = (await forwarderInstance.nonce()).toString()
          let encodedFunction
          if (len === 0) {
            encodedFunction = recipient.contract.methods.checkNoReturnValues(doRevert).encodeABI()
          } else {
            encodedFunction = recipient.contract.methods.checkReturnValues(len, doRevert).encodeABI()
          }

          const relayRequest: RelayRequest = {
            request: {
              to: recipient.address,
              data: encodedFunction,
              from: gaslessAccount.address,
              nonce: senderNonce,
              value: '0',
              gas: gasLimit.toString(),
              tokenRecipient: constants.ZERO_ADDRESS,
              tokenContract: constants.ZERO_ADDRESS,
              tokenAmount: '0',
              factory: constants.ZERO_ADDRESS, // only set if this is a deploy request
              recoverer: constants.ZERO_ADDRESS,
              index: '0'
            },
            relayData: {
              baseRelayFee: '0',
              pctRelayFee: '0',
              gasPrice: '1',
              relayWorker,
              forwarder,
              paymaster: paymaster.address,
              paymasterData,
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
          const res = await relayHub.relayCall(10e6, relayRequest, signature, '0x', externalGasLimit, {
            from: relayWorker,
            gas: externalGasLimit,
            gasPrice: gasPrice
          })
          const resultEvent = res.logs.find(e => e.event === 'TransactionResult')
          if (len === 0) {
            assert.equal(resultEvent, null, 'should not get TransactionResult with zero len')
          } else {
            assert.notEqual(resultEvent, null, 'didn\'t get TrasnactionResult where it should.')
          }

          const rskDiff: number = isRsk(env) ? 3160 : 0
          const gasUsed: number = res.receipt.gasUsed
          const diff = await diffBalances(await beforeBalances)

          assert.equal(diff.paymasters.toNumber(), gasUsed + rskDiff)
        })
      })
  })

  describe('check calculation does not break for different fees', function () {
    before(async function () {
      await relayHub.depositFor(relayOwner, { value: (1).toString() })
      recipient = await TestRecipient.new()
    });

    [0, 1000]
      .forEach(messageLength =>
        [0, 1, 100]
          .forEach(requestedFee => {
            // avoid duplicate coverage checks. they do the same, and take a lot of time:
            if (requestedFee !== 0 && messageLength !== 0 && process.env.MODE === 'coverage') return
            // 50k tests take more then 10 seconds to complete so will run once for sanity
            if (messageLength === 50000 && requestedFee !== 10) return
            it(`should compensate relay with requested fee of ${requestedFee.toString()}% with ${messageLength.toString()} calldata size`, async function () {
              const beforeBalances = await getBalances()
              const pctRelayFee = requestedFee.toString()
              const senderNonce = (await forwarderInstance.nonce()).toString()
              const encodedFunction = recipient.contract.methods.emitMessage('a'.repeat(messageLength)).encodeABI()
              const baseRelayFee = '0'

              const relayRequest: RelayRequest = {
                request: {
                  to: recipient.address,
                  data: encodedFunction,
                  from: gaslessAccount.address,
                  nonce: senderNonce,
                  value: '0',
                  gas: gasLimit.toString(),
                  tokenRecipient: constants.ZERO_ADDRESS,
                  tokenContract: constants.ZERO_ADDRESS,
                  tokenAmount: '0',
                  factory: constants.ZERO_ADDRESS, // only set if this is a deploy request
                  recoverer: constants.ZERO_ADDRESS,
                  index: '0'
                },
                relayData: {
                  baseRelayFee,
                  pctRelayFee,
                  gasPrice: gasPrice.toString(),
                  relayWorker,
                  forwarder,
                  paymaster: paymaster.address,
                  paymasterData,
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
              const res = await relayHub.relayCall(10e6, relayRequest, signature, '0x', externalGasLimit, {
                from: relayWorker,
                gas: externalGasLimit,
                gasPrice: gasPrice
              })

              const afterBalances = await getBalances()
              assert.notEqual(beforeBalances.relayManagers.toString(), afterBalances.relayManagers.toString(), 'manager not compensated. transaction must have failed')

              // how much we got compensated for this tx from the paymaster
              const weiActualCharge = afterBalances.relayManagers.sub(beforeBalances.relayManagers)

              // how much gas we actually spent on this tx
              const workerWeiGasUsed = beforeBalances.relayWorkers.sub(afterBalances.relayWorkers)

              if (requestedFee === 0) {
                logOverhead(weiActualCharge, workerWeiGasUsed)
              }

              // TODO ppedemon
              // For some reason, asserts are failing for the [0, 0] case in RSK...
              if (requestedFee !== 0 && messageLength !== 0) {
                // sanity: worker executed and paid this tx
                assert.equal((gasPrice.muln(res.receipt.gasUsed)).toString(), workerWeiGasUsed.toString(), 'where else did the money go?')

                const expectedCharge = Math.floor(workerWeiGasUsed.toNumber() * (100 + requestedFee) / 100) + parseInt(baseRelayFee)
                assert.equal(weiActualCharge.toNumber(), expectedCharge,
                  'actual charge from paymaster higher than expected. diff= ' + ((weiActualCharge.toNumber() - expectedCharge) / gasPrice.toNumber()).toString())

                // Validate actual profit is with high precision $(requestedFee) percent higher then ether spent relaying
                // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
                const expectedActualCharge = workerWeiGasUsed.mul(new BN(requestedFee).add(new BN(100))).div(new BN(100))
                assert.equal(weiActualCharge.toNumber(), expectedActualCharge.toNumber(),
                  'unexpected over-paying by ' + (weiActualCharge.sub(expectedActualCharge)).toString())
                // Check that relay did pay it's gas fee by himself.
                // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
                const expectedBalanceAfter = beforeBalances.relayWorkers.subn(res.receipt.gasUsed * gasPrice)
                assert.equal(expectedBalanceAfter.cmp(afterBalances.relayWorkers), 0, 'relay did not pay the expected gas fees')

                // Check that relay's weiActualCharge is deducted from paymaster's stake.
                // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
                const expectedPaymasterBalance = beforeBalances.paymasters.sub(weiActualCharge)
                assert.equal(expectedPaymasterBalance.toString(), afterBalances.paymasters.toString())
              }
            })
          })
      )
  })
})

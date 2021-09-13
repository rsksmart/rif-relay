import { ether, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'

import { Transaction, TransactionOptions } from 'ethereumjs-tx'
import { stripZeros, toBuffer } from 'ethereumjs-util'
import { encode } from 'rlp'

import { isRsk, Environment } from '../src/common/Environments'
import {
  PenalizerInstance,
  RelayHubInstance
} from '../types/truffle-contracts'

import { deployHub, getTestingEnvironment } from './TestUtils'
import { getRawTxOptions } from '../src/common/ContractInteractor'

const RelayHub = artifacts.require('RelayHub')
const Penalizer = artifacts.require('Penalizer')

contract('Penalizer', function ([relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker, reporterRelayManager]) {
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let env: Environment
  let transactionOptions: TransactionOptions

  before(async function () {
    penalizer = await Penalizer.new()
    relayHub = await deployHub(penalizer.address)
    await penalizer.setHub(relayHub.address)
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
})

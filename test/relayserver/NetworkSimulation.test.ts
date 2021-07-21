import { ServerTestEnvironment } from './ServerTestEnvironment'
import {
  NetworkSimulatingProvider,
  EnvelopingConfig,
  ContractInteractor,
  EnvelopingTransactionDetails
} from '@rsksmart/rif-relay-common'
import { HttpProvider } from 'web3-core'
import { getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount } from '../TestUtils'
import { AccountKeypair, configure } from '@rsksmart/rif-relay-client'

contract('Network Simulation for Relay Server', function (accounts) {
  let env: ServerTestEnvironment
  let provider: NetworkSimulatingProvider

  before(async function () {
    provider = new NetworkSimulatingProvider(web3.currentProvider as HttpProvider)
    const contractFactory = async function (partialConfig: Partial<EnvelopingConfig>): Promise<ContractInteractor> {
      const contractInteractor = new ContractInteractor(provider, configure(partialConfig))
      await contractInteractor.init()
      return contractInteractor
    }
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({ chainId: (await getTestingEnvironment()).chainId }, {}, contractFactory)
    await env.newServerInstance({ workerTargetBalance: 0.6e18 })
    provider.setDelayTransactions(true)
  })

  describe('without automated mining', function () {
    beforeEach(async function () {
      await env.clearServerStorage()
    })

    it('should resolve once the transaction is broadcast', async function () {
      assert.equal(provider.mempool.size, 0)
      const { txHash, reqSigHash } = await env.relayTransaction(false)
      assert.equal(provider.mempool.size, 1)
      const receipt = await env.web3.eth.getTransactionReceipt(txHash)
      assert.isNull(receipt)
      await provider.mineTransaction(txHash)
      assert.equal(provider.mempool.size, 0)
      await env.assertTransactionRelayed(txHash, reqSigHash)
    })

    it('should broadcast multiple transactions at once', async function () {
      const gaslessAccount: AccountKeypair = await getGaslessAccount()

      const SmartWallet = artifacts.require('SmartWallet')
      const smartWalletTemplate = await SmartWallet.new()
      const factory = await createSmartWalletFactory(smartWalletTemplate)
      const smartWallet = await createSmartWallet(accounts[0], gaslessAccount.address, factory, gaslessAccount.privateKey, (await getTestingEnvironment()).chainId)

      env.relayClient.accountManager.addAccount(gaslessAccount)

      assert.equal(provider.mempool.size, 0)
      // cannot use the same sender as it will create same request with same forwarder nonce, etc
      const overrideDetails: Partial<EnvelopingTransactionDetails> = { from: gaslessAccount.address, callForwarder: smartWallet.address }
      // noinspection ES6MissingAwait - done on purpose
      const promises = [env.relayTransaction(false), env.relayTransaction(false, overrideDetails)]
      const txs = await Promise.all(promises)
      assert.equal(provider.mempool.size, 2)
      await provider.mineTransaction(txs[0].txHash)
      await provider.mineTransaction(txs[1].txHash)
      await env.assertTransactionRelayed(txs[0].txHash, txs[0].reqSigHash)
      await env.assertTransactionRelayed(txs[1].txHash, txs[1].reqSigHash, overrideDetails)
    })
  })
})

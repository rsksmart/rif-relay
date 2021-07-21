import { RelayServer } from '../../src/relayserver/RelayServer'
import { evmMine, evmMineMany, getTestingEnvironment } from '../TestUtils'
import { configure } from '@rsksmart/rif-relay-client'
import { HttpProvider } from 'web3-core'
import { ServerTestEnvironment } from './ServerTestEnvironment'
import {
  ServerConfigParams,
  ProfilingProvider,
  EnvelopingConfig,
  ContractInteractor
} from '@rsksmart/rif-relay-common'

contract('RelayServerRequestsProfiling', function (accounts) {
  const refreshStateTimeoutBlocks = 2
  const callsPerStateRefresh = 8
  const callsPerBlock = 0
  const callsPerTransaction = 17

  let provider: ProfilingProvider
  let relayServer: RelayServer
  let env: ServerTestEnvironment

  before(async function () {
    const serverConfig: Partial<ServerConfigParams> = {
      refreshStateTimeoutBlocks,
      workerMinBalance: 0.1e18,
      workerTargetBalance: 0.3e18,
      managerMinBalance: 0.1e18,
      managerTargetBalance: 0.3e18,
      minHubWithdrawalBalance: 0.1e18
    }

    provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
    const contractFactory = async function (partialConfig: Partial<EnvelopingConfig>): Promise<ContractInteractor> {
      const contractInteractor = new ContractInteractor(provider, configure(partialConfig))
      await contractInteractor.init()
      return contractInteractor
    }
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({ chainId: (await getTestingEnvironment()).chainId }, {}, contractFactory)
    await env.newServerInstance(serverConfig)
    relayServer = env.relayServer
    const latestBlock = await web3.eth.getBlock('latest')
    await relayServer._worker(latestBlock.number)
  })

  beforeEach(async function () {
    provider.reset()
  })

  it('should make X requests per block callback when state must be refreshed', async function () {
    await evmMineMany(5)
    const latestBlock = await web3.eth.getBlock('latest')
    assert.isTrue(relayServer._shouldRefreshState(latestBlock.number))
    const receipts = await relayServer._worker(latestBlock.number)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerStateRefresh)
  })

  it('should make X requests per block callback when nothing needs to be done', async function () {
    await evmMine()
    const latestBlock = await web3.eth.getBlock('latest')
    assert.isFalse(relayServer._shouldRefreshState(latestBlock.number))
    const receipts = await relayServer._worker(latestBlock.number)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerBlock)
  })

  describe('relay transaction', function () {
    before(async function () {
      provider.reset()
    })

    it('should make X requests per relay transaction request', async function () {
      await env.relayTransaction()
      provider.log()
      assert.equal(provider.requestsCount, callsPerTransaction)
    })
  })
})

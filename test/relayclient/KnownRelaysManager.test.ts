import { ether } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'

import KnownRelaysManager, { DefaultRelayScore } from '../../src/relayclient/KnownRelaysManager'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import {
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientInstance,
  SmartWalletInstance, ProxyFactoryInstance
} from '../../types/truffle-contracts'
import { deployHub, evmMineMany, startRelay, stopRelay, getTestingEnvironment, createProxyFactory, createSmartWallet, getGaslessAccount, prepareTransaction } from '../TestUtils'
import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { RelayRegisteredEventInfo } from '../../src/relayclient/types/RelayRegisteredEventInfo'
import { Environment } from '../../src/common/Environments'
import { constants } from '../../src/common/Constants'
import { AccountKeypair } from '../../src/relayclient/AccountManager'

const StakeManager = artifacts.require('StakeManager')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const TestRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')

export async function stake (stakeManager: StakeManagerInstance, relayHub: RelayHubInstance, manager: string, owner: string): Promise<void> {
  await stakeManager.stakeForAddress(manager, 1000, {
    value: ether('1'),
    from: owner
  })
  await stakeManager.authorizeHubByOwner(manager, relayHub.address, { from: owner })
}

export async function register (relayHub: RelayHubInstance, manager: string, worker: string, url: string, baseRelayFee?: string, pctRelayFee?: string): Promise<void> {
  await relayHub.addRelayWorkers([worker], { from: manager })
  await relayHub.registerRelayServer(baseRelayFee ?? '0', pctRelayFee ?? '0', url, { from: manager })
}

contract('KnownRelaysManager', function (
  [
    activeRelayWorkersAdded,
    activeRelayServerRegistered,
    activePaymasterRejected,
    activeTransactionRelayed,
    notActiveRelay,
    workerPaymasterRejected,
    workerTransactionRelayed,
    owner
  ]) {
  const relayLookupWindowBlocks = 100

  describe('#_fetchRecentlyActiveRelayManagers()', function () {
    let config: GSNConfig
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let relayHub: RelayHubInstance
    let testRecipient: TestRecipientInstance
    let paymaster: TestPaymasterConfigurableMisbehaviorInstance
    let workerRelayWorkersAdded
    let workerRelayServerRegistered
    let workerNotActive
    const gas = 4e6
    let factory: ProxyFactoryInstance
    let sWalletTemplate: SmartWalletInstance
    let smartWallet: SmartWalletInstance
    let env: Environment

    before(async function () {
      env = await getTestingEnvironment()
      workerRelayWorkersAdded = await web3.eth.personal.newAccount('password')
      workerRelayServerRegistered = await web3.eth.personal.newAccount('password')
      workerNotActive = await web3.eth.personal.newAccount('password')
      stakeManager = await StakeManager.new()
      relayHub = await deployHub(stakeManager.address, constants.ZERO_ADDRESS)
      config = configureGSN({
        relayHubAddress: relayHub.address,
        relayLookupWindowBlocks,
        chainId: env.chainId
      })
      contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, config)
      const senderAddress: AccountKeypair = await getGaslessAccount()

      await contractInteractor.init()

      testRecipient = await TestRecipient.new()
      sWalletTemplate = await SmartWallet.new()
      factory = await createProxyFactory(sWalletTemplate)
      smartWallet = await createSmartWallet(senderAddress.address, factory, senderAddress.privateKey, env.chainId)
      // register hub's RelayRequest with forwarder, if not already done.

      paymaster = await TestPaymasterConfigurableMisbehavior.new()
      // await paymaster.setTrustedForwarder(smartWallet.address)//TODO REMOVE
      await paymaster.setRelayHub(relayHub.address)
      await paymaster.deposit({ value: ether('1') })
      await stake(stakeManager, relayHub, activeRelayWorkersAdded, owner)
      await stake(stakeManager, relayHub, activeRelayServerRegistered, owner)
      await stake(stakeManager, relayHub, activePaymasterRejected, owner)
      await stake(stakeManager, relayHub, activeTransactionRelayed, owner)
      await stake(stakeManager, relayHub, notActiveRelay, owner)

      const other = await getGaslessAccount()
      const nextNonce = (await smartWallet.nonce()).toString()
      const txPaymasterRejected = await prepareTransaction(testRecipient, other, workerPaymasterRejected, paymaster.address, web3, nextNonce, smartWallet.address)
      const txTransactionRelayed = await prepareTransaction(testRecipient, other, workerTransactionRelayed, paymaster.address, web3, nextNonce, smartWallet.address)

      /** events that are not supposed to be visible to the manager */
      await relayHub.addRelayWorkers([workerRelayServerRegistered], {
        from: activeRelayServerRegistered
      })
      await relayHub.addRelayWorkers([workerNotActive], {
        from: notActiveRelay
      })
      await relayHub.addRelayWorkers([workerTransactionRelayed], {
        from: activeTransactionRelayed
      })
      await relayHub.addRelayWorkers([workerPaymasterRejected], {
        from: activePaymasterRejected
      })
      await relayHub.registerRelayServer('0', '0', '', { from: activeTransactionRelayed })
      await relayHub.registerRelayServer('0', '0', '', { from: activePaymasterRejected })

      await evmMineMany(relayLookupWindowBlocks)
      /** events that are supposed to be visible to the manager */
      await relayHub.registerRelayServer('0', '0', '', { from: activeRelayServerRegistered })
      await relayHub.addRelayWorkers([workerRelayWorkersAdded], {
        from: activeRelayWorkersAdded
      })
      await relayHub.relayCall(10e6, txTransactionRelayed.relayRequest, txTransactionRelayed.signature, '0x', gas, {
        from: workerTransactionRelayed,
        gas,
        gasPrice: txTransactionRelayed.relayRequest.relayData.gasPrice
      })
      await paymaster.setReturnInvalidErrorCode(true)
      await relayHub.relayCall(10e6, txPaymasterRejected.relayRequest, txPaymasterRejected.signature, '0x', gas, {
        from: workerPaymasterRejected,
        gas,
        gasPrice: txPaymasterRejected.relayRequest.relayData.gasPrice
      })
    })

    it('should contain all relay managers only if their workers were active in the last \'relayLookupWindowBlocks\' blocks',
      async function () {
        const knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
        const res = await knownRelaysManager._fetchRecentlyActiveRelayManagers()
        const actual = Array.from(res.values())
        assert.equal(actual.length, 4)
        assert.equal(actual[0], activeRelayServerRegistered)
        assert.equal(actual[1], activeRelayWorkersAdded)
        assert.equal(actual[2], activeTransactionRelayed)
        assert.equal(actual[3], activePaymasterRejected)
      })
  })
})

contract('KnownRelaysManager 2', function (accounts) {
  let contractInteractor: ContractInteractor
  const transactionDetails = {
    gas: '0x10000',
    gasPrice: '0x300000',
    from: '',
    data: '',
    to: '',
    forwarder: '',
    paymaster: '',
    tokenRecipient: '',
    tokenAmount: '',
    tokenContract: '',
    factory: ''
  }

  before(async function () {
    const env = await getTestingEnvironment()
    contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, configureGSN({ chainId: env.chainId }))
    await contractInteractor.init()
  })

  describe('#refresh()', function () {
    let relayProcess: ChildProcessWithoutNullStreams
    let knownRelaysManager: KnownRelaysManager
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let relayHub: RelayHubInstance
    let config: GSNConfig
    let env: Environment

    before(async function () {
      env = await getTestingEnvironment()
      stakeManager = await StakeManager.new()
      relayHub = await deployHub(stakeManager.address, constants.ZERO_ADDRESS)
      config = configureGSN({
        preferredRelays: ['http://localhost:8090'],
        relayHubAddress: relayHub.address,
        chainId: env.chainId
      })
      relayProcess = await startRelay(relayHub.address, stakeManager, {
        stake: 1e18,
        url: 'asd',
        relayOwner: accounts[1],
        ethereumNodeUrl: (web3.currentProvider as HttpProvider).host
      })
      contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, config)
      await contractInteractor.init()
      knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
      await stake(stakeManager, relayHub, accounts[1], accounts[0])
      await stake(stakeManager, relayHub, accounts[2], accounts[0])
      await stake(stakeManager, relayHub, accounts[3], accounts[0])
      await stake(stakeManager, relayHub, accounts[4], accounts[0])
      await register(relayHub, accounts[1], accounts[6], 'stakeAndAuthorization1')
      await register(relayHub, accounts[2], accounts[7], 'stakeAndAuthorization2')
      await register(relayHub, accounts[3], accounts[8], 'stakeUnlocked')
      await register(relayHub, accounts[4], accounts[9], 'hubUnauthorized')

      await stakeManager.unlockStake(accounts[3])
      await stakeManager.unauthorizeHubByOwner(accounts[4], relayHub.address)
    })

    after(async function () {
      await stopRelay(relayProcess)
    })

    it('should consider all relay managers with stake and authorization as active', async function () {
      await knownRelaysManager.refresh()
      const preferredRelays = knownRelaysManager.knownRelays[0]
      const activeRelays = knownRelaysManager.knownRelays[1]
      assert.equal(preferredRelays.length, 1)
      assert.equal(preferredRelays[0].relayUrl, 'http://localhost:8090')
      assert.equal(activeRelays.length, 3)
      assert.equal(activeRelays[0].relayUrl, 'http://localhost:8090')
      assert.equal(activeRelays[1].relayUrl, 'stakeAndAuthorization1')
      assert.equal(activeRelays[2].relayUrl, 'stakeAndAuthorization2')
    })

    it('should use \'relayFilter\' to remove unsuitable relays', async function () {
      const relayFilter = (registeredEventInfo: RelayRegisteredEventInfo): boolean => {
        return registeredEventInfo.relayUrl.includes('2')
      }
      const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, config, relayFilter)
      await knownRelaysManagerWithFilter.refresh()
      const relays = knownRelaysManagerWithFilter.knownRelays[1]
      assert.equal(relays.length, 1)
      assert.equal(relays[0].relayUrl, 'stakeAndAuthorization2')
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  describe('#getRelaysSortedForTransaction()', function () {
    const relayInfoLowFee = {
      relayManager: accounts[0],
      relayUrl: 'lowFee',
      baseRelayFee: '1000000',
      pctRelayFee: '10'
    }
    const relayInfoHighFee = {
      relayManager: accounts[0],
      relayUrl: 'highFee',
      baseRelayFee: '100000000',
      pctRelayFee: '50'
    }

    describe('#_refreshFailures()', function () {
      let knownRelaysManager: KnownRelaysManager
      let lastErrorTime: number

      before(async function () {
        const env = await getTestingEnvironment()
        knownRelaysManager = new KnownRelaysManager(
          contractInteractor, configureGSN({ chainId: env.chainId }))
        knownRelaysManager.saveRelayFailure(100, 'rm1', 'url1')
        knownRelaysManager.saveRelayFailure(500, 'rm2', 'url2')
        lastErrorTime = Date.now()
        knownRelaysManager.saveRelayFailure(lastErrorTime, 'rm3', 'url3')
      })

      it('should remove the failures that occurred more than \'relayTimeoutGrace\' seconds ago', function () {
        // @ts-ignore
        knownRelaysManager.relayFailures.forEach(failures => {
          assert.equal(failures.length, 1)
        })
        knownRelaysManager._refreshFailures()
        // @ts-ignore
        assert.equal(knownRelaysManager.relayFailures.get('url1').length, 0)
        // @ts-ignore
        assert.equal(knownRelaysManager.relayFailures.get('url2').length, 0)
        // @ts-ignore
        assert.deepEqual(knownRelaysManager.relayFailures.get('url3'), [{
          lastErrorTime,
          relayManager: 'rm3',
          relayUrl: 'url3'
        }])
      })
    })

    describe('DefaultRelayScore', function () {
      const failure = {
        lastErrorTime: 100,
        relayManager: 'rm3',
        relayUrl: 'url3'
      }
      it('should subtract penalty from a relay for each known failure', async function () {
        const relayScoreNoFailures = await DefaultRelayScore(relayInfoHighFee, transactionDetails, [])
        const relayScoreOneFailure = await DefaultRelayScore(relayInfoHighFee, transactionDetails, [failure])
        const relayScoreTenFailures = await DefaultRelayScore(relayInfoHighFee, transactionDetails, Array(10).fill(failure))
        const relayScoreLowFees = await DefaultRelayScore(relayInfoLowFee, transactionDetails, [])
        assert.isAbove(relayScoreNoFailures, relayScoreOneFailure)
        assert.isAbove(relayScoreOneFailure, relayScoreTenFailures)
        assert.isAbove(relayScoreLowFees, relayScoreNoFailures)
      })
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  describe('getRelaysSortedForTransaction', function () {
    const biasedRelayScore = async function (relay: RelayRegisteredEventInfo): Promise<number> {
      if (relay.relayUrl === 'alex') {
        return await Promise.resolve(1000)
      } else {
        return await Promise.resolve(100)
      }
    }
    let knownRelaysManager: KnownRelaysManager

    before(async function () {
      const env = await getTestingEnvironment()
      knownRelaysManager = new KnownRelaysManager(
        contractInteractor, configureGSN({ chainId: env.chainId }), undefined, biasedRelayScore)
      const activeRelays: RelayRegisteredEventInfo[][] = [[], [{
        relayManager: accounts[0],
        relayUrl: 'alex',
        baseRelayFee: '100000000',
        pctRelayFee: '50'
      }, {
        relayManager: accounts[0],
        relayUrl: 'joe',
        baseRelayFee: '100',
        pctRelayFee: '5'
      }, {
        relayManager: accounts[1],
        relayUrl: 'joe',
        baseRelayFee: '10',
        pctRelayFee: '4'
      }]]
      sinon.stub(knownRelaysManager, 'knownRelays').value(activeRelays)
    })

    it('should use provided score calculation method to sort the known relays', async function () {
      const sortedRelays = (await knownRelaysManager.getRelaysSortedForTransaction(transactionDetails)) as RelayRegisteredEventInfo[][]
      assert.equal(sortedRelays[1][0].relayUrl, 'alex')
      // checking the relayers are sorted AND they cannot overshadow each other's url
      assert.equal(sortedRelays[1][1].relayUrl, 'joe')
      assert.equal(sortedRelays[1][1].baseRelayFee, '100')
      assert.equal(sortedRelays[1][1].pctRelayFee, '5')
      assert.equal(sortedRelays[1][2].relayUrl, 'joe')
      assert.equal(sortedRelays[1][2].baseRelayFee, '10')
      assert.equal(sortedRelays[1][2].pctRelayFee, '4')
    })
  })
})

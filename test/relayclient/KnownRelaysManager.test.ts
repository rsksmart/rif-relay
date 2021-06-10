import { ether } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'

import { KnownRelaysManager, DefaultRelayScore } from '../../src/relayclient/KnownRelaysManager'
import ContractInteractor from '../../src/common/ContractInteractor'
import { configure, EnvelopingConfig } from '../../src/relayclient/Configurator'
import {
  RelayHubInstance,
  TestVerifierConfigurableMisbehaviorInstance,
  TestRecipientInstance,
  SmartWalletInstance, SmartWalletFactoryInstance, TestTokenInstance
} from '../../types/truffle-contracts'
import { deployHub, evmMineMany, startRelay, stopRelay, getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount, prepareTransaction } from '../TestUtils'
import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { Environment } from '../../src/common/Environments'
import { constants } from '../../src/common/Constants'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import EnvelopingTransactionDetails from '../../src/relayclient/types/EnvelopingTransactionDetails'
import { RelayData } from '../../src/relayclient/types/RelayData'

const TestVerifierConfigurableMisbehavior = artifacts.require('TestVerifierConfigurableMisbehavior')
const TestRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')

export async function stake (relayHub: RelayHubInstance, manager: string, owner: string): Promise<void> {
  await relayHub.stakeForAddress(manager, 1000, {
    value: ether('1'),
    from: owner
  })
}

export async function register (relayHub: RelayHubInstance, manager: string, worker: string, url: string): Promise<void> {
  await relayHub.addRelayWorkers([worker], { from: manager })
  await relayHub.registerRelayServer(url, { from: manager })
}

contract('KnownRelaysManager', function (
  [
    activeRelayWorkersAdded,
    activeRelayServerRegistered,
    activeVerifierRejected,
    activeTransactionRelayed,
    notActiveRelay,
    workerVerifierRejected,
    workerTransactionRelayed,
    owner
  ]) {
  const relayLookupWindowBlocks = 100

  describe('#_fetchRecentlyActiveRelayManagers()', function () {
    let config: EnvelopingConfig
    let contractInteractor: ContractInteractor
    let relayHub: RelayHubInstance
    let testRecipient: TestRecipientInstance
    let verifier: TestVerifierConfigurableMisbehaviorInstance
    let workerRelayWorkersAdded
    let workerRelayServerRegistered
    let workerNotActive
    const gas = 4e6
    let factory: SmartWalletFactoryInstance
    let sWalletTemplate: SmartWalletInstance
    let smartWallet: SmartWalletInstance
    let env: Environment
    let token: TestTokenInstance

    before(async function () {
      env = await getTestingEnvironment()
      workerRelayWorkersAdded = await web3.eth.personal.newAccount('password')
      workerRelayServerRegistered = await web3.eth.personal.newAccount('password')
      workerNotActive = await web3.eth.personal.newAccount('password')
      relayHub = await deployHub(constants.ZERO_ADDRESS)
      config = configure({
        relayHubAddress: relayHub.address,
        relayLookupWindowBlocks,
        chainId: env.chainId
      })

      const tTokenArtifact = artifacts.require('TestToken')
      token = await tTokenArtifact.new()

      contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, config)
      const senderAddress: AccountKeypair = await getGaslessAccount()

      await contractInteractor.init()

      testRecipient = await TestRecipient.new()
      sWalletTemplate = await SmartWallet.new()
      factory = await createSmartWalletFactory(sWalletTemplate)
      smartWallet = await createSmartWallet(activeRelayWorkersAdded, senderAddress.address, factory, senderAddress.privateKey, env.chainId)
      await token.mint('1000', smartWallet.address)

      // register hub's RelayRequest with forwarder, if not already done.

      verifier = await TestVerifierConfigurableMisbehavior.new()
      // await verifier.setTrustedForwarder(smartWallet.address)//TODO REMOVE
      await stake(relayHub, activeRelayWorkersAdded, owner)
      await stake(relayHub, activeRelayServerRegistered, owner)
      await stake(relayHub, activeVerifierRejected, owner)
      await stake(relayHub, activeTransactionRelayed, owner)
      await stake(relayHub, notActiveRelay, owner)

      let nextNonce = (await smartWallet.nonce()).toString()
      const txTransactionRelayed = await prepareTransaction(relayHub.address, testRecipient, senderAddress, workerTransactionRelayed, verifier.address, nextNonce, smartWallet.address, token.address, '1')

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
      await relayHub.addRelayWorkers([workerVerifierRejected], {
        from: activeVerifierRejected
      })
      await relayHub.registerRelayServer('', { from: activeTransactionRelayed })
      await relayHub.registerRelayServer('', { from: activeVerifierRejected })

      await evmMineMany(relayLookupWindowBlocks)
      /** events that are supposed to be visible to the manager */
      await relayHub.registerRelayServer('', { from: activeRelayServerRegistered })
      await relayHub.addRelayWorkers([workerRelayWorkersAdded], {
        from: activeRelayWorkersAdded
      })
      await relayHub.relayCall(txTransactionRelayed.relayRequest, txTransactionRelayed.signature, {
        from: workerTransactionRelayed,
        gas,
        gasPrice: txTransactionRelayed.relayRequest.relayData.gasPrice
      })
      await verifier.setReturnInvalidErrorCode(true)

      nextNonce = (await smartWallet.nonce()).toString()
      const txVerifierRejected = await prepareTransaction(relayHub.address, testRecipient, senderAddress, workerVerifierRejected, verifier.address, nextNonce, smartWallet.address, token.address, '1')

      await relayHub.relayCall(txVerifierRejected.relayRequest, txVerifierRejected.signature, {
        from: workerVerifierRejected,
        gas,
        gasPrice: txVerifierRejected.relayRequest.relayData.gasPrice
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
        assert.equal(actual[3], activeVerifierRejected)
      })
  })
})

contract('KnownRelaysManager 2', function (accounts) {
  let contractInteractor: ContractInteractor
  const transactionDetails: EnvelopingTransactionDetails = {
    gas: '0x10000',
    gasPrice: '0x300000',
    from: '',
    data: '',
    to: '',
    callForwarder: '',
    callVerifier: '',
    tokenAmount: '',
    tokenGas: '',
    tokenContract: '',
    isSmartWalletDeploy: false
  }

  before(async function () {
    const env = await getTestingEnvironment()
    contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, configure({ chainId: env.chainId }))
    await contractInteractor.init()
  })

  describe('#refresh()', function () {
    let relayProcess: ChildProcessWithoutNullStreams
    let knownRelaysManager: KnownRelaysManager
    let contractInteractor: ContractInteractor
    let relayHub: RelayHubInstance
    let config: EnvelopingConfig
    let env: Environment

    before(async function () {
      env = await getTestingEnvironment()
      relayHub = await deployHub(constants.ZERO_ADDRESS)
      config = configure({
        preferredRelays: ['http://localhost:8090'],
        relayHubAddress: relayHub.address,
        chainId: env.chainId
      })
      relayProcess = (await startRelay(relayHub, {
        stake: 1e18,
        url: 'asd',
        relayOwner: accounts[1],
        rskNodeUrl: (web3.currentProvider as HttpProvider).host
      })).proc

      contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, config)
      await contractInteractor.init()
      knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
      await stake(relayHub, accounts[1], accounts[0])
      await stake(relayHub, accounts[2], accounts[0])
      await stake(relayHub, accounts[3], accounts[0])
      await register(relayHub, accounts[1], accounts[6], 'stakeAndAuthorization1')
      await register(relayHub, accounts[2], accounts[7], 'stakeAndAuthorization2')
      await register(relayHub, accounts[3], accounts[8], 'stakeUnlocked')

      await relayHub.unlockStake(accounts[3])
    })

    after(async function () {
      await stopRelay(relayProcess)
    })

    it('should consider all relay managers with stake and authorization as active', async function () {
      await knownRelaysManager.refresh()
      const preferredRelays = knownRelaysManager.preferredRelayers
      const activeRelays = knownRelaysManager.allRelayers
      assert.equal(preferredRelays.length, 1)
      assert.equal(preferredRelays[0].url, 'http://localhost:8090')
      assert.equal(activeRelays.length, 4)
      assert.equal(activeRelays[0].url, 'http://localhost:8090')
      assert.equal(activeRelays[1].url, 'stakeAndAuthorization1')
      assert.equal(activeRelays[2].url, 'stakeAndAuthorization2')
      assert.equal(activeRelays[3].url, 'stakeUnlocked')
    })

    it('should use \'relayFilter\' to remove unsuitable relays', async function () {
      const relayFilter = (registeredEventInfo: RelayData): boolean => {
        return registeredEventInfo.url.includes('2')
      }
      const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, config, relayFilter)
      await knownRelaysManagerWithFilter.refresh()
      const relays = knownRelaysManagerWithFilter.allRelayers
      assert.equal(relays.length, 1)
      assert.equal(relays[0].url, 'stakeAndAuthorization2')
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  describe('#getRelaysSortedForTransaction()', function () {
    const relayData: RelayData = {
      manager: accounts[0],
      url: 'url'
    }

    describe('#_refreshFailures()', function () {
      let knownRelaysManager: KnownRelaysManager
      let lastErrorTime: number

      before(async function () {
        const env = await getTestingEnvironment()
        knownRelaysManager = new KnownRelaysManager(
          contractInteractor, configure({ chainId: env.chainId }))
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

    describe('#splitRange', () => {
      let knownRelaysManager: KnownRelaysManager
      let lastErrorTime: number

      before(async function () {
        const env = await getTestingEnvironment()
        knownRelaysManager = new KnownRelaysManager(
          contractInteractor, configure({ chainId: env.chainId }))
        knownRelaysManager.saveRelayFailure(100, 'rm1', 'url1')
        knownRelaysManager.saveRelayFailure(500, 'rm2', 'url2')
        lastErrorTime = Date.now()
        knownRelaysManager.saveRelayFailure(lastErrorTime, 'rm3', 'url3')
      })

      it('split 1', () => {
        assert.deepEqual(knownRelaysManager.splitRange(1, 6, 1),
          [{ fromBlock: 1, toBlock: 6 }])
      })
      it('split 2', () => {
        assert.deepEqual(knownRelaysManager.splitRange(1, 6, 2),
          [{ fromBlock: 1, toBlock: 3 }, { fromBlock: 4, toBlock: 6 }])
      })
      it('split 2 odd', () => {
        assert.deepEqual(knownRelaysManager.splitRange(1, 7, 2),
          [{ fromBlock: 1, toBlock: 4 }, { fromBlock: 5, toBlock: 7 }])
      })
      it('split 3', () => {
        assert.deepEqual(knownRelaysManager.splitRange(1, 9, 3),
          [{ fromBlock: 1, toBlock: 3 }, { fromBlock: 4, toBlock: 6 }, { fromBlock: 7, toBlock: 9 }])
      })

      it('split 3 odd', () => {
        assert.deepEqual(knownRelaysManager.splitRange(1, 10, 3),
          [{ fromBlock: 1, toBlock: 4 }, { fromBlock: 5, toBlock: 8 }, { fromBlock: 9, toBlock: 10 }])
      })
    })

    describe('#getPastEventsForHub', () => {
      let saveContractInteractor: any
      let knownRelaysManager: KnownRelaysManager
      let lastErrorTime: number
      before(async () => {
        const env = await getTestingEnvironment()
        knownRelaysManager = new KnownRelaysManager(
          contractInteractor, configure({ chainId: env.chainId }))
        knownRelaysManager.saveRelayFailure(100, 'rm1', 'url1')
        knownRelaysManager.saveRelayFailure(500, 'rm2', 'url2')
        lastErrorTime = Date.now()
        knownRelaysManager.saveRelayFailure(lastErrorTime, 'rm3', 'url3')

        saveContractInteractor = (knownRelaysManager as any).contractInteractor;
        (knownRelaysManager as any).contractInteractor = {
          async getPastEventsForHub (extra: any, options: { fromBlock: number, toBlock: number }) {
            if (options.toBlock - options.fromBlock > 100) {
              throw new Error('query returned more than 100 events')
            }
            const ret: any[] = []
            for (let b = options.fromBlock; b <= options.toBlock; b++) {
              ret.push({ event: `event${b}-${options.fromBlock}-${options.toBlock}` })
            }
            return ret
          }
        }
      })
      after(() => {
        (knownRelaysManager as any).contractInteractor = saveContractInteractor
      })

      it('should break large request into multiple chunks', async () => {
        (knownRelaysManager as any).relayLookupWindowParts = 1
        const ret = await knownRelaysManager.getPastEventsForHub(1, 300)

        assert.equal((knownRelaysManager as any).relayLookupWindowParts, 4)
        assert.equal(ret.length, 300)
        assert.equal(ret[0].event, 'event1-1-75')
        assert.equal(ret[299].event, 'event300-226-300')
      })
    })

    describe('DefaultRelayScore', function () {
      const failure = {
        lastErrorTime: 100,
        relayManager: 'rm3',
        relayUrl: 'url3'
      }
      it('should subtract penalty from a relay for each known failure', async function () {
        const relayScoreNoFailures = await DefaultRelayScore(relayData, transactionDetails, [])
        const relayScoreOneFailure = await DefaultRelayScore(relayData, transactionDetails, [failure])
        const relayScoreTenFailures = await DefaultRelayScore(relayData, transactionDetails, Array(10).fill(failure))

        assert.isAbove(relayScoreNoFailures, relayScoreOneFailure)
        assert.isAbove(relayScoreOneFailure, relayScoreTenFailures)
      })
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  describe('getRelaysSortedForTransaction', function () {
    const biasedRelayScore = async function (relay: RelayData): Promise<number> {
      if (relay.url === 'alex') {
        return await Promise.resolve(1000)
      } else {
        return await Promise.resolve(100)
      }
    }
    let knownRelaysManager: KnownRelaysManager

    before(async function () {
      const env = await getTestingEnvironment()
      knownRelaysManager = new KnownRelaysManager(
        contractInteractor, configure({ chainId: env.chainId }), undefined, biasedRelayScore)
      const activeRelays: RelayData[] = [{
        manager: accounts[0],
        url: 'alex',
        penalized: false,
        stakeAdded: true,
        registered: true
      }, {
        manager: accounts[0],
        url: 'joe',
        penalized: false,
        stakeAdded: true,
        registered: true
      }, {
        manager: accounts[1],
        url: 'joe',
        penalized: false,
        stakeAdded: true,
        registered: true
      }]
      sinon.stub(knownRelaysManager, 'allRelayers').value(activeRelays)
    })

    it('should use provided score calculation method to sort the known relays', async function () {
      const sortedRelays = (await knownRelaysManager.getRelaysSortedForTransaction(transactionDetails))
      assert.equal(sortedRelays[1][0].url, 'alex')
      // checking the relayers are sorted AND they cannot overshadow each other's url
      assert.equal(sortedRelays[1][1].url, 'joe')
      assert.equal(sortedRelays[1][2].url, 'joe')
    })
  })
})

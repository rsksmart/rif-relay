import { KnownRelaysManager, DefaultRelayScore } from '../../src/relayclient/KnownRelaysManager'
import ContractInteractor from '../../src/common/ContractInteractor'
import { configure, EnvelopingConfig } from '../../src/relayclient/Configurator'
import { deployHub, evmMineMany, getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount, prepareTransaction, startRelay, stopRelay } from '../TestUtils'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { RelayRegisteredEventInfo } from '../../src/relayclient/types/RelayRegisteredEventInfo'
import { Environment } from '../../src/common/Environments'
import { constants } from '../../src/common/Constants'
import { AccountKeypair } from '../../src/relayclient/AccountManager'
import EnvelopingTransactionDetails from '../../src/relayclient/types/EnvelopingTransactionDetails'
import { ethers, network } from 'hardhat'
import { Event } from 'ethers'
import { RelayHub, SmartWallet, SmartWalletFactory, SmartWallet__factory, TestRecipient, TestRecipient__factory, TestToken, TestToken__factory, TestVerifierConfigurableMisbehavior, TestVerifierConfigurableMisbehavior__factory } from '../../typechain'
import { expect } from 'chai'
import sinon from 'sinon'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export async function stake (relayHub: RelayHub, manager: string, owner: SignerWithAddress): Promise<void> {
  await relayHub.connect(owner).stakeForAddress(manager, 1000, {
    value: ethers.utils.parseEther('1')
  })
}

export async function register (relayHub: RelayHub, manager: SignerWithAddress, worker: string, url: string): Promise<void> {
  await relayHub.connect(manager).addRelayWorkers([worker])
  await relayHub.connect(manager).registerRelayServer(url)
}

describe('KnownRelaysManager', function () {
  const relayLookupWindowBlocks = 100

  let TestVerifierConfigurableMisbehavior: TestVerifierConfigurableMisbehavior__factory
  let TestRecipient: TestRecipient__factory
  let SmartWallet: SmartWallet__factory
  let activeRelayWorkersAddedSigner: SignerWithAddress
  let activeRelayServerRegisteredSigner: SignerWithAddress
  let activeVerifierRejectedSigner: SignerWithAddress
  let activeTransactionRelayedSigner: SignerWithAddress
  let notActiveRelaySigner: SignerWithAddress
  let workerVerifierRejectedSigner: SignerWithAddress
  let workerTransactionRelayedSigner: SignerWithAddress
  let ownerSigner: SignerWithAddress
  let activeRelayWorkersAdded: string
  let activeRelayServerRegistered: string
  let activeVerifierRejected: string
  let activeTransactionRelayed: string
  let notActiveRelay: string
  let workerVerifierRejected: string
  let workerTransactionRelayed: string

  describe('#_fetchRecentlyActiveRelayManagers()', function () {
    let config: EnvelopingConfig
    let contractInteractor: ContractInteractor
    let relayHub: RelayHub
    let testRecipient: TestRecipient
    let verifier: TestVerifierConfigurableMisbehavior
    let workerRelayWorkersAdded
    let workerRelayServerRegistered
    let workerNotActive
    const gasLimit = 4e6
    let factory: SmartWalletFactory
    let sWalletTemplate: SmartWallet
    let smartWallet: SmartWallet
    let env: Environment
    let token: TestToken

    before(async function () {
      [activeRelayWorkersAddedSigner,
        activeRelayServerRegisteredSigner,
        activeVerifierRejectedSigner,
        activeTransactionRelayedSigner,
        notActiveRelaySigner,
        workerVerifierRejectedSigner,
        workerTransactionRelayedSigner,
        ownerSigner] = await ethers.getSigners()
      activeRelayWorkersAdded = await activeRelayWorkersAddedSigner.getAddress()
      activeRelayServerRegistered = await activeRelayServerRegisteredSigner.getAddress()
      activeVerifierRejected = await activeVerifierRejectedSigner.getAddress()
      activeTransactionRelayed = await activeTransactionRelayedSigner.getAddress()
      notActiveRelay = await notActiveRelaySigner.getAddress()
      workerVerifierRejected = await workerVerifierRejectedSigner.getAddress()
      workerTransactionRelayed = await workerTransactionRelayedSigner.getAddress()
      env = await getTestingEnvironment()
      workerRelayWorkersAdded = await (ethers.Wallet.createRandom()).getAddress() // await web3.eth.personal.newAccount('password')
      workerRelayServerRegistered = await (ethers.Wallet.createRandom()).getAddress() // await web3.eth.personal.newAccount('password')
      workerNotActive = await (ethers.Wallet.createRandom()).getAddress() // await web3.eth.personal.newAccount('password')
      relayHub = await deployHub(constants.ZERO_ADDRESS)
      config = configure({
        relayHubAddress: relayHub.address,
        relayLookupWindowBlocks,
        chainId: env.chainId
      })

      const tTokenArtifact = await ethers.getContractFactory('TestToken') as TestToken__factory
      token = await tTokenArtifact.deploy()
      await token.deployed()

      contractInteractor = new ContractInteractor(ethers.provider, config)
      const senderAddress: AccountKeypair = await getGaslessAccount()

      await contractInteractor.init()

      TestRecipient = await ethers.getContractFactory('TestRecipient') as TestRecipient__factory
      testRecipient = await TestRecipient.deploy()
      await testRecipient.deployed()
      SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
      sWalletTemplate = await SmartWallet.deploy()
      await sWalletTemplate.deployed()
      factory = await createSmartWalletFactory(sWalletTemplate)
      smartWallet = await createSmartWallet(activeRelayWorkersAdded, senderAddress.address, factory, senderAddress.privateKey, env.chainId)
      await token.mint('1000', smartWallet.address)

      // register hub's RelayRequest with forwarder, if not already done.
      TestVerifierConfigurableMisbehavior = await ethers.getContractFactory('TestVerifierConfigurableMisbehavior') as TestVerifierConfigurableMisbehavior__factory
      verifier = await TestVerifierConfigurableMisbehavior.deploy()
      await verifier.deployed()
      // await verifier.setTrustedForwarder(smartWallet.address)//TODO REMOVE
      await stake(relayHub, activeRelayWorkersAdded, ownerSigner)
      await stake(relayHub, activeRelayServerRegistered, ownerSigner)
      await stake(relayHub, activeVerifierRejected, ownerSigner)
      await stake(relayHub, activeTransactionRelayed, ownerSigner)
      await stake(relayHub, notActiveRelay, ownerSigner)

      let nextNonce = (await smartWallet.nonce()).toString()
      const txTransactionRelayed = await prepareTransaction(relayHub.address, testRecipient, senderAddress, workerTransactionRelayed, verifier.address, nextNonce, smartWallet.address, token.address, '1')
      /** events that are not supposed to be visible to the manager */
      await relayHub.connect(activeRelayServerRegisteredSigner).addRelayWorkers([workerRelayServerRegistered])
      await relayHub.connect(notActiveRelaySigner).addRelayWorkers([workerNotActive])
      await relayHub.connect(activeTransactionRelayedSigner).addRelayWorkers([workerTransactionRelayed])
      await relayHub.connect(activeVerifierRejectedSigner).addRelayWorkers([workerVerifierRejected])
      await relayHub.connect(activeTransactionRelayedSigner).registerRelayServer('')
      await relayHub.connect(activeVerifierRejectedSigner).registerRelayServer('')

      await evmMineMany(relayLookupWindowBlocks)
      /** events that are supposed to be visible to the manager */
      await relayHub.connect(activeRelayServerRegisteredSigner).registerRelayServer('')
      await relayHub.connect(activeRelayWorkersAddedSigner).addRelayWorkers([workerRelayWorkersAdded])
      await relayHub.connect(workerTransactionRelayedSigner).relayCall(txTransactionRelayed.relayRequest, txTransactionRelayed.signature, {
        gasLimit,
        gasPrice: txTransactionRelayed.relayRequest.relayData.gasPrice
      })
      await verifier.setReturnInvalidErrorCode(true)

      nextNonce = (await smartWallet.nonce()).toString()
      const txVerifierRejected = await prepareTransaction(relayHub.address, testRecipient, senderAddress, workerVerifierRejected, verifier.address, nextNonce, smartWallet.address, token.address, '1')

      await relayHub.connect(workerVerifierRejectedSigner).relayCall(txVerifierRejected.relayRequest, txVerifierRejected.signature, {
        gasLimit,
        gasPrice: txVerifierRejected.relayRequest.relayData.gasPrice
      })
    })

    it('should contain all relay managers only if their workers were active in the last \'relayLookupWindowBlocks\' blocks',
      async function () {
        const knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
        const res = await knownRelaysManager._fetchRecentlyActiveRelayManagers()
        const actual = Array.from(res.values())
        expect(actual.length).to.be.equal(4)
        expect(actual[0]).to.be.equal(activeRelayServerRegistered)
        expect(actual[1]).to.be.equal(activeRelayWorkersAdded)
        expect(actual[2]).to.be.equal(activeTransactionRelayed)
        expect(actual[3]).to.be.equal(activeVerifierRejected)
      })
  })
})

describe('KnownRelaysManager 2', function () {
  let contractInteractor: ContractInteractor
  let accounts: string[]
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
    accounts = await ethers.provider.listAccounts()
    const env = await getTestingEnvironment()
    contractInteractor = new ContractInteractor(ethers.provider, configure({ chainId: env.chainId }))
    await contractInteractor.init()
  })

  describe('#refresh()', function () {
    let relayProcess: ChildProcessWithoutNullStreams
    let knownRelaysManager: KnownRelaysManager
    let contractInteractor: ContractInteractor
    let relayHub: RelayHub
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
        // @ts-ignore
        rskNodeUrl: network.config.url
      })).proc

      contractInteractor = new ContractInteractor(ethers.provider, config)
      await contractInteractor.init()
      knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
      const aSigner = await ethers.getSigner(accounts[0])
      await stake(relayHub, accounts[1], aSigner)
      await stake(relayHub, accounts[2], aSigner)
      await stake(relayHub, accounts[3], aSigner)
      await register(relayHub, await ethers.getSigner(accounts[1]), accounts[6], 'stakeAndAuthorization1')
      await register(relayHub, await ethers.getSigner(accounts[2]), accounts[7], 'stakeAndAuthorization2')
      await register(relayHub, await ethers.getSigner(accounts[3]), accounts[8], 'stakeUnlocked')

      await relayHub.unlockStake(accounts[3])
    })

    after(async function () {
      await stopRelay(relayProcess)
    })

    it('should consider all relay managers with stake and authorization as active', async function () {
      await knownRelaysManager.refresh()
      const preferredRelays = knownRelaysManager.preferredRelayers
      const activeRelays = knownRelaysManager.allRelayers
      expect(preferredRelays.length).to.be.equal(1)
      expect(preferredRelays[0].relayUrl).to.be.equal('http://localhost:8090')
      expect(activeRelays.length).to.be.equal(3)
      expect(activeRelays[0].relayUrl).to.be.equal('http://localhost:8090')
      expect(activeRelays[1].relayUrl).to.be.equal('stakeAndAuthorization1')
      expect(activeRelays[2].relayUrl).to.be.equal('stakeAndAuthorization2')
    })

    it('should use \'relayFilter\' to remove unsuitable relays', async function () {
      const relayFilter = (registeredEventInfo: RelayRegisteredEventInfo): boolean => {
        return registeredEventInfo.relayUrl.includes('2')
      }
      const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, config, relayFilter)
      await knownRelaysManagerWithFilter.refresh()
      const relays = knownRelaysManagerWithFilter.allRelayers
      expect(relays.length).to.be.equal(1)
      expect(relays[0].relayUrl).to.be.equal('stakeAndAuthorization2')
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  describe('#getRelaysSortedForTransaction()', function () {
    const relayInfo = {
      relayManager: '',
      relayUrl: 'url'
    }

    describe('#_refreshFailures()', function () {
      let knownRelaysManager: KnownRelaysManager
      let lastErrorTime: number

      before(async function () {
        relayInfo.relayManager = accounts[0]
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
          expect(failures.length).to.be.equal(1)
        })
        knownRelaysManager._refreshFailures()
        // @ts-ignore
        expect(knownRelaysManager.relayFailures.get('url1').length).to.be.equal(0)
        // @ts-ignore
        expect(knownRelaysManager.relayFailures.get('url2').length).to.be.equal(0)
        // @ts-ignore
        expect(knownRelaysManager.relayFailures.get('url3')).to.deep.equal([{
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
        expect(knownRelaysManager.splitRange(1, 6, 1)).to.be.deep.equal(
          [{ fromBlock: 1, toBlock: 6 }])
      })
      it('split 2', () => {
        expect(knownRelaysManager.splitRange(1, 6, 2)).to.be.deep.equal(
          [{ fromBlock: 1, toBlock: 3 }, { fromBlock: 4, toBlock: 6 }])
      })
      it('split 2 odd', () => {
        expect(knownRelaysManager.splitRange(1, 7, 2)).to.be.deep.equal(
          [{ fromBlock: 1, toBlock: 4 }, { fromBlock: 5, toBlock: 7 }])
      })
      it('split 3', () => {
        expect(knownRelaysManager.splitRange(1, 9, 3)).to.be.deep.equal(
          [{ fromBlock: 1, toBlock: 3 }, { fromBlock: 4, toBlock: 6 }, { fromBlock: 7, toBlock: 9 }])
      })

      it('split 3 odd', () => {
        expect(knownRelaysManager.splitRange(1, 10, 3)).to.be.deep.equal(
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
          },
          decodeEvents (events: Event[]): any {
            return events
          }
        }
      })
      after(() => {
        (knownRelaysManager as any).contractInteractor = saveContractInteractor
      })

      it('should break large request into multiple chunks', async () => {
        (knownRelaysManager as any).relayLookupWindowParts = 1
        const ret = await knownRelaysManager.getPastEventsForHub(1, 300)
        expect((knownRelaysManager as any).relayLookupWindowParts).to.be.equal(4)
        expect(ret.length).to.be.equal(300)
        expect(ret[0]).to.be.deep.equal({ event: 'event1-1-75' })
        expect(ret[299]).to.be.deep.equal({ event: 'event300-226-300' })
      })
    })

    describe('DefaultRelayScore', function () {
      const failure = {
        lastErrorTime: 100,
        relayManager: 'rm3',
        relayUrl: 'url3'
      }
      it('should subtract penalty from a relay for each known failure', async function () {
        const relayScoreNoFailures = await DefaultRelayScore(relayInfo, transactionDetails, [])
        const relayScoreOneFailure = await DefaultRelayScore(relayInfo, transactionDetails, [failure])
        const relayScoreTenFailures = await DefaultRelayScore(relayInfo, transactionDetails, Array(10).fill(failure))

        expect(relayScoreNoFailures).is.above(relayScoreOneFailure)
        expect(relayScoreOneFailure).is.above(relayScoreTenFailures)
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
        contractInteractor, configure({ chainId: env.chainId }), undefined, biasedRelayScore)
      const activeRelays: RelayRegisteredEventInfo[] = [{
        relayManager: accounts[0],
        relayUrl: 'alex'
      }, {
        relayManager: accounts[0],
        relayUrl: 'joe'
      }, {
        relayManager: accounts[1],
        relayUrl: 'joe'
      }]
      sinon.stub(knownRelaysManager, 'allRelayers').value(activeRelays)
    })

    it('should use provided score calculation method to sort the known relays', async function () {
      const sortedRelays = (await knownRelaysManager.getRelaysSortedForTransaction(transactionDetails)) as RelayRegisteredEventInfo[][]
      expect(sortedRelays[1][0].relayUrl).to.be.equal('alex')
      // checking the relayers are sorted AND they cannot overshadow each other's url
      expect(sortedRelays[1][1].relayUrl).to.be.equal('joe')
      expect(sortedRelays[1][2].relayUrl).to.be.equal('joe')
    })
  })
})

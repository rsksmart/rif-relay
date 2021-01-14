// @ts-ignore

import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import HttpWrapper from '../../src/relayclient/HttpWrapper'
import sinonChai from 'sinon-chai'
import Web3 from 'web3'

import { configureServer } from '../../src/relayserver/ServerConfigParams'
import { getTestingEnvironment } from '../TestUtils'
import { GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { HttpProvider } from 'web3-core'
import { LocalhostOne, ServerTestEnvironment } from '../relayserver/ServerTestEnvironment'
import { BadEnvelopingArbiter } from '../dummies/BadEnvelopingArbiter'
import { EnvelopingArbiter } from '../../src/enveloping/EnvelopingArbiter'

const { assert } = chai.use(chaiAsPromised).use(sinonChai)

contract('EnvelopingArbiter', function (accounts) {
  let env: ServerTestEnvironment

  before(async function () {
    const relayClientConfig: Partial<GSNConfig> = {
      preferredRelays: [LocalhostOne],
      maxRelayNonceGap: 0,
      chainId: (await getTestingEnvironment()).chainId
    }

    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init(relayClientConfig)
    await env.newServerInstance()
    await env.clearServerStorage()
  })

  describe('#init()', function () {
    it('should initialize Fee Estimator on start', async function () {
      const env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
      await env.init({})
      assert.equal(env.envelopingArbiter.feeEstimator.initialized, true)
    })
  })

  describe('#getFeesTable()', function () {
    it('should return calculated fees table', async function () {
      const feesTable = await env.envelopingArbiter.getFeesTable()
      assert.isOk(feesTable, 'feesTable is ok')
    })
  })

  describe('#getQueueWorker()', function () {
    it('should return the Worker Tier 2 address by default if no MaxTime specified', async function () {
      const workerTier2Address = env.relayServer.workerAddress[1]
      const selectedWorkerAddress = env.envelopingArbiter.getQueueWorker(env.relayServer.workerAddress)
      assert.equal(workerTier2Address, selectedWorkerAddress)
    })

    it('should return the Worker Tier 2 address by default if an invalid MaxTime is specified', async function () {
      const workerTier2Address = env.relayServer.workerAddress[1]
      const selectedWorkerAddress = env.envelopingArbiter.getQueueWorker(env.relayServer.workerAddress, '10')
      assert.equal(workerTier2Address, selectedWorkerAddress)
    })
  })

  describe('#getQueueGasPrice()', function () {
    it('should return the standard gas price by default if no MaxTime specified', async function () {
      const standardGasPrice = (await env.envelopingArbiter.getFeesTable()).standard
      const selectedGasPrice = parseFloat(await env.envelopingArbiter.getQueueGasPrice())
      assert.equal(standardGasPrice, selectedGasPrice)
    })

    it('should return the standard gas price by default if an invalid MaxTime is specified', async function () {
      const standardGasPrice = (await env.envelopingArbiter.getFeesTable()).standard
      const selectedGasPrice = parseFloat(await env.envelopingArbiter.getQueueGasPrice('20'))
      assert.equal(standardGasPrice, selectedGasPrice)
    })
  })

  describe('validations before commitment signing', function () {
    it('should return error if a Relay Client doesn\'t send a valid maxTime value to Relay Server', async function () {
      try {
        await env.relayTransaction(true, {}, false)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Error: invalid maxTime.')
      }
    })

    it('should return error if a Relay Client doesn\'t send a valid relay worker/maxTime combination to Relay Server', async function () {
      try {
        await env.relayTransaction(true, {}, true, false)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Error: invalid workerAddress/maxTime combination.')
      }
    })

    it('should return error if the commitment signing is invalid (server check)', async function () {
      const origEnvelopingArbiter = env.relayServer.envelopingArbiter
      try {
        env.relayServer.envelopingArbiter = new BadEnvelopingArbiter(configureServer({}), env.provider, true)
        await env.relayTransaction()
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Error: Invalid receipt. Worker signature invalid.')
      } finally {
        env.relayServer.envelopingArbiter = origEnvelopingArbiter
      }
    })

    it('should relay a transaction if the request is valid', async function () {
      await env.relayTransaction(true)
    })
  })

  describe('NonceQueueSelector', function () {
    it('should relay transactions using multiple workers', async function () {
      const tx1 = await env.relayTransaction(true, {}, true, true, 0)
      const tx2 = await env.relayTransaction(true, {}, true, true, 1)
      const tx3 = await env.relayTransaction(true, {}, true, true, 2)
      const tx4 = await env.relayTransaction(true, {}, true, true, 3)
      assert.notEqual(tx1.signedReceipt?.workerAddress, tx2.signedReceipt?.workerAddress)
      assert.notEqual(tx1.signedReceipt?.workerAddress, tx3.signedReceipt?.workerAddress)
      assert.notEqual(tx1.signedReceipt?.workerAddress, tx4.signedReceipt?.workerAddress)
      assert.notEqual(tx2.signedReceipt?.workerAddress, tx3.signedReceipt?.workerAddress)
      assert.notEqual(tx2.signedReceipt?.workerAddress, tx4.signedReceipt?.workerAddress)
      assert.notEqual(tx3.signedReceipt?.workerAddress, tx4.signedReceipt?.workerAddress)
    })
  })

  describe('FeeEstimator', function () {
    it('should estimate gas prices correctly on Ethereum Mainnet based on deviation margin against other gas estimators APIs', async function () {
      const deviationMargin = 10
      const ethMainnet = new Web3.providers.HttpProvider('https://mainnet.infura.io/v3/f40be2b1a3914db682491dc62a19ad43')
      const httpWrapper = new HttpWrapper()
      env.envelopingArbiter.feeEstimator.stop()
      env.envelopingArbiter = new EnvelopingArbiter(configureServer({
        checkInterval: 10000
      }), ethMainnet)
      await env.envelopingArbiter.start()
      // First, read every gas api and make a table.
      // Each row represents a distinct API service: Etherscan = 0, Etherchain = 1,
      // EthGasStation = 2, MyCrypto = 3, PoA = 4, Upvest = 5
      // The columns represents the delays: low = 0, standard = 1, fast = 2 and instant = 3.
      // For example: table[0][0] will contain the low gas price of Etherscan.
      const table = []
      const margins = []
      const etherscanResponse = (await httpWrapper.sendPromise('https://api.etherscan.io/api?module=gastracker&action=gasoracle')).result
      table.push([
        parseInt(etherscanResponse.SafeGasPrice),
        parseInt(etherscanResponse.ProposeGasPrice),
        null,
        parseInt(etherscanResponse.FastGasPrice)
      ])
      const etherchainResponse = await httpWrapper.sendPromise('https://etherchain.org/api/gasPriceOracle')
      table.push([
        Math.round(etherchainResponse.safeLow),
        Math.round(etherchainResponse.standard),
        Math.round(etherchainResponse.fast),
        Math.round(etherchainResponse.fastest)
      ])
      const ethgasstationResponse = await httpWrapper.sendPromise('https://ethgasstation.info/api/ethgasAPI.json?api-key=4936ca9f3ce0dd8554832c21849aa17fdc627e8083f895da2f333ff2b297')
      table.push([
        ethgasstationResponse.safeLow / 10,
        ethgasstationResponse.average / 10,
        ethgasstationResponse.fast / 10,
        ethgasstationResponse.fastest / 10
      ])
      const mycryptoResponse = await httpWrapper.sendPromise('https://gas.mycryptoapi.com/')
      table.push([
        mycryptoResponse.safeLow,
        mycryptoResponse.standard,
        mycryptoResponse.fast,
        mycryptoResponse.fastest
      ])
      const poaResponse = await httpWrapper.sendPromise('https://gasprice.poa.network/')
      table.push([
        Math.round(poaResponse.slow),
        Math.round(poaResponse.standard),
        Math.round(poaResponse.fast),
        Math.round(poaResponse.instant)
      ])
      const upvestResponse = (await httpWrapper.sendPromise('https://fees.upvest.co/estimate_eth_fees')).estimates
      table.push([
        Math.round(upvestResponse.slow),
        Math.round(upvestResponse.medium),
        Math.round(upvestResponse.fast),
        Math.round(upvestResponse.fastest)
      ])
      // Read the fees table from Fee Estimator and calculate the lower and upper margins using deviationMargin
      // Create another table that contains the calculated valid margins and the original value,
      // low margin = 0, original value = 1, higher margin = 2
      // Each row represents each delay: safeLow = 0, standard = 1, fast = 2, fastest = 3
      const feesTable = await env.envelopingArbiter.getFeesTable()
      margins.push([
        Math.round(feesTable.safeLow - (feesTable.safeLow * deviationMargin / 100)),
        Math.round(feesTable.safeLow),
        Math.round(feesTable.safeLow + (feesTable.safeLow * deviationMargin / 100))
      ])
      margins.push([
        Math.round(feesTable.standard - (feesTable.standard * deviationMargin / 100)),
        Math.round(feesTable.standard),
        Math.round(feesTable.standard + (feesTable.standard * deviationMargin / 100))
      ])
      margins.push([
        Math.round(feesTable.fast - (feesTable.fast * deviationMargin / 100)),
        Math.round(feesTable.fast),
        Math.round(feesTable.fast + (feesTable.fast * deviationMargin / 100))
      ])
      margins.push([
        Math.round(feesTable.fastest - (feesTable.fastest * deviationMargin / 100)),
        Math.round(feesTable.fastest),
        Math.round(feesTable.fastest + (feesTable.fastest * deviationMargin / 100))
      ])
      let correctValues = 0
      for (let x = 0; x < 6; x++) {
        for (let y = 0; y < 4; y++) {
          // skip the fast equivalent price of the first row (etherscan) because it doesn't have one
          if (x === 0 && y === 2) {
            continue
          } else {
            // compare that values are between the lower and higher margins
            if (table[x][y] >= margins[y][0] && table[x][y] <= margins[y][2]) {
              correctValues++
              // if gas price is outside margin but Fee Estimator calculated price is cheaper,
              // consider it also correct
            } else if (margins[y][1] < table[x][y]) {
              correctValues++
            }
          }
        }
      }
      const rate = parseInt((correctValues * 100 / 23).toString())
      console.log(`${rate}% correct values with ${deviationMargin}% deviation margin`)
      // minimum of 80% correct values is good enough
      assert.isAbove(rate, 80, 'the accurate prediction rate is above 80 percent')
    })
  })
})

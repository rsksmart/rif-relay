import { getLocalEip712Signature, removeHexPrefix } from '../src/common/Utils'
import { RelayRequest, cloneRelayRequest, DeployRequest } from '../src/common/EIP712/RelayRequest'
import { Environment } from '../src/common/Environments'
import TypedRequestData, { getDomainSeparatorHash, TypedDeployRequestData } from '../src/common/EIP712/TypedRequestData'
import { stripHex, deployHub, getTestingEnvironment, createSmartWallet, getGaslessAccount, createSmartWalletFactory } from './TestUtils'

import { AccountKeypair } from '../src/relayclient/AccountManager'
import { constants } from '../src/common/Constants'
import { SmartWallet, IForwarder, Penalizer, Penalizer__factory, RelayHub, SmartWalletFactory, SmartWallet__factory, TestDeployVerifierConfigurableMisbehavior__factory, TestDeployVerifierConfigurableMisbehavior, TestDeployVerifierEverythingAccepted, TestVerifierConfigurableMisbehavior, TestDeployVerifierEverythingAccepted__factory, TestRecipient, TestRecipient__factory, TestToken, TestVerifierConfigurableMisbehavior__factory, TestVerifierEverythingAccepted, TestVerifierEverythingAccepted__factory, TestToken__factory, TestRelayWorkerContract__factory } from '../typechain'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'



// // @ts-ignore
// abiDecoder.addABI(TestRecipient.abi)
// abiDecoder.addABI(walletFactoryAbi)
// abiDecoder.addABI(relayHubAbi)

describe('RelayHub', () => {
  let chainId: number
  let relayHub: string
  let penalizer: Penalizer
  let relayHubInstance: RelayHub
  let recipientContract: TestRecipient
  let verifierContract: TestVerifierEverythingAccepted
  let deployVerifierContract: TestDeployVerifierEverythingAccepted
  let forwarderInstance: IForwarder
  let target: string
  let verifier: string
  let forwarder: string
  let gaslessAccount: AccountKeypair
  const gasLimit = '1000000'
  const gasPrice = '1'
  const parametersGasOverhead = BigInt(40921)
  let sharedRelayRequestData: RelayRequest
  let sharedDeployRequestData: DeployRequest
  let env: Environment
  let token: TestToken
  let factory: SmartWalletFactory
  let SmartWallet: SmartWallet__factory
  let Penalizer: Penalizer__factory
  let TestVerifierEverythingAccepted: TestVerifierEverythingAccepted__factory
  let TestDeployVerifierEverythingAccepted: TestDeployVerifierEverythingAccepted__factory
  let TestRecipient: TestRecipient__factory
  let TestVerifierConfigurableMisbehavior: TestVerifierConfigurableMisbehavior__factory
  let TestDeployVerifierConfigurableMisbehavior: TestDeployVerifierConfigurableMisbehavior__factory
  let relayManagerSigner: SignerWithAddress
  let relayOwnerSigner: SignerWithAddress
  let relayWorkerSigner: SignerWithAddress
  let incorrectWorkerSigner: SignerWithAddress
  let incorrectRelayManagerSigner: SignerWithAddress
  let anAccountSigner : SignerWithAddress
  let relayOwner: string
  let relayWorker: string
  let incorrectWorker: string
  let relayManager: string 
  let incorrectRelayManager: string
  let anAccount : string
  
  before(async () => {      
      SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
      Penalizer = await ethers.getContractFactory('Penalizer') as Penalizer__factory
      TestVerifierEverythingAccepted = await ethers.getContractFactory('TestVerifierEverythingAccepted') as TestVerifierEverythingAccepted__factory
      TestDeployVerifierEverythingAccepted = await ethers.getContractFactory('TestDeployVerifierEverythingAccepted') as TestDeployVerifierEverythingAccepted__factory
      TestRecipient = await ethers.getContractFactory('TestRecipient') as TestRecipient__factory
      TestVerifierConfigurableMisbehavior = await ethers.getContractFactory('TestVerifierConfigurableMisbehavior') as TestVerifierConfigurableMisbehavior__factory
      TestDeployVerifierConfigurableMisbehavior = await ethers.getContractFactory('TestDeployVerifierConfigurableMisbehavior') as TestDeployVerifierConfigurableMisbehavior__factory

      [anAccountSigner, relayManagerSigner, relayOwnerSigner, relayWorkerSigner, 
        incorrectWorkerSigner, incorrectRelayManagerSigner] = await ethers.getSigners()
        relayManager = await relayManagerSigner.getAddress()
        relayOwner = await relayOwnerSigner.getAddress()
        relayWorker = await relayWorkerSigner.getAddress()
        incorrectWorker = await incorrectWorkerSigner.getAddress()
        incorrectRelayManager = await incorrectRelayManagerSigner.getAddress()
        anAccount = await anAccountSigner.getAddress()
  })

  describe('add/disable relay workers', function () {
    beforeEach(async function () {
      env = await getTestingEnvironment()
      chainId = env.chainId

      penalizer = await Penalizer.deploy()
      await penalizer.deployed()
      relayHubInstance = await deployHub(penalizer.address)
      verifierContract = await TestVerifierEverythingAccepted.deploy()
      await verifierContract.deployed()
      deployVerifierContract = await TestDeployVerifierEverythingAccepted.deploy()
      await deployVerifierContract.deployed()
      gaslessAccount = await getGaslessAccount()

      const smartWalletTemplate: SmartWallet = await SmartWallet.deploy()
      await smartWalletTemplate.deployed()
      factory = await createSmartWalletFactory(smartWalletTemplate)
      recipientContract = await TestRecipient.deploy()
      await recipientContract.deployed()
      const TestToken = await ethers.getContractFactory("TestToken") as TestToken__factory
      token = await TestToken.deploy()
      await token.deployed()
      target = recipientContract.address
      verifier = verifierContract.address
      relayHub = relayHubInstance.address
      forwarderInstance = await createSmartWallet(anAccount, gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
      forwarder = forwarderInstance.address
      await token.mint('1000', forwarder)

      sharedRelayRequestData = {
        request: {
          relayHub: relayHub,
          to: target,
          data: '',
          from: gaslessAccount.address,
          nonce: (await forwarderInstance.nonce()).toString(),
          value: '0',
          gas: gasLimit,
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000'
        },
        relayData: {
          gasPrice,
          relayWorker,
          callForwarder: forwarder,
          callVerifier: verifier,
          domainSeparator: getDomainSeparatorHash(forwarder, chainId)
        }
      }
    })

    it('should register and allow to disable new relay workers', async function () {
      await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
        value: ethers.utils.parseEther('1'),
      })

      const relayWorkersBefore = await relayHubInstance.workerCount(relayManager)
      expect(relayWorkersBefore).to.be.equal(0, `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`) 

    await expect(relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker])).to.emit(relayHubInstance, 'RelayWorkersAdded')
    .withArgs(relayManager,
      [relayWorker], 
      BigNumber.from(1))

    //   let txResponse = await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
    //   let receipt = await web3.eth.getTransactionReceipt(txResponse.tx)
    //   let logs = abiDecoder.decodeLogs(receipt.logs)
    //   const relayWorkersAddedEvent = logs.find((e: any) => e != null && e.name === 'RelayWorkersAdded')
    //   assert.equal(relayManager.toLowerCase(), relayWorkersAddedEvent.events[0].value.toLowerCase())
    //   assert.equal(relayWorker.toLowerCase(), relayWorkersAddedEvent.events[1].value[0].toLowerCase())
    //   assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value)

      let relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      expect(relayWorkersAfter.toNumber()).to.be.equal(1, 'Workers must be one')

      let manager = await relayHubInstance.workerToManager(relayWorker)
      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

      expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

      await expect(relayHubInstance.connect(relayManagerSigner).disableRelayWorkers([relayWorker])).to.emit(relayHubInstance, 'RelayWorkersDisabled')
      .withArgs(relayManager,
        [relayWorker], 
        BigNumber.from(0))

    //   txResponse = await relayHubInstance.disableRelayWorkers([relayWorker], { from: relayManager })
    //   receipt = await web3.eth.getTransactionReceipt(txResponse.tx)
    //   logs = abiDecoder.decodeLogs(receipt.logs)
    //   const relayWorkersDisabledEvent = logs.find((e: any) => e != null && e.name === 'RelayWorkersDisabled')
    //   assert.equal(relayManager.toLowerCase(), relayWorkersDisabledEvent.events[0].value.toLowerCase())
    //   assert.equal(relayWorker.toLowerCase(), relayWorkersDisabledEvent.events[1].value[0].toLowerCase())
    //   assert.equal(toBN(0), relayWorkersDisabledEvent.events[2].value)

      relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      expect(relayWorkersAfter.toNumber()).to.be.equal(0, 'Workers must be zero')

      manager = await relayHubInstance.workerToManager(relayWorker)
      expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('0')))
      expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)
    })

    it('should fail to disable more relay workers than available', async function () {
      await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
        value: ethers.utils.parseEther('1'),
      })

      const relayWorkersBefore = await relayHubInstance.workerCount(relayManager)
      expect(relayWorkersBefore.toNumber()).to.be.equal(0, `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`)

      await expect(relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker]))
      .to.emit(relayHubInstance, 'RelayWorkersAdded').withArgs(
        relayManager,
        [relayWorker],
        BigNumber.from(1)
      )
      // const txResponse = await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })

      // const receipt = await web3.eth.getTransactionReceipt(txResponse.tx)
      // const logs = abiDecoder.decodeLogs(receipt.logs)

      // const relayWorkersAddedEvent = logs.find((e: any) => e != null && e.name === 'RelayWorkersAdded')
      // assert.equal(relayManager.toLowerCase(), relayWorkersAddedEvent.events[0].value.toLowerCase())
      // assert.equal(relayWorker.toLowerCase(), relayWorkersAddedEvent.events[1].value[0].toLowerCase())
      // assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value)

      let relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      expect(relayWorkersAfter.toNumber()).to.be.equal(1, 'Workers must be one')

      let manager = await relayHubInstance.workerToManager(relayWorker)
      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

      expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

      await expect(
        relayHubInstance.connect(relayManagerSigner).disableRelayWorkers([relayWorker, relayWorker])).to.revertedWith('revert invalid quantity of workers')

      relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      expect(relayWorkersAfter.toNumber()).to.be.equal(1, 'Workers must be one')

      manager = await relayHubInstance.workerToManager(relayWorker)
      expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))
      expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)
    })

    it('should only allow the corresponding relay manager to disable their respective relay workers', async function () {
      await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
        value: ethers.utils.parseEther('1')
      })

      await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(incorrectRelayManager, 1000, {
        value: ethers.utils.parseEther('1')
      })

      const relayWorkersBefore = await relayHubInstance.workerCount(relayManager)
      const relayWorkersBefore2 = await relayHubInstance.workerCount(incorrectRelayManager)
      expect(relayWorkersBefore.toNumber()).to.be.equal(0,
      `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`)
      expect(relayWorkersBefore2.toNumber()).to.be.equal(0,
      `Initial workers must be zero but was ${relayWorkersBefore2.toNumber()}`)

      await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker])
      await relayHubInstance.connect(incorrectRelayManagerSigner).addRelayWorkers([incorrectWorker])

      const relayWorkersAfter = await relayHubInstance.workerCount(relayManager)
      let relayWorkersAfter2 = await relayHubInstance.workerCount(incorrectRelayManager)

      expect(relayWorkersAfter.toNumber()).to.be.equal(1, 'Workers must be one')
      expect(relayWorkersAfter2.toNumber()).to.be.equal(1, 'Workers must be one')

      let manager = await relayHubInstance.workerToManager(relayWorker)
      let manager2 = await relayHubInstance.workerToManager(incorrectWorker)

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))
      let expectedManager2 = '0x00000000000000000000000'.concat(stripHex(incorrectRelayManager.concat('1')))

      expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)
      expect(manager2.toLowerCase()).to.be.equal(expectedManager2.toLowerCase(), `Incorrect relay manager: ${manager2}`)

      await expect(
        relayHubInstance.connect(incorrectRelayManagerSigner).disableRelayWorkers([relayWorker])).to.revertedWith(
        'revert Incorrect Manager')

      relayWorkersAfter2 = await relayHubInstance.workerCount(incorrectRelayManager)
      expect(relayWorkersAfter2.toNumber()).to.be.equal(1, "Workers shouldn't have changed")

      manager = await relayHubInstance.workerToManager(relayWorker)
      expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))
      expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

      manager2 = await relayHubInstance.workerToManager(incorrectWorker)
      expectedManager2 = '0x00000000000000000000000'.concat(stripHex(incorrectRelayManager.concat('1')))
      expect(manager2.toLowerCase()).to.be.equal(expectedManager2.toLowerCase(), `Incorrect relay manager: ${manager2}`)
    })
  })

  describe('relayCall', function () {
    beforeEach(async function () {
      env = await getTestingEnvironment()
      chainId = env.chainId

      penalizer = await Penalizer.deploy()
      await penalizer.deployed()
      relayHubInstance = await deployHub(penalizer.address)
      verifierContract = await TestVerifierEverythingAccepted.deploy()
      await verifierContract.deployed()
      deployVerifierContract = await TestDeployVerifierEverythingAccepted.deploy()
      deployVerifierContract.deployed()
      gaslessAccount = await getGaslessAccount()

      const smartWalletTemplate: SmartWallet = await SmartWallet.deploy()
      await smartWalletTemplate.deployed()
      factory = await createSmartWalletFactory(smartWalletTemplate)
      recipientContract = await TestRecipient.deploy()
      await recipientContract.deployed()
      
      const TestToken = await ethers.getContractFactory("TestToken") as TestToken__factory
      token = await TestToken.deploy()
      await token.deployed()
      target = recipientContract.address
      verifier = verifierContract.address
      relayHub = relayHubInstance.address

      forwarderInstance = await createSmartWallet(anAccount, gaslessAccount.address, factory, gaslessAccount.privateKey, chainId)
      forwarder = forwarderInstance.address
      await token.mint('1000', forwarder)

      sharedRelayRequestData = {
        request: {
          relayHub: relayHub,
          to: target,
          data: '',
          from: gaslessAccount.address,
          nonce: (await forwarderInstance.nonce()).toString(),
          value: '0',
          gas: gasLimit,
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000'
        },
        relayData: {
          gasPrice,
          relayWorker,
          callForwarder: forwarder,
          callVerifier: verifier,
          domainSeparator: getDomainSeparatorHash(forwarder, chainId)
        }
      }
    })

    it('should retrieve version number', async function () {
      const version = await relayHubInstance.versionHub()
      expect(version).to.match(/2\.\d*\.\d*-?.*\+enveloping\.hub\.irelayhub/)
    })

    // TODO review gasPrice for RSK
    context('with unknown worker', function () {
      const signature = '0xdeadbeef'
      const gasLimit = 4e6
      let relayRequest: RelayRequest
      beforeEach(async function () {
        relayRequest = cloneRelayRequest(sharedRelayRequestData)
        relayRequest.request.data = '0xdeadbeef'
      })

      it('should not accept a relay call', async function () {
        await expect(
          relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequest, signature, {
            gasLimit
          })).to.revertedWith(
          'revert Not an enabled worker')
      })

      context('with manager stake unlocked', function () {
        beforeEach(async function () {
          await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
            value: ethers.utils.parseEther('1')
          })
          await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker])
        })
        //TODO: Check signature
        it('should not accept a relay call', async function () {
          await expect(
            relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequest, signature, {
              gasLimit
            })).to.reverted
            .to.reverted
            // With(
            // 'revert relay manager not staked')
        })
      })
    })

    context('with staked and registered relay', function () {
      const url = 'http://relay.com'
      const message = 'Enveloping RelayHub'
      const messageWithNoParams = 'Method with no parameters'

      let relayRequest: RelayRequest
      let encodedFunction: string
      let signatureWithPermissiveVerifier: string

      beforeEach(async function () {
        await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
          value: ethers.utils.parseEther('2')
        })

        // truffle-contract doesn't let us create method data from the class, we need an actual instance
        // encodedFunction = recipientContract.contract.methods.emitMessage(message).encodeABI()
        encodedFunction = (await recipientContract.populateTransaction.emitMessage(message)).data?? ''

        await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker])
        await relayHubInstance.connect(relayManagerSigner).registerRelayServer(url)
        relayRequest = cloneRelayRequest(sharedRelayRequestData)
        relayRequest.request.data = encodedFunction

        const dataToSign = new TypedRequestData(
          chainId,
          forwarder,
          relayRequest
        )
        signatureWithPermissiveVerifier = getLocalEip712Signature(
          dataToSign,
          gaslessAccount.privateKey
        )
      })

      context('with relay worker that is not externally-owned account', function () {
        it('should not accept relay requests', async function () {
          const signature = '0xdeadbeef'
          const gasLimit = 4e6
          // const TestRelayWorkerContract = artifacts.require('TestRelayWorkerContract')

          const TestRelayWorkerContract = await ethers.getContractFactory("TestRelayWorkerContract") as TestRelayWorkerContract__factory
          const testRelayWorkerContract = await TestRelayWorkerContract.deploy()
          await testRelayWorkerContract.deployed()

          // const testRelayWorkerContract = await TestRelayWorkerContract.new()
          await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([testRelayWorkerContract.address])
          await expect(
            testRelayWorkerContract.relayCall(
              relayHubInstance.address,
              relayRequest,
              signature,
              {
                gasLimit
              })).to.be.revertedWith(
            'revert RelayWorker cannot be a contract')
        })
      })
      context('with view functions only', function () {
        let misbehavingVerifier: TestVerifierConfigurableMisbehavior
        let relayRequestMisbehavingVerifier: RelayRequest

        beforeEach(async function () {
          misbehavingVerifier = await TestVerifierConfigurableMisbehavior.deploy()
          await misbehavingVerifier.deployed()
          relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
        })

        // TODO re-enable re-edit
        it.skip('should get \'verifierAccepted = true\' and no revert reason as view call result of \'relayCall\' for a valid transaction', async function () {
        //   const tx = await relayHubInstance.connect(relayWorkerSigner).populateTransaction.relayCall(
        //     relayRequest,
        //     signatureWithPermissiveVerifier, {
        //       gasLimit: 7e6
        //     })
        //     let result = await ethers.provider.call(tx)
        //     const ret = relayHubInstance.interface.encodeFunctionResult(result)
  
        //   // The smart wallet should be still initialized
        //   expect(BigNumber.from(1)).to.be.equal(BigNumber.from(resultStr))
          
        //   // assert.equal(relayCallView.returnValue, null)
        //   // assert.equal(relayCallView.verifierAccepted, true)
        })

        // TODO re-enable re-edit
        it.skip('should get Verifier\'s reject reason from view call result of \'relayCall\' for a transaction with a wrong signature', async function () {
        //   await misbehavingVerifier.setReturnInvalidErrorCode(true)
        //   const tx =
        //     await relayHubInstance.connect(relayWorkerSigner).populateTransaction
        //       .relayCall(relayRequestMisbehavingVerifier, '0x')
        //     let result = await ethers.provider.call(tx)
        //     const ret = relayHubInstance.interface.encodeFunctionResult(result)
        //    expect(relayHubInstance.interface.encodeFunctionResult(result)).
        //   // assert.equal(relayCallView.verifierAccepted, false)
        //   // assert.equal(relayCallView.returnValue, encodeRevertReason('invalid code'))
        //   // assert.equal(decodeRevertReason(relayCallView.returnValue), 'invalid code')
        })
      })

      context('with funded verifier', function () {
        let signature

        let misbehavingVerifier: TestVerifierConfigurableMisbehavior

        let signatureWithMisbehavingVerifier: string
        let relayRequestMisbehavingVerifier: RelayRequest
        const gasLimit = 4e6

        beforeEach(async function () {
          misbehavingVerifier = await TestVerifierConfigurableMisbehavior.deploy()
          await misbehavingVerifier.deployed()

          let dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          )

          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address

          dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestMisbehavingVerifier
          )
          signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
        })

        it('gas estimation tests for SmartWallet', async function () {
          const SmartWallet = await ethers.getContractFactory("SmartWallet") as SmartWallet__factory
          const smartWalletTemplate: SmartWallet = await SmartWallet.deploy()
          await smartWalletTemplate.deployed()
          
          const smartWalletFactory: SmartWalletFactory = await createSmartWalletFactory(smartWalletTemplate)
          const sWalletInstance = await createSmartWallet(anAccount, gaslessAccount.address, smartWalletFactory, gaslessAccount.privateKey, chainId)

          const nonceBefore = await sWalletInstance.nonce()
          await token.mint('10000', sWalletInstance.address)

          const completeReq: RelayRequest = cloneRelayRequest(sharedRelayRequestData)

          completeReq.request.data = (await recipientContract.populateTransaction.emitMessage2(message)).data?? ''
          completeReq.request.nonce = nonceBefore.toString()
          completeReq.relayData.callForwarder = sWalletInstance.address
          completeReq.relayData.domainSeparator = getDomainSeparatorHash(sWalletInstance.address, chainId)

          const reqToSign = new TypedRequestData(
            chainId,
            sWalletInstance.address,
            completeReq
          )

          const sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey
          )

          const tx  = await relayHubInstance.connect(relayWorkerSigner).relayCall(completeReq, sig, {
            gasLimit,
            gasPrice
          })


          const nonceAfter = await sWalletInstance.nonce()
          expect(nonceBefore.add(1)).to.be.equal(nonceAfter, 'Incorrect nonce after execution')
          const eventHash =  ethers.utils.id('GasUsed(uint256,uint256)')
          const txReceipt = await tx.wait()
          const logs = txReceipt.logs
          console.log('---------------SmartWallet: RelayCall metrics------------------------')
          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed.toNumber()}`)

          let previousGas: BigInt = BigInt(0)
          let previousStep = null
          for (var i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i]
            if (eventHash.toString() === log.topics[0]) {
               const step = log.data.substring(0, 66)
               const gasUsed: BigInt = BigInt('0x' + log.data.substring(67, log.data.length))
               console.log('---------------------------------------')
               console.log('step :', BigInt(step).toString())
               console.log('gasLeft :', gasUsed.toString())

               if (previousStep != null) {
                 console.log(`Steps substraction ${BigInt(step).toString()} and ${BigInt(previousStep).toString()}`)
                 console.log((previousGas.valueOf() - gasUsed.valueOf()).toString())
               }
               console.log('---------------------------------------')

               previousGas = BigInt(gasUsed)
               previousStep = step
            }
          }

          const event = recipientContract.filters.SampleRecipientEmitted(null, null, null, null, null)
          const eventEmitted = await recipientContract.queryFilter(event)

          expect(message).to.be.equal(eventEmitted[0].args.message)
          expect(sWalletInstance.address.toLowerCase()).to.be.equal(eventEmitted[0].args.msgSender.toLowerCase())
          expect(relayWorker.toLowerCase()).to.be.equal(eventEmitted[0].args.origin.toLowerCase())

          const transactionRelayedEvent = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')

          expect(transactionRelayedEvent).is.not.null

          const callWithoutRelayTx = await recipientContract.emitMessage2(message)
          const callWithoutRelayReceipt = await callWithoutRelayTx.wait()
          const gasUsed: BigNumber = callWithoutRelayReceipt.cumulativeGasUsed
          // const txReceiptWithoutRelay = await web3.eth.getTransactionReceipt(callWithoutRelay)
          console.log('--------------- Destination Call Without enveloping------------------------')
          console.log(`Cummulative Gas Used: ${gasUsed}`)
          console.log('---------------------------------------')
          console.log('--------------- Enveloping Overhead ------------------------')
          console.log(`Overhead Gas: ${txReceipt.cumulativeGasUsed.sub(gasUsed).toNumber()}`)
          console.log('---------------------------------------')
        })

        it('gas estimation tests', async function () {
          const nonceBefore = await forwarderInstance.nonce()
          const TestToken = await ethers.getContractFactory("TestToken") as TestToken__factory
          const tokenInstance = await TestToken.deploy()
          await tokenInstance.deployed()
          await tokenInstance.mint('1000000', forwarder)
          const completeReq = {
            request: {
              ...relayRequest.request,
              data: (await recipientContract.populateTransaction.emitMessage2(message)).data?? '',
              nonce: nonceBefore.toString(),
              tokenContract: tokenInstance.address,
              tokenAmount: '1',
              tokenGas: '50000'
            },
            relayData: {
              ...relayRequest.relayData
            }
          }

          const reqToSign = new TypedRequestData(
            chainId,
            forwarder,
            completeReq
          )

          const sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey
          )

          const tx = await relayHubInstance.connect(relayWorkerSigner).relayCall(completeReq, sig, {
            gasLimit,
            gasPrice
          })

          const nonceAfter = await forwarderInstance.nonce()
          expect(nonceBefore.add(1)).to.be.equal(nonceAfter)

          const eventHash = ethers.utils.id('GasUsed(uint256,uint256)')
          const txReceipt = await tx.wait()
          console.log('---------------------------------------')

          console.log(`Gas Used: ${txReceipt.gasUsed}`)
          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`)

          let previousGas: BigInt = BigInt(0)
          let previousStep = null
          for (var i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i]
            if ((eventHash.toString()) === log.topics[0]) {
              const step = log.data.substring(0, 66)
              const gasUsed: BigInt = BigInt('0x' + log.data.substring(67, log.data.length))
              console.log('---------------------------------------')
              console.log('step :', BigInt(step).toString())
              console.log('gasLeft :', gasUsed.toString())

              if (previousStep != null) {
                console.log(`Steps substraction ${BigInt(step).toString()} and ${BigInt(previousStep).toString()}`)
                console.log((previousGas.valueOf() - gasUsed.valueOf()).toString())
              }
              console.log('---------------------------------------')

              previousGas = BigInt(gasUsed)
              previousStep = step
            }
          }

          const logs = txReceipt.logs
          // const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')
          const event = recipientContract.filters.SampleRecipientEmitted(null, null, null, null, null)
          const eventEmitted = await recipientContract.queryFilter(event)

          expect(message).to.be.equal(eventEmitted[0].args.message)
          expect(forwarder.toLowerCase()).to.be.equal(eventEmitted[0].args.msgSender.toLowerCase())
          expect(relayWorker.toLowerCase()).to.be.equal(eventEmitted[0].args.origin.toLowerCase())

          const transactionRelayedEvent = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')

          expect(transactionRelayedEvent).is.not.null
        })

        it('should fail to relay if the worker has been disabled', async function () {
          let manager = await relayHubInstance.workerToManager(relayWorker)
          // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
          let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

          expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await relayHubInstance.connect(relayManagerSigner).disableRelayWorkers([relayWorker])
          manager = await relayHubInstance.workerToManager(relayWorker)
          expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('0')))
          //
          expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await expect(
            relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequest, signatureWithPermissiveVerifier, {
              gasLimit,
              gasPrice
            })).to.revertedWith(
            'Not an enabled worker')
        })

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await forwarderInstance.nonce()
          const msgValue = 0
          const balance = 0
          
          await expect(relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequest, signatureWithPermissiveVerifier, {
            gasLimit,
            gasPrice
          })).to.emit(relayHubInstance, 'TransactionRelayed').and.to.emit(recipientContract, 'SampleRecipientEmitted')
          .withArgs(
            message,
            forwarder,
            relayWorker,
            msgValue,
            balance
          )

          const nonceAfter = await forwarderInstance.nonce()
          expect(nonceBefore.add(1)).to.be.equal(nonceAfter)

          // const receipt = await web3.eth.getTransactionReceipt(tx)
          // const logs = abiDecoder.decodeLogs(receipt.logs)
          // const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          // assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          // assert.equal(forwarder.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
          // assert.equal(relayWorker.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())

          // const transactionRelayedEvent = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')

          // assert.isNotNull(transactionRelayedEvent)
        })

        it('relayCall should refuse to re-send transaction with same nonce', async function () {
          await expect(relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequest, signatureWithPermissiveVerifier, {
            gasLimit,
            gasPrice
          })).to.emit(recipientContract, 'SampleRecipientEmitted')

          // const receipt = await web3.eth.getTransactionReceipt(tx)
          // const logs = abiDecoder.decodeLogs(receipt.logs)
          // const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          // assert.isNotNull(sampleRecipientEmittedEvent)

          await expect(
            relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequest, signatureWithPermissiveVerifier, {
              gasLimit,
              gasPrice
            })).to.revertedWith(
            'nonce mismatch')
        })
        // This test is added due to a regression that almost slipped to production.
        it('relayCall executes the transaction with no parameters', async function () {
          const msgValue = 0
          const balance = 0
          const encodedFunction = (await recipientContract.populateTransaction.emitMessageNoParams()).data?? ''
          const relayRequestNoCallData = cloneRelayRequest(relayRequest)
          relayRequestNoCallData.request.data = encodedFunction
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestNoCallData
          )
          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )

          await expect(relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequestNoCallData, signature, {
            gasLimit,
            gasPrice
          })).to.emit(recipientContract, 'SampleRecipientEmitted').withArgs(
            messageWithNoParams,
            forwarder,
            relayWorker,
            msgValue,
            balance
          )

          // const receipt = await web3.eth.getTransactionReceipt(tx)
          // const logs = abiDecoder.decodeLogs(receipt.logs)
          // const sampleRecipientEmittedEvent = logs.find((e: any) => e != null && e.name === 'SampleRecipientEmitted')

          // assert.equal(messageWithNoParams, sampleRecipientEmittedEvent.events[0].value)
          // assert.equal(forwarder.toLowerCase(), sampleRecipientEmittedEvent.events[1].value.toLowerCase())
          // assert.equal(relayWorker.toLowerCase(), sampleRecipientEmittedEvent.events[2].value.toLowerCase())
        })

        it('relayCall executes a transaction even if recipient call reverts', async function () {
          const reason = '0x08c379a0' + removeHexPrefix(ethers.utils.defaultAbiCoder.encode(['string'], ['always fail']))
          const encodedFunction = (await recipientContract.populateTransaction.testRevert()).data?? ''
          const relayRequestRevert = cloneRelayRequest(relayRequest)
          relayRequestRevert.request.data = encodedFunction
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestRevert
          )
          signature = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          const encodeSignature = ethers.utils.solidityKeccak256(['bytes'],[signature])
          await expect(relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequestRevert, signature, {
            gasLimit,
            gasPrice
          })).to.emit(
            relayHubInstance, 'TransactionRelayedButRevertedByRecipient'
          ).withArgs(
            relayManager,
            relayWorker,
            encodeSignature,
            reason
          )

          // const receipt = await web3.eth.getTransactionReceipt(tx)
          // const logs = abiDecoder.decodeLogs(receipt.logs)
          // const transactionRelayedButRevertedByRecipientEvent =
          //   logs.find((e: any) => e != null && e.name === 'TransactionRelayedButRevertedByRecipient')

          // assert.equal(relayWorker.toLowerCase(), transactionRelayedButRevertedByRecipientEvent.events[1].value.toLowerCase())
          // assert.equal(reason, transactionRelayedButRevertedByRecipientEvent.events[3].value)
        })

        it('should not accept relay requests if passed gas is too low for a relayed transaction', async function () {
          const gasOverhead = (await relayHubInstance.gasOverhead()).toNumber()
          const gasAlreadyUsedBeforeDoingAnythingInRelayCall = parametersGasOverhead// Just by calling and sending the parameters
          const gasToSend = gasAlreadyUsedBeforeDoingAnythingInRelayCall + BigInt(gasOverhead) + BigInt(relayRequestMisbehavingVerifier.request.gas)
          await expect(
            relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasPrice,
              gasLimit: (gasToSend - BigInt(10000)).toString()
            })).revertedWith(
            'Not enough gas left')
        })

        it('should not accept relay requests with gas price lower than user specified', async function () {
          const relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
          relayRequestMisbehavingVerifier.relayData.gasPrice = (BigInt(gasPrice) + BigInt(1)).toString()

          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequestMisbehavingVerifier
          )
          const signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          await expect(
            relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasLimit,
              gasPrice: gasPrice
            })).to.revertedWith(
            'Invalid gas price')
        })

        it('should not accept relay requests with incorrect relay worker', async function () {
          await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([incorrectWorker])
          await expect(
            relayHubInstance.connect(incorrectWorkerSigner).relayCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasPrice,
              gasLimit
            })).revertedWith(
            'revert Not a right worker')
        })

        //TODO: Check signature
        it('should not accept relay requests if destination recipient doesn\'t have a balance to pay for it',
          async function () {
            const TestVerifierEverythingAccepted = await ethers.getContractFactory("TestVerifierEverythingAccepted") as TestVerifierEverythingAccepted__factory
            const verifier2 = await TestVerifierEverythingAccepted.deploy()
            await verifier2.deployed()
            // const verifier2 = await TestVerifierEverythingAccepted.new()
            const relayRequestVerifier2 = cloneRelayRequest(relayRequest)
            relayRequestVerifier2.relayData.callVerifier = verifier2.address

            await expect(
              relayHubInstance.connect(relayWorkerSigner).relayCall(relayRequestVerifier2, signatureWithMisbehavingVerifier, {
                gasLimit,
                gasPrice
              })).to.reverted
              // .to.revertedWith(
              // 'revert Verifier balance too low')
          })

        describe('recipient balance withdrawal ban', function () {
          let misbehavingVerifier: TestVerifierConfigurableMisbehavior
          let relayRequestMisbehavingVerifier: RelayRequest
          beforeEach(async function () {
            misbehavingVerifier = await TestVerifierConfigurableMisbehavior.deploy()
            await misbehavingVerifier.deployed()

            relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest)
            relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
            const dataToSign = new TypedRequestData(
              chainId,
              forwarder,
              relayRequestMisbehavingVerifier
            )
            signature = getLocalEip712Signature(
              dataToSign,
              gaslessAccount.privateKey
            )
          })
        })
      })
    })
  })

  describe('deployCall', function () {
    let min = 0
    let max = 1000000000
    min = Math.ceil(min)
    max = Math.floor(max)
    let nextWalletIndex = Math.floor(Math.random() * (max - min + 1) + min)

    beforeEach(async function () {
      env = await getTestingEnvironment()
      chainId = env.chainId

      penalizer = await Penalizer.deploy()
      await penalizer.deployed()
      relayHubInstance = await deployHub(penalizer.address)
      verifierContract = await TestVerifierEverythingAccepted.deploy()
      await verifierContract.deployed()
      deployVerifierContract = await TestDeployVerifierEverythingAccepted.deploy()
      await deployVerifierContract.deployed()
      gaslessAccount = await getGaslessAccount()

      const smartWalletTemplate: SmartWallet = await SmartWallet.deploy()
      await smartWalletTemplate.deployed()
      factory = await createSmartWalletFactory(smartWalletTemplate)
      recipientContract = await TestRecipient.deploy()
      await recipientContract.deployed()
      const TestToken = await ethers.getContractFactory("TestToken") as TestToken__factory
      token = await TestToken.deploy()
      await token.deployed()
      target = recipientContract.address
      verifier = verifierContract.address
      relayHub = relayHubInstance.address

      sharedDeployRequestData = {
        request: {
          relayHub: relayHub,
          to: constants.ZERO_ADDRESS,
          data: '0x',
          from: gaslessAccount.address,
          nonce: (await factory.nonce(gaslessAccount.address)).toString(),
          value: '0',
          gas: gasLimit,
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000',
          recoverer: constants.ZERO_ADDRESS,
          index: '0'
        },
        relayData: {
          gasPrice,
          relayWorker,
          callForwarder: factory.address,
          callVerifier: deployVerifierContract.address,
          domainSeparator: getDomainSeparatorHash(factory.address, chainId)
        }
      }
    })

    // TODO review gasPrice for RSK
    context('with unknown worker', function () {
      const signature = '0xdeadbeef'
      const gasLimit = 4e6
      let deployRequest: DeployRequest

      beforeEach(async function () {
        deployRequest = cloneRelayRequest(sharedDeployRequestData) as DeployRequest
        deployRequest.request.index = nextWalletIndex.toString()
        nextWalletIndex++
      })

      it('should not accept a deploy call', async function () {
        await expect(
          relayHubInstance.connect(relayWorkerSigner).deployCall(deployRequest, signature, {
            gasLimit
          })).to.revertedWith(
          'revert Not an enabled worker')
      })

      context('with manager stake unlocked', function () {
        beforeEach(async function () {
          await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
            value: ethers.utils.parseEther('1')
          })
          await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker])
        })
        //TODO: Check call
        it('should not accept a deploy call', async function () {
          await expect(
            relayHubInstance.connect(relayWorkerSigner).deployCall(deployRequest, signature, {
              gasLimit
            })).to.reverted
            // be.revertedWith(
            // 'revert relay manager not staked')
        })
      })
    })

    context('with staked and registered relay', function () {
      const url = 'http://relay.com'
      let deployRequest: DeployRequest

      beforeEach(async function () {
        await relayHubInstance.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
          value: ethers.utils.parseEther('2')
        })
        await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([relayWorker])
        await relayHubInstance.connect(relayManagerSigner).registerRelayServer(url)

        deployRequest = cloneRelayRequest(sharedDeployRequestData) as DeployRequest
        deployRequest.request.index = nextWalletIndex.toString()
        nextWalletIndex++
      })

      context('with relay worker that is not externally-owned account', function () {
        it('should not accept deploy requests', async function () {
          const signature = '0xdeadbeef'
          const gasLimit = 4e6
          const TestRelayWorkerContract = await ethers.getContractFactory("TestRelayWorkerContract") as TestRelayWorkerContract__factory
          const testRelayWorkerContract = await TestRelayWorkerContract.deploy()
          await testRelayWorkerContract.deployed()
          await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([testRelayWorkerContract.address])
          await expect(
            testRelayWorkerContract.deployCall(
              relayHubInstance.address,
              deployRequest,
              signature,
              {
                gasLimit
              })).to.revertedWith(
            'RelayWorker cannot be a contract')
        })
      })

      context('with funded verifier', function () {
        let misbehavingVerifier: TestDeployVerifierConfigurableMisbehavior
        let signatureWithMisbehavingVerifier: string
        let relayRequestMisbehavingVerifier: DeployRequest
        const gasLimit = 4e6

        beforeEach(async function () {
          const TestDeployVerifierConfigurableMisbehavior = await ethers.getContractFactory("TestDeployVerifierConfigurableMisbehavior") as TestDeployVerifierConfigurableMisbehavior__factory
          misbehavingVerifier = await TestDeployVerifierConfigurableMisbehavior.deploy()
          await misbehavingVerifier.deployed()
          deployRequest.request.index = nextWalletIndex.toString()
          nextWalletIndex++

          relayRequestMisbehavingVerifier = cloneRelayRequest(deployRequest) as DeployRequest
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
          const dataToSign = new TypedDeployRequestData(
            chainId,
            factory.address,
            relayRequestMisbehavingVerifier
          )
          signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
        })

        it('deployCall executes the transaction and increments sender nonce on factory', async function () {
          const nonceBefore = await factory.nonce(gaslessAccount.address)
          const calculatedAddr = await factory.getSmartWalletAddress(gaslessAccount.address,
            constants.ZERO_ADDRESS, relayRequestMisbehavingVerifier.request.index)
          await token.mint('1', calculatedAddr)

          await relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
            gasLimit,
            gasPrice
          })


          const event = factory.filters.Deployed(null, null)
          const eventEmitted = await factory.queryFilter(event)
          expect(eventEmitted[0].event).to.be.equal('Deployed')
          expect(eventEmitted[0].args.addr).to.be.equal(calculatedAddr)

          // const deployedEvent = trx.logs.find((e: any) => e != null && e.name === 'Deployed')
          // expect(deployedEvent !== undefined).is.true('No Deployed event found')
          // const event = deployedEvent?.topics[0]
          // assert.equal(event.name, 'addr')
          // const generatedSWAddress = ethers.utils.getAddress(event.value)

          // expect(calculatedAddr).to.be.equal(generatedSWAddress)

          const nonceAfter = await factory.nonce(gaslessAccount.address)
          expect(nonceAfter).to.be.equal(nonceBefore.add(1))
        })

        it('should fail to deploy if the worker has been disabled', async function () {
          let manager = await relayHubInstance.workerToManager(relayWorker)
          // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
          let expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('1')))

          expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await relayHubInstance.connect(relayManagerSigner).disableRelayWorkers([relayWorker])
          manager = await relayHubInstance.workerToManager(relayWorker)
          expectedManager = '0x00000000000000000000000'.concat(stripHex(relayManager.concat('0')))
          expect(manager.toLowerCase()).to.be.equal(expectedManager.toLowerCase(), `Incorrect relay manager: ${manager}`)

          await expect(
            relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasLimit,
              gasPrice
            })).to.revertedWith(
            'Not an enabled worker')
        })

        //TODO: Check call
        it('deployCall should refuse to re-send transaction with same nonce', async function () {
          const calculatedAddr = await factory.getSmartWalletAddress(gaslessAccount.address,
            constants.ZERO_ADDRESS, relayRequestMisbehavingVerifier.request.index)
          await token.mint('2', calculatedAddr)

          await relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
            gasLimit,
            gasPrice
          })

          const event = factory.filters.Deployed(null, null)
          const eventEmitted = await factory.queryFilter(event)
          expect(eventEmitted[0].event).to.be.equal('Deployed')
          expect(eventEmitted[0].args.addr).to.be.equal(calculatedAddr)

          // const trx = await web3.eth.getTransactionReceipt(tx)

          // const decodedLogs = abiDecoder.decodeLogs(trx.logs)

          // const deployedEvent = decodedLogs.find((e: any) => e != null && e.name === 'Deployed')
          // assert.isTrue(deployedEvent !== undefined, 'No Deployed event found')
          // const event = deployedEvent?.events[0]
          // assert.equal(event.name, 'addr')
          // const generatedSWAddress = toChecksumAddress(event.value, env.chainId)

          // assert.equal(calculatedAddr, generatedSWAddress)

          await expect(
            relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasLimit,
              gasPrice
            })).to.reverted
            // With(
            // 'nonce mismatch')
        })

        it('should not accept deploy requests if passed gas is too low for a relayed transaction', async function () {
          const gasOverhead = (await relayHubInstance.gasOverhead()).toNumber()
          const gasAlreadyUsedBeforeDoingAnythingInRelayCall = parametersGasOverhead// Just by calling and sending the parameters
          const gasToSend = gasAlreadyUsedBeforeDoingAnythingInRelayCall + BigInt(gasOverhead) + BigInt(relayRequestMisbehavingVerifier.request.gas)
          await expect(
            relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasPrice,
              gasLimit: (gasToSend - BigInt(10000)).toString()
            })).to.revertedWith(
            'Not enough gas left')
        })

        it('should not accept deploy requests with gas price lower than user specified', async function () {
          const relayRequestMisbehavingVerifier = cloneRelayRequest(deployRequest) as DeployRequest
          relayRequestMisbehavingVerifier.relayData.callVerifier = misbehavingVerifier.address
          relayRequestMisbehavingVerifier.relayData.gasPrice = (BigInt(gasPrice) + BigInt(1)).toString()

          const dataToSign = new TypedDeployRequestData(
            chainId,
            factory.address,
            relayRequestMisbehavingVerifier
          )
          const signatureWithMisbehavingVerifier = getLocalEip712Signature(
            dataToSign,
            gaslessAccount.privateKey
          )
          await expect(
            relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasLimit,
              gasPrice: gasPrice
            })).to.revertedWith(
            'Invalid gas price')
        })

        it('should not accept deploy requests with incorrect relay worker', async function () {
          await relayHubInstance.connect(relayManagerSigner).addRelayWorkers([incorrectWorker])
          await expect(
            relayHubInstance.connect(incorrectWorkerSigner).deployCall(relayRequestMisbehavingVerifier, signatureWithMisbehavingVerifier, {
              gasPrice,
              gasLimit
            })).to.revertedWith(
            'Not a right worker')
        })
        //TODO: Check call
        it('should not accept deploy requests if destination recipient doesn\'t have a balance to pay for it',
          async function () {
            const verifier2 = await TestDeployVerifierEverythingAccepted.deploy()
            await verifier2.deployed()
            const relayRequestVerifier2 = cloneRelayRequest(deployRequest) as DeployRequest
            relayRequestVerifier2.relayData.callVerifier = verifier2.address

            await expect(
              relayHubInstance.connect(relayWorkerSigner).deployCall(relayRequestVerifier2, signatureWithMisbehavingVerifier, {
                gasLimit,
                gasPrice
              })).to.reverted
              // With(
              // 'Verifier balance too low')
          })
      })
    })
  })
})

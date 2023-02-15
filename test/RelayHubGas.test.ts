import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractReceipt, Wallet, providers } from 'ethers'
import {
  UtilToken,
  SmartWalletFactory,
  Penalizer,
  RelayHub,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts'
import {
  CommonEnvelopingRequestBody,
  ESTIMATED_GAS_CORRECTION_FACTOR,
  EnvelopingRequest,
  EnvelopingRequestData,
  INTERNAL_TRANSACTION_ESTIMATED_CORRECTION,
  RelayRequest,
  RelayRequestBody,
} from '@rsksmart/rif-relay-client'
import {
  TestRecipient,
  TestVerifierEverythingAccepted,
} from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  getSuffixDataAndSignature,
  createSmartWalletFactory,
  createSupportedSmartWallet,
  RSK_URL,
} from './utils/TestUtils'

function logGasOverhead(gasOverhead: BigNumber) {
    // bg and fg colours taken from https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
    const bgMagenta = '\x1B[45m';
    const fgWhite = '\x1B[37m';
    const reset = '\x1b[0m';
    console.log(
        bgMagenta,
        fgWhite,
        `Enveloping Overhead Gas: ${gasOverhead.toString()}`,
        reset
    );
}

const deployContract = <Contract>(contract: string) => {
  return ethers
    .getContractFactory(contract)
    .then((contractFactory) => contractFactory.deploy() as Contract)
}

describe('RelayHub', function () {
  let penalizer: Penalizer
  let relayHub: RelayHub
  let verifier: TestVerifierEverythingAccepted
  let recipient: TestRecipient
  let token: UtilToken
  let factory: SmartWalletFactory
  let relayWorker: SignerWithAddress
  let relayManager: SignerWithAddress
  let relayOwner: SignerWithAddress
  let fundedAccount: SignerWithAddress
  let relayHubSigner: SignerWithAddress
  let owner: Wallet
  let provider: providers.JsonRpcProvider
  const gasPrice = 1
  const gasLimit = 4e6

  async function printGasStatus(receipt: ContractReceipt) {
    const noRelayCall = await token.transfer(
        owner.address,
        '1000'
    );

    const { gasUsed: gasUsedWithoutRelay } = await noRelayCall.wait();

    const gasOverhead = receipt.gasUsed.sub(gasUsedWithoutRelay);
    console.log(
        `Destination Call Without enveloping - Gas Used: ${gasUsedWithoutRelay.toString()}`
    );
    console.log(
        `Destination Call with enveloping - Gas Used: ${receipt.gasUsed.toString()}`
    );
    logGasOverhead(gasOverhead);
}

  const deployHub = (penalizerAddress: string) => {
    return ethers
      .getContractFactory('RelayHub')
      .then((contract) =>
        contract.deploy(
          penalizerAddress,
          10,
          (1e18).toString(),
          1000,
          (1e18).toString(),
        ),
      )
  }

  const cloneEnvelopingRequest = (
    envelopingRequest: EnvelopingRequest,
    override: {
      request?: Partial<CommonEnvelopingRequestBody>
      relayData?: Partial<EnvelopingRequestData>
    },
  ): EnvelopingRequest => {
    return {
      request: { ...envelopingRequest.request, ...override.request },
      relayData: { ...envelopingRequest.relayData, ...override.relayData },
    }
  }

  beforeEach(async function () {
    provider = new ethers.providers.JsonRpcProvider(RSK_URL)
    owner = ethers.Wallet.createRandom().connect(provider)
    ;[
      relayWorker,
      relayManager,
      relayOwner,
      fundedAccount,
      relayHubSigner,
    ] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
    ]

    penalizer = await deployContract('Penalizer')
    verifier = await deployContract('TestVerifierEverythingAccepted')
    recipient = await deployContract('TestRecipient')
    token = await deployContract('UtilToken')
    const smartWalletTemplate = await deployContract<SmartWallet>('SmartWallet')

    relayHub = await deployHub(penalizer.address)

    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    })

    factory = (await createSmartWalletFactory(
      smartWalletTemplate,
      false,
      owner,
    )) as SmartWalletFactory
  })

  describe('relayCall', function () {
    let relayRequest: RelayRequest
    let forwarder: SmartWallet

    beforeEach(async function () {
      forwarder = (await createSupportedSmartWallet({
        relayHub: relayHubSigner.address,
        factory,
        owner,
        sender: relayHubSigner,
      })) as SmartWallet

      await token.mint('1000', forwarder.address)

      relayRequest = {
        request: {
          relayHub: relayHub.address,
          to: recipient.address,
          data: '0xdeadbeef',
          from: owner.address,
          nonce: (await forwarder.nonce()).toString(),
          value: '0',
          gas: '3000000',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000',
          validUntilTime: '0',
        },
        relayData: {
          gasPrice,
          feesReceiver: relayWorker.address,
          callForwarder: forwarder.address,
          callVerifier: verifier.address,
        },
      }
    })

    const cloneRelayRequest = (override: {
      request?: Partial<RelayRequestBody>
      relayData?: Partial<EnvelopingRequestData>
    }) => {
      return cloneEnvelopingRequest(relayRequest, override) as RelayRequest
    }

    context('with staked and registered relay', function () {
      const url = 'http://relay.com'
      const message = 'Enveloping RelayHub'

      beforeEach(async function () {
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('2'),
          })

        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address])
        await relayHub.connect(relayManager).registerRelayServer(url)
      })

      context('with funded verifier', function () {

        it('gas prediction tests - with token payment', async function () {
          const nonceBefore = await forwarder.nonce()
          await token.mint('10000', forwarder.address)
          let swalletInitialBalance = await token.balanceOf(
            forwarder.address,
          )
          let relayWorkerInitialBalance = await token.balanceOf(relayWorker.address)
          let message =
            'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING '
          message = message.concat(message)

          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessage',
            [message]
          );

          let balanceToTransfer = ethers.utils.hexValue(swalletInitialBalance.toNumber())

          let estimatedDestinationCallGas = await ethers.provider.estimateGas({
            from: forwarder.address,
            to: recipient.address,
            gasPrice: gasPrice,
            data: encodedFunction,
          })

          let internalDestinationCallCost =
            estimatedDestinationCallGas.toNumber() >
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              ? estimatedDestinationCallGas.toNumber() -
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              : estimatedDestinationCallGas.toNumber()
          internalDestinationCallCost =
            internalDestinationCallCost *
            ESTIMATED_GAS_CORRECTION_FACTOR

          let estimatedTokenPaymentGas = await ethers.provider.estimateGas({
            from: forwarder.address,
            to: token.address,
            data: token.interface.encodeFunctionData('transfer', [relayWorker.address, balanceToTransfer])
          })

          let internalTokenCallCost =
            estimatedTokenPaymentGas.toNumber() >
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              ? estimatedTokenPaymentGas.toNumber() -
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              : estimatedTokenPaymentGas.toNumber()
          internalTokenCallCost =
            internalTokenCallCost * ESTIMATED_GAS_CORRECTION_FACTOR

            const completeReq: RelayRequest = cloneRelayRequest(
                {
                    request: { 
                        nonce: nonceBefore.toString(),
                        tokenAmount: balanceToTransfer,
                        data: encodedFunction,
                        gas: ethers.utils.hexValue(internalDestinationCallCost),
                        tokenGas: ethers.utils.hexValue(internalTokenCallCost)
                    }
                }
              )

            let { signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

          let detailedEstimation = await ethers.provider.estimateGas({
            from: relayWorker.address.address,
            to: relayHub.address,
            data: relayHub.interface.encodeFunctionData('relayCall', [completeReq, sig]),
            gasPrice,
            gasLimit: 6800000,
          })

          // gas estimation fit
          // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
          // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
          const a0 = Number('35095.980')
          const a1 = Number('1.098')
          const estimatedCost =
            a1 * (internalDestinationCallCost + internalTokenCallCost) + a0

          console.log(
            'The destination contract call estimate is: ',
            internalDestinationCallCost,
          )
          console.log('The token gas estimate is: ', internalTokenCallCost)
          console.log(
            'X = ',
            internalDestinationCallCost + internalTokenCallCost,
          )
          console.log('The predicted total cost is: ', estimatedCost)
          console.log('Detailed estimation: ', detailedEstimation)
          const relayCallResult = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          let sWalletFinalBalance = await token.balanceOf(
            forwarder.address,
          )
          let relayWorkerFinalBalance = await token.balanceOf(relayWorker.address)

          expect(
            swalletInitialBalance.eq(
              sWalletFinalBalance.add(BigNumber.from(balanceToTransfer)),
            )).to.equal(true,
            'SW Payment did not occur',
          )
          expect(
            relayWorkerFinalBalance.eq(
              relayWorkerInitialBalance.add(BigNumber.from(balanceToTransfer)),
            )).to.equal(true,
            'Worker did not receive payment',
          )

          let nonceAfter = await forwarder.nonce()
          expect(
            nonceBefore.add(1).toNumber()).to.equal(
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          let txReceipt = await relayCallResult.wait();

          console.log(`Cumulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`)

          /*let logs = abiDecoder.decodeLogs(txReceipt.logs)
          let sampleRecipientEmittedEvent = logs.find(
            (e: any) => e != null && e.name === 'SampleRecipientEmitted',
          )

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(
            forwarder.address.toLowerCase(),
            sampleRecipientEmittedEvent.events[1].value.toLowerCase(),
          )
          assert.equal(
            relayWorker.toLowerCase(),
            sampleRecipientEmittedEvent.events[2].value.toLowerCase(),
          )

          let transactionRelayedEvent = logs.find(
            (e: any) => e != null && e.name === 'TransactionRelayed',
          )
          assert.isTrue(
            transactionRelayedEvent !== undefined &&
              transactionRelayedEvent !== null,
            'TransactionRelayedEvent not found',
          )*/

          // SECOND CALL
          await token.mint('100', forwarder.address)

          swalletInitialBalance = await token.balanceOf(forwarder.address)
          balanceToTransfer = toHex(swalletInitialBalance.toNumber())
          relayWorkerInitialBalance = await token.balanceOf(relayWorker)

          completeReq.request.tokenAmount = toHex(swalletInitialBalance)
          estimatedDestinationCallGas = await web3.eth.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          internalDestinationCallCost =
            estimatedDestinationCallGas >
            constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              ? estimatedDestinationCallGas -
                constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              : estimatedDestinationCallGas
          internalDestinationCallCost =
            internalDestinationCallCost *
            constants.ESTIMATED_GAS_CORRECTION_FACTOR

          estimatedTokenPaymentGas = await web3.eth.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: token.address,
            data: token.contract.methods
              .transfer(relayWorker, balanceToTransfer)
              .encodeABI(),
          })

          internalTokenCallCost =
            estimatedTokenPaymentGas >
            constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              ? estimatedTokenPaymentGas -
                constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              : estimatedTokenPaymentGas
          internalTokenCallCost =
            internalTokenCallCost * constants.ESTIMATED_GAS_CORRECTION_FACTOR

          completeReq.request.gas = toHex(internalDestinationCallCost)
          completeReq.request.tokenGas = toHex(internalTokenCallCost)

          completeReq.request.nonce = nonceBefore.add(toBN(1)).toString()
          reqToSign = new TypedRequestData(
            chainId,
            forwarder.address,
            completeReq,
          )

          sig = getLocalEip712Signature(reqToSign, gaslessAccount.privateKey)

          detailedEstimation = await web3.eth.estimateGas({
            from: relayWorker.address,
            to: relayHub.address,
            data: relayHub.contract.methods
              .relayCall(completeReq, sig)
              .encodeABI(),
            gasPrice,
          })

          const result = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          console.log('ROUND 2')
          console.log(
            'The destination contract call estimate is: ',
            internalDestinationCallCost,
          )
          console.log('The token gas estimate is: ', internalTokenCallCost)
          console.log(
            'X = ',
            internalDestinationCallCost + internalTokenCallCost,
          )
          console.log('Detailed estimation: ', detailedEstimation)

          sWalletFinalBalance = await token.balanceOf(forwarder.address)
          relayWorkerFinalBalance = await token.balanceOf(relayWorker)

          assert.isTrue(
            swalletInitialBalance.eq(
              sWalletFinalBalance.add(toBN(balanceToTransfer)),
            ),
            'SW Payment did not occur',
          )
          assert.isTrue(
            relayWorkerFinalBalance.eq(
              relayWorkerInitialBalance.add(toBN(balanceToTransfer)),
            ),
            'Worker did not receive payment',
          )

          nonceAfter = await forwarder.nonce()
          assert.equal(
            nonceBefore.addn(2).toNumber(),
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          txReceipt = await web3.eth.getTransactionReceipt(result.tx)

          console.log(
            `Cumulative Gas Used in second run: ${txReceipt.cumulativeGasUsed}`,
          )

          logs = abiDecoder.decodeLogs(txReceipt.logs)
          sampleRecipientEmittedEvent = logs.find(
            (e: any) => e != null && e.name === 'SampleRecipientEmitted',
          )

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(
            forwarder.address.toLowerCase(),
            sampleRecipientEmittedEvent.events[1].value.toLowerCase(),
          )
          assert.equal(
            relayWorker.toLowerCase(),
            sampleRecipientEmittedEvent.events[2].value.toLowerCase(),
          )

          transactionRelayedEvent = logs.find(
            (e: any) => e != null && e.name === 'TransactionRelayed',
          )
          assert.isTrue(
            transactionRelayedEvent !== undefined &&
              transactionRelayedEvent !== null,
            'TransactionRelayedEvent not found',
          )
        })

        it('gas prediction tests - without token payment', async function () {
          const SmartWallet = artifacts.require('SmartWallet')
          const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
          const smartWalletFactory: SmartWalletFactoryInstance = await createSmartWalletFactory(
            smartWalletTemplate,
          )
          const forwarder = await createSmartWallet(
            _,
            gaslessAccount.address,
            smartWalletFactory,
            gaslessAccount.privateKey,
            chainId,
          )

          const nonceBefore = await forwarder.nonce()
          let swalletInitialBalance = await token.balanceOf(
            forwarder.address,
          )
          let relayWorkerInitialBalance = await token.balanceOf(relayWorker)
          let message =
            'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING '
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)

          const completeReq: RelayRequest = cloneRelayRequest(
            sharedRelayRequestData,
          )
          completeReq.request.data = recipientContract.contract.methods
            .emitMessage(message)
            .encodeABI()
          completeReq.request.nonce = nonceBefore.toString()
          completeReq.relayData.callForwarder = forwarder.address
          completeReq.request.tokenAmount = '0x00'
          completeReq.request.tokenContract = constants.ZERO_ADDRESS
          completeReq.request.tokenGas = '0x00'

          let estimatedDestinationCallGas = await web3.eth.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          let internalDestinationCallCost =
            estimatedDestinationCallGas >
            constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              ? estimatedDestinationCallGas -
                constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              : estimatedDestinationCallGas
          internalDestinationCallCost =
            internalDestinationCallCost *
            constants.ESTIMATED_GAS_CORRECTION_FACTOR

          completeReq.request.gas = toHex(internalDestinationCallCost)

          let reqToSign = new TypedRequestData(
            chainId,
            forwarder.address,
            completeReq,
          )

          let sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey,
          )

          let detailedEstimation = await web3.eth.estimateGas({
            from: relayWorker.address,
            to: relayHub.address,
            data: relayHub.contract.methods
              .relayCall(completeReq, sig)
              .encodeABI(),
            gasPrice,
            gas: 6800000,
          })

          // gas estimation fit
          // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
          // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
          const a0 = Number('35095.980')
          const a1 = Number('1.098')
          const estimatedCost = a1 * internalDestinationCallCost + a0

          console.log(
            'The destination contract call estimate is: ',
            internalDestinationCallCost,
          )
          console.log('X = ', internalDestinationCallCost)
          console.log('The predicted total cost is: ', estimatedCost)
          console.log('Detailed estimation: ', detailedEstimation)
          const { tx } = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          let sWalletFinalBalance = await token.balanceOf(
            forwarder.address,
          )
          let relayWorkerFinalBalance = await token.balanceOf(relayWorker)

          assert.isTrue(
            swalletInitialBalance.eq(sWalletFinalBalance),
            'SW Payment did occur',
          )
          assert.isTrue(
            relayWorkerFinalBalance.eq(relayWorkerInitialBalance),
            'Worker did receive payment',
          )

          let nonceAfter = await forwarder.nonce()
          assert.equal(
            nonceBefore.addn(1).toNumber(),
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          let txReceipt = await web3.eth.getTransactionReceipt(tx)

          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`)

          let logs = abiDecoder.decodeLogs(txReceipt.logs)
          let sampleRecipientEmittedEvent = logs.find(
            (e: any) => e != null && e.name === 'SampleRecipientEmitted',
          )

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(
            forwarder.address.toLowerCase(),
            sampleRecipientEmittedEvent.events[1].value.toLowerCase(),
          )
          assert.equal(
            relayWorker.toLowerCase(),
            sampleRecipientEmittedEvent.events[2].value.toLowerCase(),
          )

          let transactionRelayedEvent = logs.find(
            (e: any) => e != null && e.name === 'TransactionRelayed',
          )
          assert.isTrue(
            transactionRelayedEvent !== undefined &&
              transactionRelayedEvent !== null,
            'TransactionRelayedEvent not found',
          )

          // SECOND CALL

          swalletInitialBalance = await token.balanceOf(forwarder.address)
          relayWorkerInitialBalance = await token.balanceOf(relayWorker)

          estimatedDestinationCallGas = await web3.eth.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          internalDestinationCallCost =
            estimatedDestinationCallGas >
            constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              ? estimatedDestinationCallGas -
                constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
              : estimatedDestinationCallGas
          internalDestinationCallCost =
            internalDestinationCallCost *
            constants.ESTIMATED_GAS_CORRECTION_FACTOR

          completeReq.request.gas = toHex(internalDestinationCallCost)

          completeReq.request.nonce = nonceBefore.add(toBN(1)).toString()
          reqToSign = new TypedRequestData(
            chainId,
            forwarder.address,
            completeReq,
          )

          sig = getLocalEip712Signature(reqToSign, gaslessAccount.privateKey)

          detailedEstimation = await web3.eth.estimateGas({
            from: relayWorker.address,
            to: relayHub.address,
            data: relayHub.contract.methods
              .relayCall(completeReq, sig)
              .encodeABI(),
            gasPrice,
          })

          const result = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          console.log('ROUND 2')
          console.log(
            'The destination contract call estimate is: ',
            internalDestinationCallCost,
          )
          console.log('X = ', internalDestinationCallCost)
          console.log('Detailed estimation: ', detailedEstimation)

          sWalletFinalBalance = await token.balanceOf(forwarder.address)
          relayWorkerFinalBalance = await token.balanceOf(relayWorker)

          assert.isTrue(
            swalletInitialBalance.eq(sWalletFinalBalance),
            'SW Payment did occur',
          )
          assert.isTrue(
            relayWorkerFinalBalance.eq(relayWorkerInitialBalance),
            'Worker did receive payment',
          )

          nonceAfter = await forwarder.nonce()
          assert.equal(
            nonceBefore.addn(2).toNumber(),
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          txReceipt = await web3.eth.getTransactionReceipt(result.tx)

          console.log(
            `Cummulative Gas Used in second run: ${txReceipt.cumulativeGasUsed}`,
          )

          logs = abiDecoder.decodeLogs(txReceipt.logs)
          sampleRecipientEmittedEvent = logs.find(
            (e: any) => e != null && e.name === 'SampleRecipientEmitted',
          )

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(
            forwarder.address.toLowerCase(),
            sampleRecipientEmittedEvent.events[1].value.toLowerCase(),
          )
          assert.equal(
            relayWorker.toLowerCase(),
            sampleRecipientEmittedEvent.events[2].value.toLowerCase(),
          )

          transactionRelayedEvent = logs.find(
            (e: any) => e != null && e.name === 'TransactionRelayed',
          )
          assert.isTrue(
            transactionRelayedEvent !== undefined &&
              transactionRelayedEvent !== null,
            'TransactionRelayedEvent not found',
          )
        })

        it('gas estimation tests for SmartWallet', async function () {
          const SmartWallet = artifacts.require('SmartWallet')
          const smartWalletTemplate: SmartWalletInstance = await SmartWallet.new()
          const smartWalletFactory: SmartWalletFactoryInstance = await createSmartWalletFactory(
            smartWalletTemplate,
          )
          const forwarder = await createSmartWallet(
            _,
            gaslessAccount.address,
            smartWalletFactory,
            gaslessAccount.privateKey,
            chainId,
          )

          const nonceBefore = await forwarder.nonce()
          await token.mint('10000', forwarder.address)

          let message =
            'RIF Enveloping RIF Enveloping RIF Enveloping RIF Enveloping'
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          const completeReq: RelayRequest = cloneRelayRequest(
            sharedRelayRequestData,
          )
          completeReq.request.data = recipientContract.contract.methods
            .emitMessage(message)
            .encodeABI()
          completeReq.request.nonce = nonceBefore.toString()
          completeReq.relayData.callForwarder = forwarder.address
          completeReq.request.tokenAmount = '0x00'
          completeReq.request.tokenGas = '0'

          const reqToSign = new TypedRequestData(
            chainId,
            forwarder.address,
            completeReq,
          )

          const sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey,
          )

          const estimatedDestinationCallCost = await web3.eth.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          // tokenAmount is set to 0
          const tokenPaymentEstimation = 0
          /* const tokenPaymentEstimation = await web3.eth.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: token.address,
                    data: token.contract.methods.transfer(relayWorker, '1').encodeABI()
                }); */

          // gas estimation fit
          // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
          // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
          const a0 = Number('37796.074')
          const a1 = Number('1.086')
          const estimatedCost =
            a1 * (estimatedDestinationCallCost + tokenPaymentEstimation) + a0

          console.log(
            'The destination contract call estimate is: ',
            estimatedDestinationCallCost,
          )
          console.log('The token gas estimate is: ', tokenPaymentEstimation)
          console.log(
            'X = ',
            estimatedDestinationCallCost + tokenPaymentEstimation,
          )

          console.log('The predicted total cost is: ', estimatedCost)
          const { tx } = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          const nonceAfter = await forwarder.nonce()
          assert.equal(
            nonceBefore.addn(1).toNumber(),
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          const eventHash = keccak('GasUsed(uint256,uint256)')
          const txReceipt = await web3.eth.getTransactionReceipt(tx)

          // const costForCalling = 0;
          // const overheadCost = txReceipt.cumulativeGasUsed - costForCalling - estimatedDestinationCallCost;
          // console.log('data overhead: ', overheadCost);

          // console.log('---------------SmartWallet: RelayCall metrics------------------------')
          console.log(`Cumulative Gas Used: ${txReceipt.cumulativeGasUsed}`)
          console.log(`Gas Used: ${txReceipt.gasUsed}`)

          let previousGas: BigInt = BigInt(0)
          let previousStep: string | null = null
          for (let i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i]
            if ('0x' + eventHash.toString('hex') === log.topics[0]) {
              const step = log.data.substring(0, 66)
              const gasUsed: BigInt = BigInt(
                '0x' + log.data.substring(67, log.data.length),
              )
              console.log('---------------------------------------')
              console.log('step :', BigInt(step).toString())
              console.log('gasLeft :', gasUsed.toString())

              if (previousStep != null) {
                console.log(
                  `Steps substraction ${BigInt(step).toString()} and ${BigInt(
                    previousStep,
                  ).toString()}`,
                )
                console.log(
                  (previousGas.valueOf() - gasUsed.valueOf()).toString(),
                )
              }
              console.log('---------------------------------------')

              // TODO: we should check this
              // @ts-ignore
              previousGas = BigInt(gasUsed)
              previousStep = step
            }
          }

          const logs = abiDecoder.decodeLogs(txReceipt.logs)
          const sampleRecipientEmittedEvent = logs.find(
            (e: any) => e != null && e.name === 'SampleRecipientEmitted',
          )

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(
            forwarder.address.toLowerCase(),
            sampleRecipientEmittedEvent.events[1].value.toLowerCase(),
          )
          assert.equal(
            relayWorker.toLowerCase(),
            sampleRecipientEmittedEvent.events[2].value.toLowerCase(),
          )

          const transactionRelayedEvent = logs.find(
            (e: any) => e != null && e.name === 'TransactionRelayed',
          )

          assert.isNotNull(transactionRelayedEvent)

          const callWithoutRelay = await recipientContract.emitMessage(message)
          const cumulativeGasUsedWithoutRelay: number =
            callWithoutRelay.receipt.cumulativeGasUsed
          const gasOverhead =
            txReceipt.cumulativeGasUsed - cumulativeGasUsedWithoutRelay
          console.log(
            '--------------- Destination Call Without enveloping------------------------',
          )
          console.log(
            `Gas Used: ${callWithoutRelay.receipt.gasUsed}, Cummulative Gas Used: ${cumulativeGasUsedWithoutRelay}`,
          )
          console.log('---------------------------------------')
          console.log(
            '--------------- Destination Call with enveloping------------------------',
          )
          console.log(
            `Gas Used: ${txReceipt.gasUsed}, CumulativeGasUsed: ${txReceipt.cumulativeGasUsed}`,
          )
          console.log('---------------------------------------')
          console.log(
            `--------------- Enveloping Overhead (message length: ${message.length}) ------------------------`,
          )
          console.log(`Overhead Gas: ${gasOverhead}`)
          console.log('---------------------------------------')

          console.log('Round 2')

          completeReq.request.nonce = nonceAfter.toString()
          const reqToSign2 = new TypedRequestData(
            chainId,
            forwarder.address,
            completeReq,
          )

          const sig2 = getLocalEip712Signature(
            reqToSign2,
            gaslessAccount.privateKey,
          )
          const { tx: tx2 } = await relayHub.relayCall(
            completeReq,
            sig2,
            {
              from: relayWorker.address,
              gasLimit,
              gasPrice,
            },
          )
          const txReceipt2 = await web3.eth.getTransactionReceipt(tx2)
          console.log(
            '--------------- Destination Call with enveloping------------------------',
          )
          console.log(
            `Gas Used: ${txReceipt2.gasUsed}, CumulativeGasUsed: ${txReceipt2.cumulativeGasUsed}`,
          )
        })

        it('gas estimation tests', async function () {
          const nonceBefore = await forwarderInstance.nonce()
          const TestToken = artifacts.require('TestToken')
          const tokenInstance = await TestToken.new()
          await tokenInstance.mint('1000000', forwarder)

          const completeReq = {
            request: {
              ...relayRequest.request,
              data: recipientContract.contract.methods
                .emitMessage(message)
                .encodeABI(),
              nonce: nonceBefore.toString(),
              tokenContract: tokenInstance.address,
              tokenAmount: '0',
              tokenGas: '0',
            },
            relayData: {
              ...relayRequest.relayData,
            },
          }

          const reqToSign = new TypedRequestData(
            chainId,
            forwarder,
            completeReq,
          )

          const sig = getLocalEip712Signature(
            reqToSign,
            gaslessAccount.privateKey,
          )

          const { tx } = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          const nonceAfter = await forwarderInstance.nonce()
          assert.equal(nonceBefore.addn(1).toNumber(), nonceAfter.toNumber())

          const eventHash = keccak('GasUsed(uint256,uint256)')
          const txReceipt = await web3.eth.getTransactionReceipt(tx)
          console.log('---------------------------------------')

          console.log(`Gas Used: ${txReceipt.gasUsed}`)
          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`)

          let previousGas: BigInt = BigInt(0)
          let previousStep: null | string = null
          for (let i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i]
            if ('0x' + eventHash.toString('hex') === log.topics[0]) {
              const step = log.data.substring(0, 66)
              const gasUsed: BigInt = BigInt(
                '0x' + log.data.substring(67, log.data.length),
              )
              console.log('---------------------------------------')
              console.log('step :', BigInt(step).toString())
              console.log('gasLeft :', gasUsed.toString())

              if (previousStep != null) {
                console.log(
                  `Steps substraction ${BigInt(step).toString()} and ${BigInt(
                    previousStep,
                  ).toString()}`,
                )
                console.log(
                  (previousGas.valueOf() - gasUsed.valueOf()).toString(),
                )
              }
              console.log('---------------------------------------')
              // TODO: we should check this
              // @ts-ignore
              previousGas = BigInt(gasUsed)
              previousStep = step
            }
          }

          const logs = abiDecoder.decodeLogs(txReceipt.logs)
          const sampleRecipientEmittedEvent = logs.find(
            (e: any) => e != null && e.name === 'SampleRecipientEmitted',
          )

          assert.equal(message, sampleRecipientEmittedEvent.events[0].value)
          assert.equal(
            forwarder.toLowerCase(),
            sampleRecipientEmittedEvent.events[1].value.toLowerCase(),
          )
          assert.equal(
            relayWorker.toLowerCase(),
            sampleRecipientEmittedEvent.events[2].value.toLowerCase(),
          )

          const transactionRelayedEvent = logs.find(
            (e: any) => e != null && e.name === 'TransactionRelayed',
          )

          assert.isNotNull(transactionRelayedEvent)
        })

        async function estimateGasOverhead(fees: string) {
          const forwarder = await createSmartWalletInstance()
          // refill SW balance
          await token.mint('10000', forwarder.address)

          const swalletInitialBalance = await token.balanceOf(
            forwarder.address,
          )
          const relayWorkerInitialBalance = await token.balanceOf(relayWorker)

          const accounts = await web3.eth.getAccounts()
          const firstAccount = accounts[0]
          // necessary to execute the transfer tx without relay
          await token.mint('10000', firstAccount)
          const transferReceiver = accounts[1]
          const balanceToTransfer = toHex(1000)

          // forge the request
          const hexFees = toHex(fees)
          const completeReq: RelayRequest = await forgeRequest(
            transferReceiver,
            balanceToTransfer,
            forwarder,
            hexFees,
          )

          const sig = signRequest(completeReq, forwarder.address)

          const { tx } = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })
          const txReceipt = await web3.eth.getTransactionReceipt(tx)

          // assert the transaction has been relayed correctly
          const sWalletFinalBalance = await token.balanceOf(
            forwarder.address,
          )
          const relayWorkerFinalBalance = await token.balanceOf(relayWorker)
          assert.isTrue(
            swalletInitialBalance.eq(
              sWalletFinalBalance
                .add(toBN(hexFees))
                .add(toBN(balanceToTransfer)),
            ),
            'SW Payment did not occur',
          )
          assert.isTrue(
            relayWorkerFinalBalance.eq(
              relayWorkerInitialBalance.add(toBN(hexFees)),
            ),
            'Worker did not receive payment',
          )
          const logs = abiDecoder.decodeLogs(txReceipt.logs)
          const findLog = (logs: any, name: string) =>
            logs.find((e: any) => e != null && e.name === name)
          const transactionRelayedEvent = findLog(logs, 'TransactionRelayed')
          assert.isTrue(
            transactionRelayedEvent !== undefined &&
              transactionRelayedEvent !== null,
            'TransactionRelayedEvent not found',
          )
          await printGasStatus(txReceipt)
        }

        it.only('gas estimation tests for token transfer - with token payment', async function () {
          await estimateGasOverhead('5000')
        })

        it.only('gas estimation tests for token transfer - without token payment', async function () {
          await estimateGasOverhead('0')
        })
      })
    })
  })
})

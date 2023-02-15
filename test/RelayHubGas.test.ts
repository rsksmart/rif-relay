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
import { keccak256 } from 'ethers/lib/utils'

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
            from: relayWorker.address,
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

          // SECOND CALL
          await token.mint('100', forwarder.address)

          swalletInitialBalance = await token.balanceOf(forwarder.address)
          balanceToTransfer = ethers.utils.hexValue(swalletInitialBalance.toNumber())
          relayWorkerInitialBalance = await token.balanceOf(relayWorker.address)

          completeReq.request.tokenAmount = ethers.utils.hexValue(swalletInitialBalance)
          estimatedDestinationCallGas = await ethers.provider.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          internalDestinationCallCost =
            estimatedDestinationCallGas.toNumber() >
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              ? estimatedDestinationCallGas.toNumber() -
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              : estimatedDestinationCallGas.toNumber()
          internalDestinationCallCost =
            internalDestinationCallCost *
            ESTIMATED_GAS_CORRECTION_FACTOR;

          estimatedTokenPaymentGas = await ethers.provider.estimateGas({
            from: forwarder.address,
            to: token.address,
            data: token.interface.encodeFunctionData('transfer', [relayWorker.address, balanceToTransfer])
          })

          internalTokenCallCost =
            estimatedTokenPaymentGas.toNumber() >
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              ? estimatedTokenPaymentGas.toNumber() -
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              : estimatedTokenPaymentGas.toNumber()
          internalTokenCallCost =
            internalTokenCallCost * ESTIMATED_GAS_CORRECTION_FACTOR

          completeReq.request.gas = ethers.utils.hexValue(internalDestinationCallCost)
          completeReq.request.tokenGas = ethers.utils.hexValue(internalTokenCallCost)
          completeReq.request.nonce = nonceBefore.add(BigNumber.from(1)).toString();
          
          ({ signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner));

        detailedEstimation = await ethers.provider.estimateGas({
            from: relayWorker.address,
            to: relayHub.address,
            data: relayHub.interface.encodeFunctionData('relayCall', [completeReq, sig]),
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
          relayWorkerFinalBalance = await token.balanceOf(relayWorker.address)

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

          nonceAfter = await forwarder.nonce()
          expect(
            nonceBefore.add(2).toNumber()).to.equal(
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          txReceipt = await result.wait();

          console.log(
            `Cumulative Gas Used in second run: ${txReceipt.cumulativeGasUsed.toString()}`,
          )
        })

        it('gas prediction tests - without token payment', async function () {
          const nonceBefore = await forwarder.nonce()
          let swalletInitialBalance = await token.balanceOf(
            forwarder.address,
          )
          let relayWorkerInitialBalance = await token.balanceOf(relayWorker.address)
          let message =
            'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING '
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)
          message = message.concat(message)

          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessage',
            [message]
          );

          const completeReq: RelayRequest = cloneRelayRequest(
            { 
                request: {
                    nonce: nonceBefore.toString(),
                    tokenAmount: '0x00',
                    tokenContract: ethers.constants.AddressZero,
                    tokenGas: '0x00',
                    data: encodedFunction
                }
             },
          )

          let estimatedDestinationCallGas = await ethers.provider.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
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

          completeReq.request.gas = ethers.utils.hexValue(internalDestinationCallCost)

          let { signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

          let detailedEstimation = await ethers.provider.estimateGas({
            from: relayWorker.address,
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
          const estimatedCost = a1 * internalDestinationCallCost + a0

          console.log(
            'The destination contract call estimate is: ',
            internalDestinationCallCost,
          )
          console.log('X = ', internalDestinationCallCost)
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
            swalletInitialBalance.eq(sWalletFinalBalance)).to.equal(true,
            'SW Payment did occur',
          )
          expect(
            relayWorkerFinalBalance.eq(relayWorkerInitialBalance)).to.equal(true,
            'Worker did receive payment',
          )

          let nonceAfter = await forwarder.nonce()
          expect(
            nonceBefore.add(1).toNumber()).to.equal(
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          let txReceipt = await relayCallResult.wait();

          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`)

          // SECOND CALL

          swalletInitialBalance = await token.balanceOf(forwarder.address)
          relayWorkerInitialBalance = await token.balanceOf(relayWorker.address)

          estimatedDestinationCallGas = await ethers.provider.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          internalDestinationCallCost =
            estimatedDestinationCallGas.toNumber() >
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              ? estimatedDestinationCallGas.toNumber() -
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              : estimatedDestinationCallGas.toNumber()
          internalDestinationCallCost =
            internalDestinationCallCost *
            ESTIMATED_GAS_CORRECTION_FACTOR

          completeReq.request.gas = ethers.utils.hexValue(internalDestinationCallCost)

          completeReq.request.nonce = nonceBefore.add(BigNumber.from(1)).toString();
          
          ({signature: sig} = await getSuffixDataAndSignature(forwarder, completeReq, owner));

          detailedEstimation = await ethers.provider.estimateGas({
            from: relayWorker.address,
            to: relayHub.address,
            data: relayHub.interface.encodeFunctionData('relayCall', [completeReq, sig]),
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
          relayWorkerFinalBalance = await token.balanceOf(relayWorker.address)

          expect(
            swalletInitialBalance.eq(sWalletFinalBalance)).to.equal(true,
            'SW Payment did occur',
          )
          expect(
            relayWorkerFinalBalance.eq(relayWorkerInitialBalance)).to.equal(true,
            'Worker did receive payment',
          )

          nonceAfter = await forwarder.nonce()
          expect(
            nonceBefore.add(2).toNumber()).to.equal(
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          txReceipt = await result.wait();

          console.log(
            `Cummulative Gas Used in second run: ${txReceipt.cumulativeGasUsed.toString()}`,
          )
        })

        it('gas estimation tests for SmartWallet', async function () {
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
          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessage',
            [message]
          );

          const completeReq: RelayRequest = cloneRelayRequest(
            { 
                request: {
                    nonce: nonceBefore.toString(),
                    tokenAmount: '0x00',
                    tokenContract: ethers.constants.AddressZero,
                    tokenGas: '0x00',
                    data: encodedFunction
                }
             },
          )

          const { signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

          const estimatedDestinationCallCost = await ethers.provider.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: completeReq.request.to,
            gasPrice: completeReq.relayData.gasPrice,
            data: completeReq.request.data,
          })

          // tokenAmount is set to 0
          const tokenPaymentEstimation = 0
          /* const tokenPaymentEstimation = await ethers.provider.estimateGas({
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
            a1 * (estimatedDestinationCallCost.toNumber() + tokenPaymentEstimation) + a0

          console.log(
            'The destination contract call estimate is: ',
            estimatedDestinationCallCost,
          )
          console.log('The token gas estimate is: ', tokenPaymentEstimation)
          console.log(
            'X = ',
            estimatedDestinationCallCost.toNumber() + tokenPaymentEstimation,
          )

          console.log('The predicted total cost is: ', estimatedCost)
          const relayCallResult = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          const nonceAfter = await forwarder.nonce()
          expect(
            nonceBefore.add(1).toNumber()).to.equal(
            nonceAfter.toNumber(),
            'Incorrect nonce after execution',
          )

          const eventHash = keccak256(Buffer.from('GasUsed(uint256,uint256)'));
          const txReceipt = await relayCallResult.wait();

          // const costForCalling = 0;
          // const overheadCost = txReceipt.cumulativeGasUsed - costForCalling - estimatedDestinationCallCost;
          // console.log('data overhead: ', overheadCost);

          // console.log('---------------SmartWallet: RelayCall metrics------------------------')
          console.log(`Cumulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`)
          console.log(`Gas Used: ${txReceipt.gasUsed.toString()}`)

          let previousGas = BigInt(0)
          let previousStep: string | null = null
          for (let i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i];
            if ('0x' + eventHash === log?.topics[0]) {
              const step = log.data.substring(0, 66)
              const gasUsed = BigInt(
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
              previousGas = BigInt(gasUsed)
              previousStep = step
            }
          }

          const callWithoutRelay = await recipient.emitMessage(message)
          const callWithoutrelayReceipt = await callWithoutRelay.wait();
          const cumulativeGasUsedWithoutRelay = callWithoutrelayReceipt.cumulativeGasUsed.toNumber();
          const gasOverhead =
            txReceipt.cumulativeGasUsed.toNumber() - cumulativeGasUsedWithoutRelay
          console.log(
            '--------------- Destination Call Without enveloping------------------------',
          )
          console.log(
            `Gas Used: ${callWithoutrelayReceipt.gasUsed.toString()}, Cummulative Gas Used: ${cumulativeGasUsedWithoutRelay}`,
          )
          console.log('---------------------------------------')
          console.log(
            '--------------- Destination Call with enveloping------------------------',
          )
          console.log(
            `Gas Used: ${txReceipt.gasUsed.toString()}, CumulativeGasUsed: ${txReceipt.cumulativeGasUsed.toString()}`,
          )
          console.log('---------------------------------------')
          console.log(
            `--------------- Enveloping Overhead (message length: ${message.length}) ------------------------`,
          )
          console.log(`Overhead Gas: ${gasOverhead}`)
          console.log('---------------------------------------')

          console.log('Round 2')

          completeReq.request.nonce = nonceAfter.toString()
          const { signature: sig2 } = await getSuffixDataAndSignature(forwarder, completeReq, owner);
          const relayCallResult2 = await relayHub.relayCall(
            completeReq,
            sig2,
            {
              from: relayWorker.address,
              gasLimit,
              gasPrice,
            },
          )
          const txReceipt2 = await relayCallResult2.wait();
          console.log(
            '--------------- Destination Call with enveloping------------------------',
          )
          console.log(
            `Gas Used: ${txReceipt2.gasUsed.toString()}, CumulativeGasUsed: ${txReceipt2.cumulativeGasUsed.toString()}`,
          )
        })

        it('gas estimation tests', async function () {

            const encodedFunction = recipient.interface.encodeFunctionData(
                'emitMessage',
                [message]
              );

              const nonceBefore = await forwarder.nonce()

          const completeReq = cloneRelayRequest({
            request: {
              data: encodedFunction,
              nonce: nonceBefore.toString(),
              tokenAmount: '0',
              tokenGas: '0',
            }
          })

          const { signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

          const relayCallResult = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })

          const nonceAfter = await forwarder.nonce();
          expect(nonceBefore.add(1).toNumber()).to.equal(nonceAfter.toNumber());

          const eventHash = keccak256(Buffer.from('GasUsed(uint256,uint256)'));
          const txReceipt = await relayCallResult.wait()
          console.log('---------------------------------------')

          console.log(`Gas Used: ${txReceipt.gasUsed.toString()}`)
          console.log(`Cummulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`)

          let previousGas = BigInt(0)
          let previousStep: null | string = null
          for (let i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i]
            if ('0x' + eventHash === log?.topics[0]) {
              const step = log.data.substring(0, 66)
              const gasUsed = BigInt(
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
              previousGas = BigInt(gasUsed)
              previousStep = step
            }
          }
        })

        async function forgeRequest(
            transferReceiver: string,
            balanceToTransfer: string,
            fees: string
        ) {
            const isSponsored = fees === '0';
            const tokenContract = isSponsored
                ? ethers.constants.AddressZero
                : token.address;

            const completeReq: RelayRequest = cloneRelayRequest(
                {
                    request: {
                        data: token.interface.encodeFunctionData('transfer', [ transferReceiver, balanceToTransfer ]),
                        nonce: (await forwarder.nonce()).toString(),
                        tokenAmount: fees,
                        tokenContract,
                    }
                }
            );
 
            const estimatedDestinationCallGas =
                await ethers.provider.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: completeReq.request.to,
                    gasPrice: completeReq.relayData.gasPrice,
                    data: completeReq.request.data
                });

            let internalDestinationCallCost =
            estimatedDestinationCallGas.toNumber() >
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              ? estimatedDestinationCallGas.toNumber() -
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
              : estimatedDestinationCallGas.toNumber()
          internalDestinationCallCost =
            internalDestinationCallCost *
            ESTIMATED_GAS_CORRECTION_FACTOR;
            
            completeReq.request.gas = ethers.utils.hexValue(
                internalDestinationCallCost
            );

            const estimatedTokenPaymentGas = await ethers.provider.estimateGas(
                {
                    from: completeReq.relayData.callForwarder,
                    to: token.address,
                    data: token.interface.encodeFunctionData('transfer', [relayWorker.address, fees])
                }
            );

            if (!isSponsored) {
                let internalTokenCallCost =
                estimatedTokenPaymentGas.toNumber() >
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                  ? estimatedTokenPaymentGas.toNumber() -
                    INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                  : estimatedTokenPaymentGas.toNumber()
              internalTokenCallCost =
                internalTokenCallCost * ESTIMATED_GAS_CORRECTION_FACTOR

                completeReq.request.tokenGas = ethers.utils.hexValue(
                    internalTokenCallCost
                );
            }

            return completeReq;
        }

        async function estimateGasOverhead(fees: string) {
          // refill SW balance
          await token.mint('10000', forwarder.address)

          const swalletInitialBalance = await token.balanceOf(
            forwarder.address,
          )
          const relayWorkerInitialBalance = await token.balanceOf(relayWorker.address)

          const [ firstAccount, transferReceiver ] = await ethers.getSigners() as [SignerWithAddress, SignerWithAddress]
          // necessary to execute the transfer tx without relay
          await token.mint('10000', firstAccount.address)
          const balanceToTransfer = 1000

          // forge the request
          const completeReq: RelayRequest = await forgeRequest(
            transferReceiver.address,
            balanceToTransfer.toString(),
            fees,
          )

          const { signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

          const relayCallResult = await relayHub.relayCall(completeReq, sig, {
            from: relayWorker.address,
            gasLimit,
            gasPrice,
          })
          const txReceipt = await relayCallResult.wait();

          // assert the transaction has been relayed correctly
          const sWalletFinalBalance = await token.balanceOf(
            forwarder.address,
          )
          const relayWorkerFinalBalance = await token.balanceOf(relayWorker.address)
          expect(
            swalletInitialBalance.eq(
              sWalletFinalBalance
                .add(BigNumber.from(fees))
                .add(BigNumber.from(balanceToTransfer)),
            )).to.equal(true,
            'SW Payment did not occur',
          )
          expect(
            relayWorkerFinalBalance.eq(
              relayWorkerInitialBalance.add(BigNumber.from(fees)),
            )).to.equal(
            'Worker did not receive payment',
          )
          await printGasStatus(txReceipt)
        }

        it.only('gas estimation tests for token transfer - with token payment', async function () {
          await estimateGasOverhead('5000')
        })

        it('gas estimation tests for token transfer - without token payment', async function () {
          await estimateGasOverhead('0')
        })
      })
    })
  })
})

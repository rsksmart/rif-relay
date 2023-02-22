import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, ContractReceipt, Wallet, providers } from 'ethers';
import {
  UtilToken,
  SmartWalletFactory,
  Penalizer,
  RelayHub,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  CommonEnvelopingRequestBody,
  ESTIMATED_GAS_CORRECTION_FACTOR,
  EnvelopingRequest,
  EnvelopingRequestData,
  INTERNAL_TRANSACTION_ESTIMATED_CORRECTION,
  RelayRequest,
  RelayRequestBody,
} from '@rsksmart/rif-relay-client';
import {
  TestRecipient,
  TestVerifierEverythingAccepted,
} from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  getSuffixDataAndSignature,
  createSmartWalletFactory,
  createSupportedSmartWallet,
  RSK_URL,
} from './utils/TestUtils';

function logGasOverhead(gasOverhead: BigNumber) {
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
    .then((contractFactory) => contractFactory.deploy() as Contract);
};

describe('RelayHub GasEstimation', function () {
  let penalizer: Penalizer;
  let relayHub: RelayHub;
  let verifier: TestVerifierEverythingAccepted;
  let recipient: TestRecipient;
  let token: UtilToken;
  let factory: SmartWalletFactory;
  let relayWorker: SignerWithAddress;
  let relayManager: SignerWithAddress;
  let relayOwner: SignerWithAddress;
  let fundedAccount: SignerWithAddress;
  let relayHubSigner: SignerWithAddress;
  let owner: Wallet;
  let provider: providers.JsonRpcProvider;
  const gasPrice = 1;
  const gasLimit = 4e6;

  const deployHub = (penalizerAddress: string) => {
    return ethers
      .getContractFactory('RelayHub')
      .then((contract) =>
        contract.deploy(
          penalizerAddress,
          10,
          (1e18).toString(),
          1000,
          (1e18).toString()
        )
      );
  };

  const cloneEnvelopingRequest = (
    envelopingRequest: EnvelopingRequest,
    override: {
      request?: Partial<CommonEnvelopingRequestBody>;
      relayData?: Partial<EnvelopingRequestData>;
    }
  ): EnvelopingRequest => {
    return {
      request: { ...envelopingRequest.request, ...override.request },
      relayData: { ...envelopingRequest.relayData, ...override.relayData },
    };
  };

  beforeEach(async function () {
    provider = new ethers.providers.JsonRpcProvider(RSK_URL);
    owner = ethers.Wallet.createRandom().connect(provider);
    [relayWorker, relayManager, relayOwner, fundedAccount, relayHubSigner] =
      (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress,
        SignerWithAddress,
        SignerWithAddress,
        SignerWithAddress
      ];

    penalizer = await deployContract('Penalizer');
    verifier = await deployContract('TestVerifierEverythingAccepted');
    recipient = await deployContract('TestRecipient');
    token = await deployContract('UtilToken');
    const smartWalletTemplate = await deployContract<SmartWallet>(
      'SmartWallet'
    );

    relayHub = await deployHub(penalizer.address);

    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    });

    factory = (await createSmartWalletFactory(
      smartWalletTemplate,
      false,
      owner
    )) as SmartWalletFactory;
  });

  describe('relayCall', function () {
    let relayRequest: RelayRequest;
    let forwarder: SmartWallet;

    beforeEach(async function () {
      forwarder = (await createSupportedSmartWallet({
        relayHub: relayHubSigner.address,
        factory,
        owner,
        sender: relayHubSigner,
      })) as SmartWallet;

      await token.mint('1000', forwarder.address);

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
      };
    });

    const cloneRelayRequest = (override: {
      request?: Partial<RelayRequestBody>;
      relayData?: Partial<EnvelopingRequestData>;
    }) => {
      return cloneEnvelopingRequest(relayRequest, override) as RelayRequest;
    };

    context('with staked and registered relay', function () {
      const url = 'http://relay.com';
      const message = 'Enveloping RelayHub';

      beforeEach(async function () {
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('2'),
          });

        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
        await relayHub.connect(relayManager).registerRelayServer(url);
      });

      context('with funded verifier', function () {
        async function printGasStatus(receipt: ContractReceipt) {
          const [firstAccount] = (await ethers.getSigners()) as [
            SignerWithAddress
          ];
          await token.mint('1000', firstAccount.address);

          const noRelayCall = await token.transfer(owner.address, '1000');
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

        function printGasPrediction({
          internalDestinationCallCost,
          internalTokenCallCost,
        }: {
          internalDestinationCallCost: number;
          internalTokenCallCost: number;
        }) {
          // gas estimation fit
          // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
          // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
          const a0 = Number('35095.980');
          const a1 = Number('1.098');
          const estimatedCost =
            a1 * (internalDestinationCallCost + internalTokenCallCost) + a0;
          console.log('The predicted total cost is: ', estimatedCost);
        }

        function printGasAnalysis({
          cumulativeGasUsed,
          detailedEstimation,
          internalDestinationCallCost,
          internalTokenCallCost,
        }: {
          internalDestinationCallCost: number;
          internalTokenCallCost: number;
          detailedEstimation: number;
          cumulativeGasUsed: number;
        }) {
          console.log(
            'The destination contract call estimate is: ',
            internalDestinationCallCost
          );
          console.log('The token gas estimate is: ', internalTokenCallCost);
          console.log(
            'X = ',
            internalDestinationCallCost + internalTokenCallCost
          );

          console.log('Detailed estimation: ', detailedEstimation);
          console.log('Cumulative Gas Used:', cumulativeGasUsed);
        }

        const assertRelayedTransaction = async (
          forwarderInitialBalance: BigNumber,
          relayWorkerInitialBalance: BigNumber,
          balanceToTransfer: BigNumber,
          fees?: BigNumber
        ) => {
          const forwarderFinalBalance = await token.balanceOf(
            forwarder.address
          );
          const relayWorkerFinalBalance = await token.balanceOf(
            relayWorker.address
          );

          expect(
            forwarderInitialBalance.eq(
              forwarderFinalBalance
                .add(balanceToTransfer)
                .add(BigNumber.from(fees ?? 0))
            )
          ).to.equal(true, 'SW Payment did not occur');
          expect(
            relayWorkerFinalBalance.eq(
              relayWorkerInitialBalance.add(fees ?? balanceToTransfer)
            )
          ).to.equal(true, 'Worker did not receive payment');
        };

        const assertNonce = async (nonceBefore: BigNumber) => {
          const nonceAfter = await forwarder.nonce();
          expect(nonceBefore.add(1).toNumber()).to.equal(
            nonceAfter.toNumber(),
            'Incorrect nonce after execution'
          );
        };

        const correctEstimatedCallCost = (estimate: number) => {
          const correction = INTERNAL_TRANSACTION_ESTIMATED_CORRECTION;

          return (
            ESTIMATED_GAS_CORRECTION_FACTOR *
            (estimate > correction ? estimate - correction : estimate)
          );
        };

        const getCurrentBalances = async () => {
          const nonceBefore = await forwarder.nonce();
          const forwarderInitialBalance = await token.balanceOf(
            forwarder.address
          );
          const relayWorkerInitialBalance = await token.balanceOf(
            relayWorker.address
          );

          return {
            nonceBefore,
            forwarderInitialBalance,
            relayWorkerInitialBalance,
          };
        };

        const triggerRelayCallProcess = async ({
          message,
          estimateGasLimit,
          noPayment,
          noTokenGas,
          noTokenContract,
          noCorrection,
        }: {
          message: string;
          estimateGasLimit?: boolean;
          noPayment?: boolean;
          noTokenGas?: boolean;
          noTokenContract?: boolean;
          noCorrection?: boolean;
        }) => {
          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessage',
            [message]
          );

          await token.mint('100', forwarder.address);

          const {
            nonceBefore,
            forwarderInitialBalance,
            relayWorkerInitialBalance,
          } = await getCurrentBalances();

          const balanceToTransfer = noPayment
            ? '0x00'
            : forwarderInitialBalance.toNumber();

          const estimatedDestinationCallGas = await ethers.provider.estimateGas(
            {
              from: forwarder.address,
              to: recipient.address,
              gasPrice,
              data: encodedFunction,
            }
          );

          const internalDestinationCallCost = noCorrection
            ? estimatedDestinationCallGas.toNumber()
            : correctEstimatedCallCost(estimatedDestinationCallGas.toNumber());

          let internalTokenCallCost = 0;
          if (!noTokenGas) {
            const estimatedTokenPaymentGas = await ethers.provider.estimateGas({
              from: forwarder.address,
              to: token.address,
              data: token.interface.encodeFunctionData('transfer', [
                relayWorker.address,
                balanceToTransfer,
              ]),
            });
            internalTokenCallCost = correctEstimatedCallCost(
              estimatedTokenPaymentGas.toNumber()
            );
          }

          const completeReq: RelayRequest = cloneRelayRequest({
            request: {
              nonce: nonceBefore.toString(),
              tokenAmount: balanceToTransfer,
              data: encodedFunction,
              gas: internalDestinationCallCost,
              tokenGas: internalTokenCallCost,
              tokenContract: noTokenContract
                ? ethers.constants.AddressZero
                : token.address,
            },
          });

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            completeReq,
            owner
          );

          const detailedEstimation = await ethers.provider.estimateGas({
            from: relayWorker.address,
            to: relayHub.address,
            data: relayHub.interface.encodeFunctionData('relayCall', [
              completeReq,
              signature,
            ]),
            gasPrice,
            gasLimit: estimateGasLimit ? gasLimit : undefined,
          });

          const relayCallResult = await relayHub
            .connect(relayWorker)
            .relayCall(completeReq, signature, {
              gasLimit,
              gasPrice,
            });

          await assertRelayedTransaction(
            forwarderInitialBalance,
            relayWorkerInitialBalance,
            BigNumber.from(balanceToTransfer)
          );

          await assertNonce(nonceBefore);

          const { cumulativeGasUsed, gasUsed } = await relayCallResult.wait();

          return {
            gasUsed,
            cumulativeGasUsed: cumulativeGasUsed.toNumber(),
            detailedEstimation: detailedEstimation.toNumber(),
            internalDestinationCallCost,
            internalTokenCallCost,
          };
        };
        it('gas prediction tests - with token payment', async function () {
          let message =
            'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING ';
          message = message.concat(message);

          const relayCallProcessFirstResult = await triggerRelayCallProcess({
            message,
            estimateGasLimit: true,
          });

          printGasPrediction(relayCallProcessFirstResult);
          printGasAnalysis(relayCallProcessFirstResult);

          // SECOND CALL
          console.log('ROUND 2');
          const relayCallProcessSecondResult = await triggerRelayCallProcess({
            message,
          });

          printGasAnalysis(relayCallProcessSecondResult);
        });

        it('gas prediction tests - without token payment', async function () {
          let message =
            'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING ';
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);

          const relayCallProcessFirstResult = await triggerRelayCallProcess({
            message,
            estimateGasLimit: true,
            noPayment: true,
            noTokenGas: true,
          });

          printGasPrediction(relayCallProcessFirstResult);
          printGasAnalysis(relayCallProcessFirstResult);

          // SECOND CALL
          console.log('ROUND 2');
          const relayCallProcessSecondResult = await triggerRelayCallProcess({
            message,
            noPayment: true,
            noTokenGas: true,
          });

          printGasAnalysis(relayCallProcessSecondResult);
        });

        it('gas estimation tests for SmartWallet', async function () {
          let message =
            'RIF Enveloping RIF Enveloping RIF Enveloping RIF Enveloping';
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);
          message = message.concat(message);

          const { gasUsed, cumulativeGasUsed } = await triggerRelayCallProcess({
            message,
            estimateGasLimit: true,
            noPayment: true,
            noTokenGas: true,
            noTokenContract: true,
            noCorrection: true,
          });

          const callWithoutRelay = await recipient.emitMessage(message);
          const callWithoutRelayReceipt = await callWithoutRelay.wait();
          const cumulativeGasUsedWithoutRelay =
            callWithoutRelayReceipt.cumulativeGasUsed.toNumber();
          const gasOverhead = cumulativeGasUsed - cumulativeGasUsedWithoutRelay;
          console.log(
            '--------------- Destination Call Without enveloping------------------------'
          );
          console.log(
            `Gas Used: ${callWithoutRelayReceipt.gasUsed.toNumber()}, Cummulative Gas Used: ${cumulativeGasUsedWithoutRelay}`
          );
          console.log('---------------------------------------');
          console.log(
            '--------------- Destination Call with enveloping------------------------'
          );
          console.log(
            `Gas Used: ${gasUsed.toNumber()}, CumulativeGasUsed: ${cumulativeGasUsed}`
          );
          console.log('---------------------------------------');
          console.log(
            `--------------- Enveloping Overhead (message length: ${message.length}) ------------------------`
          );
          console.log(`Overhead Gas: ${gasOverhead}`);
          console.log('---------------------------------------');

          console.log('Round 2');

          const {
            gasUsed: gasUsedRound2,
            cumulativeGasUsed: cumulativeGasUsedRound2,
          } = await triggerRelayCallProcess({
            message,
            estimateGasLimit: true,
            noPayment: true,
            noTokenGas: true,
            noTokenContract: true,
            noCorrection: true,
          });
          console.log(
            '--------------- Destination Call with enveloping------------------------'
          );
          console.log(
            `Gas Used: ${gasUsedRound2.toNumber()}, CumulativeGasUsed: ${cumulativeGasUsedRound2}`
          );
        });

        it('gas estimation tests', async function () {
          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessage',
            [message]
          );

          const nonceBefore = await forwarder.nonce();

          const completeReq = cloneRelayRequest({
            request: {
              data: encodedFunction,
              nonce: nonceBefore.toString(),
              tokenAmount: '0',
              tokenGas: '0',
            },
          });

          const { signature: sig } = await getSuffixDataAndSignature(
            forwarder,
            completeReq,
            owner
          );

          const relayCallResult = await relayHub
            .connect(relayWorker)
            .relayCall(completeReq, sig, {
              gasLimit,
              gasPrice,
            });

          const nonceAfter = await forwarder.nonce();
          expect(nonceBefore.add(1).toNumber()).to.equal(nonceAfter.toNumber());

          const txReceipt = await relayCallResult.wait();
          console.log('---------------------------------------');

          console.log(`Gas Used: ${txReceipt.gasUsed.toString()}`);
          console.log(
            `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`
          );
        });

        async function forgeRequest(
          transferReceiver: string,
          balanceToTransfer: number,
          fees: string
        ) {
          const isSponsored = fees === '0';
          const tokenContract = isSponsored
            ? ethers.constants.AddressZero
            : token.address;

          const encodedFunction = token.interface.encodeFunctionData(
            'transfer',
            [transferReceiver, balanceToTransfer]
          );

          const estimatedDestinationCallGas = await ethers.provider.estimateGas(
            {
              from: forwarder.address,
              to: token.address,
              gasPrice,
              data: encodedFunction,
            }
          );

          const internalDestinationCallCost = correctEstimatedCallCost(
            estimatedDestinationCallGas.toNumber()
          );

          const estimatedTokenPaymentGas = await ethers.provider.estimateGas({
            from: forwarder.address,
            to: token.address,
            data: token.interface.encodeFunctionData('transfer', [
              relayWorker.address,
              fees,
            ]),
          });

          const tokenGas = !isSponsored
            ? {
                tokenGas: correctEstimatedCallCost(
                  estimatedTokenPaymentGas.toNumber()
                ),
              }
            : {};

          const completeReq: RelayRequest = cloneRelayRequest({
            request: {
              data: encodedFunction,
              to: token.address,
              nonce: (await forwarder.nonce()).toString(),
              tokenAmount: fees,
              tokenContract,
              gas: internalDestinationCallCost,
              ...tokenGas,
            },
          });

          return completeReq;
        }

        async function estimateGasOverhead(fees: string) {
          // refill SW balance
          await token.mint('9000', forwarder.address);

          const { forwarderInitialBalance, relayWorkerInitialBalance } =
            await getCurrentBalances();

          const transferReceiver = ethers.Wallet.createRandom();

          // necessary to execute the transfer tx without relay
          const balanceToTransfer = 1000;

          // forge the request
          const completeReq: RelayRequest = await forgeRequest(
            transferReceiver.address,
            balanceToTransfer,
            fees
          );

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            completeReq,
            owner
          );

          const relayCallResult = await relayHub
            .connect(relayWorker)
            .relayCall(completeReq, signature, {
              gasLimit,
              gasPrice,
            });
          const txReceipt = await relayCallResult.wait();

          await assertRelayedTransaction(
            forwarderInitialBalance,
            relayWorkerInitialBalance,
            BigNumber.from(balanceToTransfer),
            BigNumber.from(fees)
          );
          await printGasStatus(txReceipt);
        }

        it('gas estimation tests for token transfer - with token payment', async function () {
          await estimateGasOverhead('5000');
        });

        it('gas estimation tests for token transfer - without token payment', async function () {
          await estimateGasOverhead('0');
        });
      });
    });
  });
});

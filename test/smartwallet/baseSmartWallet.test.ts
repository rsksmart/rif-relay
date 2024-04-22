import { BaseProvider } from '@ethersproject/providers';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers as hardhat } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TestForwarder, TestTarget } from 'typechain-types';
import { Wallet, providers } from 'ethers';
import {
  TEST_TOKEN_NAME,
  NON_REVERT_TEST_TOKEN_NAME,
  TETHER_TOKEN_NAME,
  INITIAL_SMART_WALLET_TOKEN_AMOUNT,
  TokenToTest,
  prepareToken,
  mintTokens,
  getLogArguments,
  TokenName,
} from './utils';
import {
  createSmartWalletFactory,
  createSupportedSmartWallet,
  getSuffixDataAndSignature,
  getSuffixData,
  SupportedSmartWallet,
  RSK_URL,
  deployContract,
  createRelayEnvelopingRequest,
  SupportedType,
  getSmartWalletTemplate,
} from '../utils/TestUtils';
import {
  RelayRequest,
  INTERNAL_TRANSACTION_ESTIMATED_CORRECTION,
} from '@rsksmart/rif-relay-client';
import {
  getLocalEip712Signature,
  TypedRequestData,
} from '../utils/EIP712Utils';

chai.use(chaiAsPromised);

const INITIAL_SMART_WALLET_RBTC_AMOUNT = 50;
const TOKEN_AMOUNT_TO_TRANSFER = 1;
const RBTC_AMOUNT_TO_TRANSFER = hardhat.utils.parseEther('1');

const TYPES_OF_WALLETS: SupportedType[] = ['Default', 'Custom' /* 'Boltz' */];

const TOKENS: TokenName[] = [
  TEST_TOKEN_NAME,
  NON_REVERT_TEST_TOKEN_NAME,
  TETHER_TOKEN_NAME,
];

TYPES_OF_WALLETS.forEach((typeOfWallet) => {
  describe(`Base SmartWallet tests using ${typeOfWallet}`, function () {
    let provider: BaseProvider;
    let owner: Wallet;
    let supportedSmartWallet: SupportedSmartWallet;
    let supportedSmartWalletTemplate: SupportedSmartWallet;
    let relayHub: SignerWithAddress;

    before(async function () {
      //Create the any of the supported smart wallet templates

      supportedSmartWalletTemplate = await deployContract<SupportedSmartWallet>(
        getSmartWalletTemplate(typeOfWallet)
      );

      // We couldn't use hardhat.provider, because we couldn't retrieve the revert reason.
      provider = new providers.JsonRpcProvider(RSK_URL);
    });

    beforeEach(async function () {
      const [, fundedAccount, localRelayHub] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = hardhat.Wallet.createRandom().connect(provider);

      //Fund the owner
      await fundedAccount?.sendTransaction({
        to: owner.address,
        value: hardhat.utils.parseEther('10'),
      });

      const supportedSmartWalletFactory = await createSmartWalletFactory(
        supportedSmartWalletTemplate,
        owner,
        typeOfWallet
      );

      supportedSmartWallet = await createSupportedSmartWallet({
        type: typeOfWallet,
        owner,
        index: 0,
        factory: supportedSmartWalletFactory,
        relayHub: relayHub.address,
        sender: relayHub,
      });
    });

    describe('Verify', function () {
      describe('Verify success', function () {
        it('Should verify valid signature', async function () {
          const relayRequest = createRelayEnvelopingRequest(
            {
              from: owner.address,
              relayHub: relayHub.address,
            },
            {
              callForwarder: supportedSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          await supportedSmartWallet.verify(
            suffixData,
            relayRequest.request,
            signature
          );

          await expect(
            supportedSmartWallet.verify(
              suffixData,
              relayRequest.request,
              signature
            )
          ).not.to.be.rejected;
        });
      });

      describe('Verify failures', function () {
        it('Should fail when the domain separator is wrong', async function () {
          //The signature should be obtained manually here to be able to inject a
          //wrong domain separator name
          const relayRequest = createRelayEnvelopingRequest(
            {
              from: owner.address,
              relayHub: relayHub.address,
            },
            {
              callForwarder: supportedSmartWallet.address,
            }
          ) as RelayRequest;

          const { chainId } = await provider.getNetwork();

          const typedRequestData = new TypedRequestData(
            chainId,
            supportedSmartWallet.address,
            relayRequest
          );

          typedRequestData.domain.name = 'Wrong domain separator';

          const privateKey = Buffer.from(
            owner.privateKey.substring(2, 66),
            'hex'
          );

          const suffixData = getSuffixData(typedRequestData);
          const signature = getLocalEip712Signature(
            typedRequestData,
            privateKey
          );

          await expect(
            supportedSmartWallet.verify(
              suffixData,
              relayRequest.request,
              signature
            )
          ).to.be.rejectedWith('Signature mismatch');
        });

        it('Should fail when the nonce is wrong', async function () {
          const WRONG_NONCE = '123';

          const relayRequest = createRelayEnvelopingRequest({
            from: owner.address,
            relayHub: relayHub.address,
            nonce: WRONG_NONCE,
          }) as RelayRequest;

          const { suffixData, signature } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          await expect(
            supportedSmartWallet.verify(
              suffixData,
              relayRequest.request,
              signature
            )
          ).to.be.rejectedWith('nonce mismatch');
        });

        it('Should fail when the signature is invalid', async function () {
          const relayRequest = createRelayEnvelopingRequest({
            from: owner.address,
            relayHub: relayHub.address,
          }) as RelayRequest;

          const { suffixData } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          await expect(
            supportedSmartWallet.verify(suffixData, relayRequest.request, '0x'),
            'Signature as 0x'
          ).to.be.rejectedWith('ECDSA: invalid signature length');

          await expect(
            supportedSmartWallet.verify(
              suffixData,
              relayRequest.request,
              '0x123456'
            ),
            'Signature as 0x123456'
          ).to.be.rejectedWith('ECDSA: invalid signature length');

          await expect(
            supportedSmartWallet.verify(
              suffixData,
              relayRequest.request,
              '0x' + '1b'.repeat(65)
            ),
            'Wrong signature with correct length'
          ).to.be.rejectedWith('Signature mismatch');
        });
      });
    });

    for (const tokenName of TOKENS) {
      describe(`Verify and call with ${tokenName}`, function () {
        let feesReceiver: SignerWithAddress;
        let target: TestTarget;
        let token: TokenToTest;
        let forwarder: TestForwarder;

        beforeEach(async function () {
          const [, fundedAccount, , localFeesReceiver] =
            await hardhat.getSigners();

          feesReceiver = localFeesReceiver as SignerWithAddress;

          await fundedAccount?.sendTransaction({
            to: supportedSmartWallet.address,
            value: hardhat.utils.parseEther(
              INITIAL_SMART_WALLET_RBTC_AMOUNT.toString()
            ),
          });

          const testForwarderFactory = await hardhat.getContractFactory(
            'TestForwarder'
          );
          forwarder = await testForwarderFactory.deploy();

          const targetFactory = await hardhat.getContractFactory('TestTarget');
          target = await targetFactory.deploy();

          token = await prepareToken(tokenName);
          await mintTokens(
            token,
            tokenName,
            INITIAL_SMART_WALLET_TOKEN_AMOUNT,
            supportedSmartWallet.address
          );
        });

        it('Should call function and increase nonce', async function () {
          const TEST_MESSAGE = 'Test message';

          const targetFunction = target.interface.encodeFunctionData(
            'emitMessage',
            [TEST_MESSAGE]
          );

          const initialSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const initialNonce = await supportedSmartWallet.nonce();
          const estimatedGas = (
            await target.estimateGas.emitMessage(TEST_MESSAGE)
          ).sub(INTERNAL_TRANSACTION_ESTIMATED_CORRECTION);

          const relayRequest = createRelayEnvelopingRequest({
            data: targetFunction,
            to: target.address,
            nonce: initialNonce.toString(),
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
            tokenGas: 50000,
            relayHub: relayHub.address,
            from: owner.address,
            tokenContract: token.address,
            gas: estimatedGas.toString(),
          }) as RelayRequest;

          const { suffixData, signature } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          await expect(
            supportedSmartWallet
              .connect(relayHub)
              .execute(
                suffixData,
                relayRequest.request,
                feesReceiver.address,
                signature
              )
          )
            .to.emit(target, 'TestForwarderMessage')
            .withArgs(
              TEST_MESSAGE,
              supportedSmartWallet.address,
              relayHub.address
            );

          const finalSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const finalFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            initialFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(
            finalFeesReceiverTokenBalance
              .sub(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          expect(
            initialSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(
            finalSmartWalletTokenBalance
              .add(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          expect(
            await supportedSmartWallet.nonce(),
            'Wrong final nonce'
          ).to.be.equal(initialNonce.add(1));
        });

        it('Should revert when token amount is not provided', async function () {
          //Any function can be used since the goal is to make revert the operation before
          //it reaches the 'call' in one of the supported smart wallets
          const targetFunction = '0x';

          const initialSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const relayRequest = createRelayEnvelopingRequest({
            data: targetFunction,
            to: target.address,
            nonce: (await supportedSmartWallet.nonce()).toString(),
            tokenAmount: INITIAL_SMART_WALLET_TOKEN_AMOUNT + 1,
            tokenGas: 50000,
            relayHub: forwarder.address,
            from: owner.address,
            tokenContract: token.address,
            gas: 1000,
          }) as RelayRequest;

          const { suffixData, signature } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          await expect(
            forwarder.callExecute(
              supportedSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            ),
            'Operation not reverted'
          ).to.be.rejectedWith('Unable to pay for relay');

          const finalSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const finalFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            initialFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(finalFeesReceiverTokenBalance.toString());

          expect(
            initialSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(finalSmartWalletTokenBalance.toString());
        });

        it('Should transfer tokens even when the target operation fails', async function () {
          const targetFunction =
            target.interface.encodeFunctionData('testRevert');

          const initialSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const estimatedGas = (await target.estimateGas.testRevert()).sub(
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
          );

          const relayRequest = createRelayEnvelopingRequest({
            data: targetFunction,
            to: target.address,
            nonce: (await supportedSmartWallet.nonce()).toString(),
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
            tokenGas: 50000,
            relayHub: forwarder.address,
            from: owner.address,
            tokenContract: token.address,
            gas: estimatedGas.toString(),
          }) as RelayRequest;

          const { suffixData, signature } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          const contractTransaction = await forwarder.callExecute(
            supportedSmartWallet.address,
            relayRequest.request,
            suffixData,
            feesReceiver.address,
            signature
          );

          const { successArgument, errorArgument } = await getLogArguments(
            contractTransaction
          );

          expect(successArgument, 'The execute did not fail').to.be.equal(
            false
          );
          expect(errorArgument, 'The error was a different one').to.be.equal(
            'always fail'
          );

          const finalSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const finalFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            initialFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(
            finalFeesReceiverTokenBalance
              .sub(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          expect(
            initialSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(
            finalSmartWalletTokenBalance
              .add(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );
        });

        it('Should fail on re-submit after revert (repeated nonce)', async function () {
          const targetFunction =
            target.interface.encodeFunctionData('testRevert');

          const initialSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const estimatedGas = (await target.estimateGas.testRevert()).sub(
            INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
          );

          const relayRequest = createRelayEnvelopingRequest({
            data: targetFunction,
            to: target.address,
            nonce: (await supportedSmartWallet.nonce()).toString(),
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
            tokenGas: 50000,
            relayHub: forwarder.address,
            from: owner.address,
            tokenContract: token.address,
            gas: estimatedGas.toString(),
          }) as RelayRequest;

          const { suffixData, signature } = await getSuffixDataAndSignature(
            supportedSmartWallet,
            relayRequest,
            owner
          );

          const contractTransaction = await forwarder.callExecute(
            supportedSmartWallet.address,
            relayRequest.request,
            suffixData,
            feesReceiver.address,
            signature
          );

          const { successArgument, errorArgument } = await getLogArguments(
            contractTransaction
          );

          expect(successArgument, 'The execute did not fail').to.be.equal(
            false
          );
          expect(errorArgument, 'The error was a different one').to.be.equal(
            'always fail'
          );

          const currentSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const currentFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            initialFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(
            currentFeesReceiverTokenBalance
              .sub(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          expect(
            initialSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(
            currentSmartWalletTokenBalance
              .add(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          await expect(
            forwarder.callExecute(
              supportedSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            )
          ).to.be.rejectedWith('nonce mismatch');

          const finalSmartWalletTokenBalance = await token.balanceOf(
            supportedSmartWallet.address
          );
          const finalFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            currentFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(finalFeesReceiverTokenBalance.toString());

          expect(
            currentSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(finalSmartWalletTokenBalance.toString());
        });

        describe('Value transfer', function () {
          it('Should forward request with value', async function () {
            const targetFunction = target.interface.encodeFunctionData(
              'mustReceiveEth',
              [RBTC_AMOUNT_TO_TRANSFER.toString()]
            );

            const initialSmartWalletTokenBalance = await token.balanceOf(
              supportedSmartWallet.address
            );
            const initialFeesReceiverTokenBalance = await token.balanceOf(
              feesReceiver.address
            );
            const initialTargetRbtcBalance = await provider.getBalance(
              target.address
            );

            const estimatedGas = (
              await target.estimateGas.mustReceiveEth(RBTC_AMOUNT_TO_TRANSFER)
            ).sub(INTERNAL_TRANSACTION_ESTIMATED_CORRECTION);

            const relayRequest = createRelayEnvelopingRequest({
              data: targetFunction,
              to: target.address,
              nonce: (await supportedSmartWallet.nonce()).toString(),
              tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
              tokenGas: 50000,
              relayHub: forwarder.address,
              from: owner.address,
              tokenContract: token.address,
              gas: estimatedGas.toString(),
              value: RBTC_AMOUNT_TO_TRANSFER.toString(),
            }) as RelayRequest;

            const { suffixData, signature } = await getSuffixDataAndSignature(
              supportedSmartWallet,
              relayRequest,
              owner
            );

            const contractTransaction = await forwarder.callExecute(
              supportedSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            );
            const { successArgument } = await getLogArguments(
              contractTransaction
            );

            expect(successArgument, 'The execute failed').to.be.equal(true);

            const finalSmartWalletTokenBalance = await token.balanceOf(
              supportedSmartWallet.address
            );
            const finalFeesReceiverTokenBalance = await token.balanceOf(
              feesReceiver.address
            );
            const finalTargetRbtcBalance = await provider.getBalance(
              target.address
            );

            expect(
              initialFeesReceiverTokenBalance.toString(),
              'Wrong final token fees receiver balance'
            ).to.be.equal(
              finalFeesReceiverTokenBalance
                .sub(TOKEN_AMOUNT_TO_TRANSFER)
                .toString()
            );

            expect(
              initialSmartWalletTokenBalance.toString(),
              'Wrong final token smart wallet balance'
            ).to.be.equal(
              finalSmartWalletTokenBalance
                .add(TOKEN_AMOUNT_TO_TRANSFER)
                .toString()
            );

            expect(
              initialTargetRbtcBalance.toString(),
              'Wrong final ethers fees receiver balance'
            ).to.be.equal(
              finalTargetRbtcBalance.sub(RBTC_AMOUNT_TO_TRANSFER).toString()
            );
          });

          it('Should send all funds left in forwarder to owner', async function () {
            const targetFunction = target.interface.encodeFunctionData(
              'mustReceiveEth',
              [RBTC_AMOUNT_TO_TRANSFER.toString()]
            );

            const initialOwnerRbtcBalance = await provider.getBalance(
              owner.address
            );

            const estimatedGas = (
              await target.estimateGas.mustReceiveEth(RBTC_AMOUNT_TO_TRANSFER)
            ).sub(INTERNAL_TRANSACTION_ESTIMATED_CORRECTION);

            const relayRequest = createRelayEnvelopingRequest({
              data: targetFunction,
              to: target.address,
              nonce: (await supportedSmartWallet.nonce()).toString(),
              tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
              tokenGas: 50000,
              relayHub: forwarder.address,
              from: owner.address,
              tokenContract: token.address,
              gas: estimatedGas.toString(),
              value: RBTC_AMOUNT_TO_TRANSFER.toString(),
            }) as RelayRequest;

            const { suffixData, signature } = await getSuffixDataAndSignature(
              supportedSmartWallet,
              relayRequest,
              owner
            );

            const contractTransaction = await forwarder.callExecute(
              supportedSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            );
            const { successArgument } = await getLogArguments(
              contractTransaction
            );

            expect(successArgument, 'The execute failed').to.be.equal(true);

            const finalSmartWalletRbtcBalance = await provider.getBalance(
              supportedSmartWallet.address
            );
            const finalOwnerRbtcBalance = await provider.getBalance(
              owner.address
            );

            expect(
              finalSmartWalletRbtcBalance.toString(),
              'Wrong final smart wallet balance'
            ).to.be.equal('0');

            expect(
              finalOwnerRbtcBalance,
              'Wrong final owner balance'
            ).to.be.greaterThan(initialOwnerRbtcBalance);
          });

          it('should fail to forward request when the value is specified but less is provided', async function () {
            const targetFunction = target.interface.encodeFunctionData(
              'mustReceiveEth',
              [RBTC_AMOUNT_TO_TRANSFER.toString()]
            );

            const initialSmartWalletTokenBalance = await token.balanceOf(
              supportedSmartWallet.address
            );
            const initialFeesReceiverTokenBalance = await token.balanceOf(
              feesReceiver.address
            );

            const estimatedGas = (
              await target.estimateGas.mustReceiveEth(RBTC_AMOUNT_TO_TRANSFER)
            ).sub(INTERNAL_TRANSACTION_ESTIMATED_CORRECTION);

            const relayRequest = createRelayEnvelopingRequest({
              data: targetFunction,
              to: target.address,
              nonce: (await supportedSmartWallet.nonce()).toString(),
              tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
              tokenGas: 50000,
              relayHub: forwarder.address,
              from: owner.address,
              tokenContract: token.address,
              gas: estimatedGas.toString(),
              value: RBTC_AMOUNT_TO_TRANSFER.sub(1).toString(),
            }) as RelayRequest;

            const { suffixData, signature } = await getSuffixDataAndSignature(
              supportedSmartWallet,
              relayRequest,
              owner
            );

            const contractTransaction = await forwarder.callExecute(
              supportedSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            );
            const { successArgument, errorArgument } = await getLogArguments(
              contractTransaction
            );

            expect(successArgument, 'The execute did not fail').to.be.equal(
              false
            );
            expect(errorArgument, 'The error was a different one').to.be.equal(
              'Not enough balance'
            );

            const finalSmartWalletTokenBalance = await token.balanceOf(
              supportedSmartWallet.address
            );
            const finalFeesReceiverTokenBalance = await token.balanceOf(
              feesReceiver.address
            );

            expect(
              initialFeesReceiverTokenBalance.toString(),
              'Wrong final fees receiver balance'
            ).to.be.equal(
              finalFeesReceiverTokenBalance
                .sub(TOKEN_AMOUNT_TO_TRANSFER)
                .toString()
            );

            expect(
              initialSmartWalletTokenBalance.toString(),
              'Wrong final smart wallet balance'
            ).to.be.equal(
              finalSmartWalletTokenBalance
                .add(TOKEN_AMOUNT_TO_TRANSFER)
                .toString()
            );
          });
        });
      });
    }
  });
});

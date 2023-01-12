import { BaseProvider } from '@ethersproject/providers';
import {
  CustomSmartWallet__factory,
  SmartWallet__factory,
} from '@rsksmart/rif-relay-contracts';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers as hardhat } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TestForwarder, TestTarget } from 'typechain-types';
import {
  TEST_TOKEN_NAME,
  NON_REVERT_TEST_TOKEN_NAME,
  TETHER_TOKEN_NAME,
  INITIAL_SMART_WALLET_TOKEN_AMOUNT,
  RifSmartWallet,
  TokenToTest,
  prepareToken,
  mintTokens,
  getLogArguments,
} from './rifSmartWalletUtils';
import {
  createSmartWalletFactory,
  createSmartWallet,
  createEnvelopingRequest,
  signEnvelopingRequest,
} from '../TestUtils';
import {
  RelayRequest,
  relayRequestType,
  getEnvelopingRequestDataV4Field,
} from '@rsksmart/rif-relay-client';
import { _TypedDataEncoder } from 'ethers/lib/utils';

chai.use(chaiAsPromised);

const INITIAL_SMART_WALLET_RBTC_AMOUNT = 50;
const TOKEN_AMOUNT_TO_TRANSFER = 1;
const RBTC_AMOUNT_TO_TRANSFER = hardhat.utils.parseEther('1');

const CHARS_PER_FIELD = 64;
const PREFIX_HEX = '0x';

const CUSTOM_SMART_WALLET_TYPE: TypeOfWallet = 'CustomSmartWallet';
const SMART_WALLET_TYPE: TypeOfWallet = 'SmartWallet';
const TYPES_OF_WALLETS: TypeOfWallet[] = [
  CUSTOM_SMART_WALLET_TYPE,
  SMART_WALLET_TYPE,
];

const TOKENS = [TEST_TOKEN_NAME, NON_REVERT_TEST_TOKEN_NAME, TETHER_TOKEN_NAME];

const IS_DEPLOY_REQUEST = false;

const isCustomSmartWallet = (smartWalletType: string) =>
  smartWalletType === CUSTOM_SMART_WALLET_TYPE;

type TypeOfWallet = 'CustomSmartWallet' | 'SmartWallet';

TYPES_OF_WALLETS.forEach((typeOfWallet) => {
  const isCustom = isCustomSmartWallet(typeOfWallet);

  describe(`RIF SmartWallet tests using ${typeOfWallet}`, function () {
    let provider: BaseProvider;
    let owner: SignerWithAddress;
    let rifSmartWallet: RifSmartWallet;
    let rifSmartWalletTemplate: RifSmartWallet;
    let relayHub: SignerWithAddress;

    before(async function () {
      //Create the RIF SmartWallet template
      if (isCustom) {
        const customSmartWalletFactory = (await hardhat.getContractFactory(
          `${typeOfWallet}`
        )) as CustomSmartWallet__factory;
        rifSmartWalletTemplate = await customSmartWalletFactory.deploy();
      } else {
        const smartWalletFactory = (await hardhat.getContractFactory(
          `${typeOfWallet}`
        )) as SmartWallet__factory;
        rifSmartWalletTemplate = await smartWalletFactory.deploy();
      }

      provider = hardhat.provider;
    });

    beforeEach(async function () {
      const [localOwner, fundedAccount, localRelayHub] =
        await hardhat.getSigners();
      owner = localOwner as SignerWithAddress;
      relayHub = localRelayHub as SignerWithAddress;

      //Fund the owner
      await fundedAccount?.sendTransaction({
        to: owner.address,
        value: hardhat.utils.parseEther('10'),
      });

      const rifSmartWalletFactory = await createSmartWalletFactory(
        rifSmartWalletTemplate,
        isCustom
      );

      rifSmartWallet = await createSmartWallet({
        relayHub: relayHub.address,
        owner,
        factory: rifSmartWalletFactory,
        isCustomSmartWallet: isCustom,
        sender: relayHub,
      });
    });

    describe('Verify', function () {
      describe('Verify success', function () {
        it('Should verify valid signature', async function () {
          const relayRequest = createEnvelopingRequest(
            false,
            {
              from: owner.address,
              relayHub: relayHub.address,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          await rifSmartWallet.verify(
            suffixData,
            relayRequest.request,
            signature
          );
          await expect(
            rifSmartWallet.verify(suffixData, relayRequest.request, signature)
          ).not.to.be.rejected;
        });
      });

      describe('Verify failures', function () {
        it('Should fail when the domain separator is wrong', async function () {
          //The signature should be obtained manually here to be able to inject a
          //wrong domain separator name
          const relayRequest = createEnvelopingRequest(
            IS_DEPLOY_REQUEST,
            {
              from: owner.address,
              relayHub: relayHub.address,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { chainId } = await provider.getNetwork();

          const requestTypes = relayRequestType;

          const data = getEnvelopingRequestDataV4Field({
            chainId,
            verifier: rifSmartWallet.address,
            requestTypes,
            envelopingRequest: relayRequest,
          });

          const { domain, types, value, primaryType } = data;
          domain.name = 'Wrong domain separator name';

          const signature = await owner._signTypedData(domain, types, value);

          const messageSize = Object.keys(requestTypes).length;

          const enconded = _TypedDataEncoder
            .from(types)
            .encodeData(primaryType, value);

          const suffixData =
            PREFIX_HEX +
            enconded.slice(messageSize * CHARS_PER_FIELD + PREFIX_HEX.length);

          await expect(
            rifSmartWallet.verify(suffixData, relayRequest.request, signature)
          ).to.be.rejectedWith('Signature mismatch');
        });

        it('Should fail when the nonce is wrong', async function () {
          const WRONG_NONCE = '123';

          const relayRequest = createEnvelopingRequest(
            IS_DEPLOY_REQUEST,
            {
              from: owner.address,
              relayHub: relayHub.address,
              nonce: WRONG_NONCE,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          await expect(
            rifSmartWallet.verify(suffixData, relayRequest.request, signature)
          ).to.be.rejectedWith('nonce mismatch');
        });

        it('Should fail when the signature is invalid', async function () {
          const relayRequest = createEnvelopingRequest(
            IS_DEPLOY_REQUEST,
            {
              from: owner.address,
              relayHub: relayHub.address,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          await expect(
            rifSmartWallet.verify(suffixData, relayRequest.request, '0x'),
            'Signature as 0x'
          ).to.be.rejectedWith('ECDSA: invalid signature length');

          await expect(
            rifSmartWallet.verify(suffixData, relayRequest.request, '0x123456'),
            'Signature as 0x123456'
          ).to.be.rejectedWith('ECDSA: invalid signature length');

          await expect(
            rifSmartWallet.verify(
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
            to: rifSmartWallet.address,
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
            rifSmartWallet.address
          );
        });

        it('Should call function and increase nonce', async function () {
          const TEST_MESSAGE = 'Test message';

          const targetFunction = target.interface.encodeFunctionData(
            'emitMessage',
            [TEST_MESSAGE]
          );

          const initialRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const initialNonce = await rifSmartWallet.nonce();

          const relayRequest = createEnvelopingRequest(
            false,
            {
              data: targetFunction,
              to: target.address,
              nonce: initialNonce.toString(),
              tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
              tokenGas: 50000,
              relayHub: relayHub.address,
              from: owner.address,
              tokenContract: token.address,
              gas: 100000,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          await expect(
            rifSmartWallet
              .connect(relayHub)
              .execute(
                suffixData,
                relayRequest.request,
                feesReceiver.address,
                signature
              )
          )
            .to.emit(target, 'TestForwarderMessage')
            .withArgs(TEST_MESSAGE, rifSmartWallet.address, relayHub.address);

          const finalRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
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
            initialRifSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(
            finalRifSmartWalletTokenBalance
              .add(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          expect(await rifSmartWallet.nonce(), 'Wrong final nonce').to.be.equal(
            initialNonce.add(1)
          );
        });

        it('Should revert when token amount is not provided', async function () {
          //Any function can be used since the goal is to make revert the operation before
          //it reaches the 'call' in the RifSmartWallet
          const targetFunction = '0x';

          const initialRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const relayRequest = createEnvelopingRequest(
            false,
            {
              data: targetFunction,
              to: target.address,
              nonce: (await rifSmartWallet.nonce()).toString(),
              tokenAmount: INITIAL_SMART_WALLET_TOKEN_AMOUNT + 1,
              tokenGas: 50000,
              relayHub: forwarder.address,
              from: owner.address,
              tokenContract: token.address,
              gas: 100000,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          await expect(
            forwarder.callExecute(
              rifSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            ),
            'Operation not reverted'
          ).to.be.revertedWith('Unable to pay for relay');

          const finalRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
          );
          const finalFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            initialFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(finalFeesReceiverTokenBalance.toString());

          expect(
            initialRifSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(finalRifSmartWalletTokenBalance.toString());
        });

        it('Should transfer tokens even when the target operation fails', async function () {
          const targetFunction =
            target.interface.encodeFunctionData('testRevert');

          const initialRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const relayRequest = createEnvelopingRequest(
            false,
            {
              data: targetFunction,
              to: target.address,
              nonce: (await rifSmartWallet.nonce()).toString(),
              tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
              tokenGas: 50000,
              relayHub: forwarder.address,
              from: owner.address,
              tokenContract: token.address,
              gas: 100000,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          const contractTransaction = await forwarder.callExecute(
            rifSmartWallet.address,
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

          const finalRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
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
            initialRifSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(
            finalRifSmartWalletTokenBalance
              .add(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );
        });

        it('Should fail on re-submit after revert (repeated nonce)', async function () {
          const targetFunction =
            target.interface.encodeFunctionData('testRevert');

          const initialRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
          );
          const initialFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          const relayRequest = createEnvelopingRequest(
            false,
            {
              data: targetFunction,
              to: target.address,
              nonce: (await rifSmartWallet.nonce()).toString(),
              tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
              tokenGas: 50000,
              relayHub: forwarder.address,
              from: owner.address,
              tokenContract: token.address,
              gas: 100000,
            },
            {
              callForwarder: rifSmartWallet.address,
            }
          ) as RelayRequest;

          const { suffixData, signature } = await signEnvelopingRequest(
            relayRequest,
            owner
          );

          const contractTransaction = await forwarder.callExecute(
            rifSmartWallet.address,
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

          const currentRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
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
            initialRifSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(
            currentRifSmartWalletTokenBalance
              .add(TOKEN_AMOUNT_TO_TRANSFER)
              .toString()
          );

          await expect(
            forwarder.callExecute(
              rifSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            )
          ).to.be.revertedWith('nonce mismatch');

          const finalRifSmartWalletTokenBalance = await token.balanceOf(
            rifSmartWallet.address
          );
          const finalFeesReceiverTokenBalance = await token.balanceOf(
            feesReceiver.address
          );

          expect(
            currentFeesReceiverTokenBalance.toString(),
            'Wrong final fees receiver balance'
          ).to.be.equal(finalFeesReceiverTokenBalance.toString());

          expect(
            currentRifSmartWalletTokenBalance.toString(),
            'Wrong final smart wallet balance'
          ).to.be.equal(finalRifSmartWalletTokenBalance.toString());
        });

        describe('Value transfer', function () {
          it('Should forward request with value', async function () {
            const targetFunction = target.interface.encodeFunctionData(
              'mustReceiveEth',
              [RBTC_AMOUNT_TO_TRANSFER.toString()]
            );

            const initialRifSmartWalletTokenBalance = await token.balanceOf(
              rifSmartWallet.address
            );
            const initialFeesReceiverTokenBalance = await token.balanceOf(
              feesReceiver.address
            );
            const initialTargetRbtcBalance = await provider.getBalance(
              target.address
            );

            const relayRequest = createEnvelopingRequest(
              false,
              {
                data: targetFunction,
                to: target.address,
                nonce: (await rifSmartWallet.nonce()).toString(),
                tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
                tokenGas: 50000,
                relayHub: forwarder.address,
                from: owner.address,
                tokenContract: token.address,
                gas: 100000,
                value: RBTC_AMOUNT_TO_TRANSFER.toString(),
              },
              {
                callForwarder: rifSmartWallet.address,
              }
            ) as RelayRequest;

            const { suffixData, signature } = await signEnvelopingRequest(
              relayRequest,
              owner
            );

            const contractTransaction = await forwarder.callExecute(
              rifSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            );
            const { successArgument } = await getLogArguments(
              contractTransaction
            );

            expect(successArgument, 'The execute failed').to.be.equal(true);

            const finalRifSmartWalletTokenBalance = await token.balanceOf(
              rifSmartWallet.address
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
              initialRifSmartWalletTokenBalance.toString(),
              'Wrong final token smart wallet balance'
            ).to.be.equal(
              finalRifSmartWalletTokenBalance
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

            const relayRequest = createEnvelopingRequest(
              false,
              {
                data: targetFunction,
                to: target.address,
                nonce: (await rifSmartWallet.nonce()).toString(),
                tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
                tokenGas: 50000,
                relayHub: forwarder.address,
                from: owner.address,
                tokenContract: token.address,
                gas: 100000,
                value: RBTC_AMOUNT_TO_TRANSFER.toString(),
              },
              {
                callForwarder: rifSmartWallet.address,
              }
            ) as RelayRequest;

            const { suffixData, signature } = await signEnvelopingRequest(
              relayRequest,
              owner
            );

            const contractTransaction = await forwarder.callExecute(
              rifSmartWallet.address,
              relayRequest.request,
              suffixData,
              feesReceiver.address,
              signature
            );
            const { successArgument } = await getLogArguments(
              contractTransaction
            );

            expect(successArgument, 'The execute failed').to.be.equal(true);

            const finalRifSmartWalletRbtcBalance = await provider.getBalance(
              rifSmartWallet.address
            );
            const finalOwnerRbtcBalance = await provider.getBalance(
              owner.address
            );

            expect(
              finalRifSmartWalletRbtcBalance.toString(),
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

            const initialRifSmartWalletTokenBalance = await token.balanceOf(
              rifSmartWallet.address
            );
            const initialFeesReceiverTokenBalance = await token.balanceOf(
              feesReceiver.address
            );

            const relayRequest = createEnvelopingRequest(
              false,
              {
                data: targetFunction,
                to: target.address,
                nonce: (await rifSmartWallet.nonce()).toString(),
                tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
                tokenGas: 50000,
                relayHub: forwarder.address,
                from: owner.address,
                tokenContract: token.address,
                gas: 100000,
                value: RBTC_AMOUNT_TO_TRANSFER.sub(1).toString(),
              },
              {
                callForwarder: rifSmartWallet.address,
              }
            ) as RelayRequest;

            const { suffixData, signature } = await signEnvelopingRequest(
              relayRequest,
              owner
            );

            const contractTransaction = await forwarder.callExecute(
              rifSmartWallet.address,
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

            const finalRifSmartWalletTokenBalance = await token.balanceOf(
              rifSmartWallet.address
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
              initialRifSmartWalletTokenBalance.toString(),
              'Wrong final smart wallet balance'
            ).to.be.equal(
              finalRifSmartWalletTokenBalance
                .add(TOKEN_AMOUNT_TO_TRANSFER)
                .toString()
            );
          });
        });
      });
    }
  });
});

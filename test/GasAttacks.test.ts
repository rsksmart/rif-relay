import { ether } from '@openzeppelin/test-helpers';
import chai from 'chai';
import {
    getLocalEip712Signature,
    RelayRequest,
    cloneRelayRequest,
    Environment,
    TypedRequestData,
    getDomainSeparatorHash,
    constants
} from '@rsksmart/rif-relay-common';
// @ts-ignore
import abiDecoder from 'abi-decoder';
import { IWalletFactory, IRelayHub } from '@rsksmart/rif-relay-contracts';
import {
    RelayHubInstance,
    PenalizerInstance,
    TestRecipientInstance,
    IForwarderInstance,
    TestVerifierEverythingAcceptedInstance,
    SmartWalletInstance,
    SmartWalletFactoryInstance,
    TestTokenInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    deployHub,
    getTestingEnvironment,
    createSmartWallet,
    getGaslessAccount,
    createSmartWalletFactory
} from './TestUtils';

import chaiAsPromised from 'chai-as-promised';
import { AccountKeypair } from '@rsksmart/rif-relay-client';
import { toBN } from 'web3-utils';

const { assert } = chai.use(chaiAsPromised);
const SmartWallet = artifacts.require('SmartWallet');
const Penalizer = artifacts.require('Penalizer');
const TestVerifierEverythingAccepted = artifacts.require(
    'TestVerifierEverythingAccepted'
);
const TestRecipient = artifacts.require('TestRecipient');

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi);
abiDecoder.addABI(IWalletFactory.abi);
abiDecoder.addABI(IRelayHub.abi);

contract('RelayHub', function ([_, relayOwner, relayManager, relayWorker]) {
    let chainId: number;
    let relayHub: string;
    let penalizer: PenalizerInstance;
    let relayHubInstance: RelayHubInstance;
    let recipientContract: TestRecipientInstance;
    let verifierContract: TestVerifierEverythingAcceptedInstance;
    let forwarderInstance: IForwarderInstance;
    let target: string;
    let verifier: string;
    let forwarder: string;
    let gaslessAccount: AccountKeypair;
    const gasLimit = '1000000';
    const gasPrice = '1';
    let sharedRelayRequestData: RelayRequest;
    let env: Environment;
    let token: TestTokenInstance;
    let factory: SmartWalletFactoryInstance;

    describe('relayCall', function () {
        beforeEach(async function () {
            env = await getTestingEnvironment();
            chainId = env.chainId;

            penalizer = await Penalizer.new();
            relayHubInstance = await deployHub(penalizer.address);
            verifierContract = await TestVerifierEverythingAccepted.new();
            gaslessAccount = await getGaslessAccount();

            const smartWalletTemplate: SmartWalletInstance =
                await SmartWallet.new();
            factory = await createSmartWalletFactory(smartWalletTemplate);
            recipientContract = await TestRecipient.new();
            const testToken = artifacts.require('TestToken');
            token = await testToken.new();
            target = recipientContract.address;
            verifier = verifierContract.address;
            relayHub = relayHubInstance.address;

            forwarderInstance = await createSmartWallet(
                _,
                gaslessAccount.address,
                factory,
                gaslessAccount.privateKey,
                chainId
            );
            forwarder = forwarderInstance.address;
            await token.mint('1000', forwarder);

            sharedRelayRequestData = {
                request: {
                    relayHub: relayHub,
                    to: target,
                    data: '0x',
                    from: gaslessAccount.address,
                    nonce: (await forwarderInstance.nonce()).toString(),
                    value: '0',
                    gas: gasLimit,
                    tokenContract: token.address,
                    tokenAmount: '1',
                    tokenGas: '50000',
                    collectorContract: constants.ZERO_ADDRESS
                },
                relayData: {
                    gasPrice,
                    relayWorker,
                    callForwarder: forwarder,
                    callVerifier: verifier,
                    domainSeparator: getDomainSeparatorHash(forwarder, chainId)
                }
            };
        });

        context('with staked and registered relay', function () {
            const url = 'http://relay.com';
            const message = 'Enveloping RelayHub';

            let relayRequest: RelayRequest;
            let encodedFunction: string;
            let signatureWithPermissiveVerifier: string;

            beforeEach(async function () {
                await relayHubInstance.stakeForAddress(relayManager, 1000, {
                    value: ether('2'),
                    from: relayOwner
                });

                // truffle-contract doesn't let us create method data from the class, we need an actual instance
                encodedFunction = recipientContract.contract.methods
                    .emitMessage(message)
                    .encodeABI();

                await relayHubInstance.addRelayWorkers([relayWorker], {
                    from: relayManager
                });
                await relayHubInstance.registerRelayServer(url, {
                    from: relayManager
                });
                relayRequest = cloneRelayRequest(sharedRelayRequestData);
                relayRequest.request.data = encodedFunction;

                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder,
                    relayRequest
                );
                signatureWithPermissiveVerifier = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );
            });

            context('with funded verifier', function () {
                /**
                 * The User's SmartWallet cannot be attacked by the Relayer with the following attack:
                 * The RelayServer carefully chooses the gas to send in the transaction in order to be able
                 * to collect the token payment from the user but avoiding the execution of the destination contract
                 *
                 * The design of the SmartWallet smart contract makes it obvious, but this test is another way of demonstrating this attack is not possible.
                 * This test works by increasing the gas sent to the transaction one by one (n times) until the transaction passes.
                 * All the other previous n-1 cases (where the gas was not enough) we prove that the transaction reverts as a whole, without any state changes
                 *
                 * This suite does not run by default, because this test can take hours to complete.
                 * If you want to try this test simply run it stand alone or add it in .circleci/config.yml
                 *
                 */
                it('relayCall atomicity cannot be broken using user-entered gas attacks', async function () {
                    this.timeout(0);
                    let gasSent = 42300; // less gas wont even pass the node's transaction cost validation
                    // 121620 is the gas used for this transaction in order to succeed
                    let succeed = false;

                    const startTime = new Date().toISOString();

                    while (!succeed) {
                        const nonceBefore = await forwarderInstance.nonce();
                        const workerTokenBalanceBefore = await token.balanceOf(
                            relayWorker
                        );
                        const workerRBTCBalanceBefore = toBN(
                            await web3.eth.getBalance(relayWorker)
                        );
                        const swTokenBalanceBefore = await token.balanceOf(
                            forwarder
                        );
                        const swRBTCBalanceBefore = toBN(
                            await web3.eth.getBalance(forwarder)
                        );
                        const ownerTokenBalanceBefore = await token.balanceOf(
                            gaslessAccount.address
                        );
                        const ownerRBTCBalanceBefore = toBN(
                            await web3.eth.getBalance(gaslessAccount.address)
                        );
                        let transaction: Truffle.TransactionResponse;

                        try {
                            transaction = await relayHubInstance.relayCall(
                                relayRequest,
                                signatureWithPermissiveVerifier,
                                {
                                    from: relayWorker,
                                    gasPrice,
                                    gas: gasSent
                                }
                            );
                        } catch (error) {
                            const nonceAfter = await forwarderInstance.nonce();
                            assert.isTrue(
                                nonceBefore.eq(nonceAfter),
                                'Smart wallet nonce must be unchanged'
                            );

                            const workerTokenBalanceAfter =
                                await token.balanceOf(relayWorker);
                            assert.isTrue(
                                workerTokenBalanceBefore.eq(
                                    workerTokenBalanceAfter
                                ),
                                'Worker token balance must be unchanged'
                            );

                            const swTokenBalanceAfter = await token.balanceOf(
                                forwarder
                            );
                            assert.isTrue(
                                swTokenBalanceBefore.eq(swTokenBalanceAfter),
                                'Smart wallet token balance must be unchanged'
                            );

                            const workerRBTCBalanceAfter = toBN(
                                await web3.eth.getBalance(relayWorker)
                            );

                            if (
                                JSON.stringify(error).includes(
                                    'basic cost is above the gas limit'
                                )
                            ) {
                                assert.isTrue(
                                    workerRBTCBalanceBefore.eq(
                                        workerRBTCBalanceAfter
                                    ),
                                    `RBTC balance of the worker must be the same, gasSent is ${gasSent}, balance before is ${workerRBTCBalanceBefore.toString()}, balance after is ${workerRBTCBalanceAfter.toString()}`
                                );
                            } else {
                                assert.isTrue(
                                    workerRBTCBalanceBefore.gt(
                                        workerRBTCBalanceAfter
                                    ),
                                    `RBTC balance of the worker must have decreased, gasSent is ${gasSent}, balance before is ${workerRBTCBalanceBefore.toString()}, balance after is ${workerRBTCBalanceAfter.toString()}`
                                );
                            }

                            const swRBTCBalanceAfter = toBN(
                                await web3.eth.getBalance(forwarder)
                            );
                            assert.isTrue(
                                swRBTCBalanceBefore.eq(swRBTCBalanceAfter),
                                'Smart Wallet RBTC balance, if any, must be unchanged'
                            );

                            const ownerTokenBalanceAfter =
                                await token.balanceOf(gaslessAccount.address);
                            assert.isTrue(
                                ownerTokenBalanceBefore.eq(
                                    ownerTokenBalanceAfter
                                ),
                                'Smart wallet owner token balance, if any, must be unchanged'
                            );

                            const ownerRBTCBalanceAfter = toBN(
                                await web3.eth.getBalance(
                                    gaslessAccount.address
                                )
                            );
                            assert.isTrue(
                                ownerRBTCBalanceBefore.eq(
                                    ownerRBTCBalanceAfter
                                ),
                                'Smart Wallet owner RBTC balance, if any, must be unchanged'
                            );

                            gasSent++;
                            continue;
                        }

                        console.log('It worked with gas: ', gasSent);

                        const nonceAfter = await forwarderInstance.nonce();
                        assert.equal(
                            nonceBefore.addn(1).toNumber(),
                            nonceAfter.toNumber()
                        );

                        const receipt = await web3.eth.getTransactionReceipt(
                            transaction.tx
                        );
                        const logs = abiDecoder.decodeLogs(receipt.logs);
                        const sampleRecipientEmittedEvent = logs.find(
                            (e: any) =>
                                e != null && e.name === 'SampleRecipientEmitted'
                        );

                        assert.equal(
                            message,
                            sampleRecipientEmittedEvent.events[0].value
                        );
                        assert.equal(
                            forwarder.toLowerCase(),
                            sampleRecipientEmittedEvent.events[1].value.toLowerCase()
                        );
                        assert.equal(
                            relayWorker.toLowerCase(),
                            sampleRecipientEmittedEvent.events[2].value.toLowerCase()
                        );

                        const transactionRelayedEvent = logs.find(
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
                        );

                        assert.isNotNull(transactionRelayedEvent);

                        const workerTokenBalanceAfter = await token.balanceOf(
                            relayWorker
                        );
                        assert.isTrue(
                            workerTokenBalanceBefore
                                .add(toBN(1))
                                .eq(workerTokenBalanceAfter),
                            'Worker token balance did not increase'
                        );

                        const swTokenBalanceAfter = await token.balanceOf(
                            forwarder
                        );
                        assert.isTrue(
                            swTokenBalanceBefore.eq(
                                swTokenBalanceAfter.add(toBN(1))
                            ),
                            'Smart wallet token balance did not decrease'
                        );

                        succeed = true;
                    }
                    console.log('Start Time: ', startTime);
                    console.log('End time: ', new Date().toISOString());
                });
            });
        });
    });
});

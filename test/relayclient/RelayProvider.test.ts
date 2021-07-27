import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
import { HttpProvider, WebsocketProvider } from 'web3-core';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers';
import chaiAsPromised from 'chai-as-promised';
import Web3 from 'web3';
import { toBN, toChecksumAddress } from 'web3-utils';
// @ts-ignore
import abiDecoder from 'abi-decoder';
import { IWalletFactory } from '@rsksmart/rif-relay-contracts';
import {
    RelayHubInstance,
    TestVerifierConfigurableMisbehaviorInstance,
    TestDeployVerifierConfigurableMisbehaviorInstance,
    TestRecipientContract,
    TestRecipientInstance,
    SmartWalletFactoryInstance,
    SmartWalletInstance,
    TestTokenInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    EnvelopingConfig,
    isRsk,
    EnvelopingTransactionDetails
} from '@rsksmart/rif-relay-common';
import {
    deployHub,
    startRelay,
    stopRelay,
    getTestingEnvironment,
    createSmartWalletFactory,
    createSmartWallet,
    getGaslessAccount,
    prepareTransaction,
    RelayServerData
} from '../TestUtils';
import BadRelayClient from '../dummies/BadRelayClient';
// @ts-ignore
import { constants } from '../../src/common/Constants';
import {
    AccountKeypair,
    RelayProvider,
    configure
} from '@rsksmart/rif-relay-client';

import * as chai from 'chai';

const { expect, assert } = chai.use(chaiAsPromised);

const SmartWallet = artifacts.require('SmartWallet');
const TestToken = artifacts.require('TestToken');
const TestVerifierConfigurableMisbehavior = artifacts.require(
    'TestVerifierConfigurableMisbehavior'
);
const TestDeployVerifierConfigurableMisbehavior = artifacts.require(
    'TestDeployVerifierConfigurableMisbehavior'
);

const underlyingProvider = web3.currentProvider as HttpProvider;
const revertReasonEnabled = true; // Enable when the RSK node supports revert reason codes
abiDecoder.addABI(IWalletFactory.abi);

contract('RelayProvider', function (accounts) {
    let web3: Web3;
    let relayHub: RelayHubInstance;
    let verifierInstance: TestVerifierConfigurableMisbehaviorInstance;
    let deployVerifierInstance: TestDeployVerifierConfigurableMisbehaviorInstance;
    let relayProcess: ChildProcessWithoutNullStreams;
    let relayProvider: RelayProvider;
    let factory: SmartWalletFactoryInstance;
    let sWalletTemplate: SmartWalletInstance;
    let smartWallet: SmartWalletInstance;
    let sender: string;
    let token: TestTokenInstance;
    let gaslessAccount: AccountKeypair;
    let relayServerData: RelayServerData;
    before(async function () {
        sender = accounts[0];
        gaslessAccount = await getGaslessAccount();
        web3 = new Web3(underlyingProvider);
        relayHub = await deployHub(constants.ZERO_ADDRESS);

        sWalletTemplate = await SmartWallet.new();
        const env = await getTestingEnvironment();
        factory = await createSmartWalletFactory(sWalletTemplate);
        smartWallet = await createSmartWallet(
            accounts[0],
            gaslessAccount.address,
            factory,
            gaslessAccount.privateKey,
            env.chainId
        );
        token = await TestToken.new();
        await token.mint('1000', smartWallet.address);

        verifierInstance = await TestVerifierConfigurableMisbehavior.new();
        deployVerifierInstance =
            await TestDeployVerifierConfigurableMisbehavior.new();

        relayServerData = await startRelay(relayHub, {
            relaylog: process.env.relaylog,
            stake: 1e18,
            url: 'asd',
            relayOwner: accounts[1],
            rskNodeUrl: underlyingProvider.host,
            deployVerifierAddress: deployVerifierInstance.address,
            relayVerifierAddress: verifierInstance.address,
            workerMinBalance: 0.1e18,
            workerTargetBalance: 0.3e18,
            managerMinBalance: 0.1e18,
            managerTargetBalance: 0.3e18,
            minHubWithdrawalBalance: 0.1e18
        });

        relayProcess = relayServerData.proc;
    });

    after(async function () {
        await stopRelay(relayProcess);
    });

    describe('Use Provider to relay transparently', () => {
        let testRecipient: TestRecipientInstance;
        let testRecipient2: TestRecipientInstance;
        before(async () => {
            const env = await getTestingEnvironment();
            const TestRecipient = artifacts.require('TestRecipient');
            testRecipient = await TestRecipient.new();
            testRecipient2 = await TestRecipient.new();
            const config = configure({
                logLevel: 5,
                relayHubAddress: relayHub.address,
                chainId: env.chainId,
                forwarderAddress: smartWallet.address,
                relayVerifierAddress: verifierInstance.address,
                deployVerifierAddress: deployVerifierInstance.address
            });

            let websocketProvider: WebsocketProvider;

            if (isRsk(await getTestingEnvironment())) {
                websocketProvider = new Web3.providers.WebsocketProvider(
                    'ws://localhost:4445/websocket'
                );
            } else {
                websocketProvider = new Web3.providers.WebsocketProvider(
                    underlyingProvider.host
                );
            }

            relayProvider = new RelayProvider(websocketProvider as any, config);

            // NOTE: in real application its enough to set the provider in web3.
            // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
            // so changing the global one is not enough.
            // @ts-ignore
            TestRecipient.web3.setProvider(relayProvider);
            relayProvider.addAccount(gaslessAccount);
        });

        it('should relay transparently', async function () {
            const res = await testRecipient.emitMessage('hello world', {
                from: gaslessAccount.address,
                value: '0',
                callVerifier: verifierInstance.address
            });

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world',
                msgValue: '0',
                balance: '0'
            });
        });

        it('should relay transparently using forceGas', async function () {
            const res = await testRecipient.emitMessage('hello world', {
                from: gaslessAccount.address,
                value: '0',
                callVerifier: verifierInstance.address,
                forceGas: '6000'
            });

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world',
                msgValue: '0',
                balance: '0'
            });
        });

        it('should fail to relay using a lower-than-required forceGas', async function () {
            await expectRevert(
                testRecipient.emitMessage('hello world', {
                    from: gaslessAccount.address,
                    value: '0',
                    callVerifier: verifierInstance.address,
                    forceGas: '4000'
                }),
                'Destination contract method reverted in local view call'
            );
        });

        it('should fail to relay if forceGas gas is much greater than what is required ', async function () {
            // Putting a much higher gas may pass in the relayclient, but it will fail in the local view call of the
            // relay server, because the relayServer estimates the maximum gas to send by estimating it using a node,
            // whereas the relay client (to avoid another call to a node), estimates the maxGas using a linear fit function
            // obtained from a simulation

            // It reverts in the server, but in a local view call
            // await expectRevert(testRecipient.emitMessage('hello world', {
            //   from: gaslessAccount.address,
            //   value: '0',
            //   callVerifier: verifierInstance.address,
            //   forceGas: '196000'
            // }), 'local view call reverted: view call to \'relayCall\' reverted in client: Not enough gas left')
            try {
                await testRecipient.emitMessage('hello world', {
                    from: gaslessAccount.address,
                    value: '0',
                    callVerifier: verifierInstance.address,
                    forceGas: '196000'
                });
            } catch (error) {
                const err: string =
                    error instanceof Error
                        ? error.message
                        : JSON.stringify(error);
                assert.isTrue(
                    err.includes(
                        "local view call reverted: view call to 'relayCall' reverted in client: Returned error: VM Exception while processing transaction: revert Not enough gas left"
                    )
                );
            }
        });

        it('should send a transaction when useEnveloping is false', async function () {
            const res = await testRecipient.emitMessage(
                'hello world, not using enveloping',
                {
                    from: accounts[0],
                    useEnveloping: false
                }
            );

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world, not using enveloping',
                msgValue: '0',
                balance: '0'
            });
        });

        it('should relay transparently, with Token Payment included', async function () {
            await token.mint('1', smartWallet.address);
            const initialSwBalance = await token.balanceOf(smartWallet.address);
            const workerInitialBalance = await token.balanceOf(
                relayServerData.worker
            );

            const res = await testRecipient.emitMessage('hello world', {
                from: gaslessAccount.address,
                value: '0',
                callVerifier: verifierInstance.address,
                tokenAmount: '1',
                tokenContract: token.address
            });

            const finalSwBalance = await token.balanceOf(smartWallet.address);
            const workerFinalBalance = await token.balanceOf(
                relayServerData.worker
            );

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world',
                msgValue: '0',
                balance: '0'
            });

            assert.isTrue(
                finalSwBalance.add(toBN(1)).eq(initialSwBalance),
                'Token Payment did not occurr'
            );
            assert.isTrue(
                workerInitialBalance.add(toBN(1)).eq(workerFinalBalance),
                'Worker did not get the payment'
            );
        });

        it('should relay transparently using forceGas, with Token Payment included', async function () {
            await token.mint('1', smartWallet.address);
            const initialSwBalance = await token.balanceOf(smartWallet.address);
            const workerInitialBalance = await token.balanceOf(
                relayServerData.worker
            );

            const res = await testRecipient.emitMessage('hello world', {
                from: gaslessAccount.address,
                value: '0',
                callVerifier: verifierInstance.address,
                tokenAmount: '1',
                tokenContract: token.address,
                forceGas: '6000'
            });

            const finalSwBalance = await token.balanceOf(smartWallet.address);
            const workerFinalBalance = await token.balanceOf(
                relayServerData.worker
            );

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world',
                msgValue: '0',
                balance: '0'
            });

            assert.isTrue(
                finalSwBalance.add(toBN(1)).eq(initialSwBalance),
                'Token Payment did not occurr'
            );
            assert.isTrue(
                workerInitialBalance.add(toBN(1)).eq(workerFinalBalance),
                'Worker did not get the payment'
            );
        });

        it('should fail to relay using a lower-than-required forceGas, with Token Payment included', async function () {
            await token.mint('1', smartWallet.address);
            const initialSwBalance = await token.balanceOf(smartWallet.address);
            const workerInitialBalance = await token.balanceOf(
                relayServerData.worker
            );

            await expectRevert(
                testRecipient.emitMessage('hello world', {
                    from: gaslessAccount.address,
                    value: '0',
                    callVerifier: verifierInstance.address,
                    tokenAmount: '1',
                    tokenContract: token.address,
                    forceGas: '4000'
                }),
                'Destination contract method reverted in local view call'
            );

            const finalSwBalance = await token.balanceOf(smartWallet.address);
            const workerFinalBalance = await token.balanceOf(
                relayServerData.worker
            );

            assert.isTrue(
                finalSwBalance.eq(initialSwBalance),
                'Token Payment did occurr'
            );
            assert.isTrue(
                workerInitialBalance.eq(workerFinalBalance),
                'Worker did  get the payment'
            );
        });

        it('should fail to relay if forceGas gas is much greater than what is required, with Token Payment included ', async function () {
            // Putting a much higher gas may pass in the relayclient, but it will fail in the local view call of the
            // relay server, because the relayServer estimates the maximum gas to send by estimating it using a node,
            // whereas the relay client (to avoid another call to a node), estimates the maxGas using a linear fit function
            // obtained from a simulation

            await token.mint('1', smartWallet.address);
            const initialSwBalance = await token.balanceOf(smartWallet.address);
            const workerInitialBalance = await token.balanceOf(
                relayServerData.worker
            );
            await expectRevert(
                testRecipient.emitMessage('hello world', {
                    from: gaslessAccount.address,
                    value: '0',
                    callVerifier: verifierInstance.address,
                    tokenAmount: '1',
                    tokenContract: token.address,
                    forceGas: '196000'
                }),
                'Not enough gas left'
            );

            const finalSwBalance = await token.balanceOf(smartWallet.address);
            const workerFinalBalance = await token.balanceOf(
                relayServerData.worker
            );

            assert.isTrue(
                finalSwBalance.eq(initialSwBalance),
                'Token Payment did occurr'
            );
            assert.isTrue(
                workerInitialBalance.eq(workerFinalBalance),
                'Worker did  get the payment'
            );
        });

        it('should fail to relay transparently with Token Payment included, but when token Balance is not enough', async function () {
            const initialSwBalance = await token.balanceOf(smartWallet.address);

            await expectRevert(
                testRecipient.emitMessage('hello world', {
                    from: gaslessAccount.address,
                    value: '0',
                    callVerifier: verifierInstance.address,
                    tokenAmount: initialSwBalance.add(toBN(1)).toString(),
                    tokenContract: token.address
                }),
                'Unable to pay for relay'
            );

            const finalSwBalance = await token.balanceOf(smartWallet.address);
            assert.isTrue(
                finalSwBalance.eq(initialSwBalance),
                'Token Payment did occurr'
            );
        });

        it('should relay transparently with gasPrice forced', async function () {
            const res = await testRecipient.emitMessage('hello world', {
                from: gaslessAccount.address,
                forceGasPrice: '0x51f4d5c00',
                value: '0',
                callVerifier: verifierInstance.address
            });

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world',
                msgValue: '0',
                balance: '0'
            });
        });

        it('should relay transparently with value', async function () {
            const value = (1e18).toString();
            // note: this test only validates we process the "value" parameter of the request properly.
            // a real use-case should have a verifier to transfer the value into the forwarder,
            // probably by swapping user's tokens into eth.

            await web3.eth.sendTransaction({
                from: sender,
                to: smartWallet.address,
                value
            });

            const res = await testRecipient.emitMessage('hello world', {
                from: gaslessAccount.address,
                forceGasPrice: '0x51f4d5c00',
                value,
                gas: '100000',
                callVerifier: verifierInstance.address
            });

            expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
                message: 'hello world',
                msgValue: value,
                balance: value
            });
        });

        it('should revert if the sender is not the owner of the smart wallet', async function () {
            const differentSender = await getGaslessAccount();
            relayProvider.addAccount(differentSender);

            await expectRevert(
                testRecipient.emitMessage('hello world', {
                    from: differentSender.address, // different sender
                    value: '0',
                    callVerifier: verifierInstance.address
                }),
                'Not the owner of the SmartWallet'
            );
        });

        it('should calculate the correct smart wallet address', async function () {
            assert.isTrue(relayProvider != null);
            const env = await getTestingEnvironment();
            const config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId
            });
            config.forwarderAddress = constants.ZERO_ADDRESS;
            const recoverer = constants.ZERO_ADDRESS;
            const walletIndex = 0;
            const bytecodeHash = web3.utils.keccak256(
                await factory.getCreationBytecode()
            );

            const rProvider = new RelayProvider(underlyingProvider, config);
            const swAddress = rProvider.calculateSmartWalletAddress(
                factory.address,
                gaslessAccount.address,
                recoverer,
                walletIndex,
                bytecodeHash
            );

            const expectedAddress = await factory.getSmartWalletAddress(
                gaslessAccount.address,
                recoverer,
                walletIndex
            );

            assert.equal(swAddress, expectedAddress);
        });

        it('should fail to deploy the smart wallet due to insufficient token balance', async function () {
            const ownerEOA = await getGaslessAccount();
            const recoverer = constants.ZERO_ADDRESS;
            const customLogic = constants.ZERO_ADDRESS;
            const logicData = '0x';
            const walletIndex = 0;
            const env = await getTestingEnvironment();
            const config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId,
                relayVerifierAddress: verifierInstance.address,
                deployVerifierAddress: deployVerifierInstance.address
            });
            assert.isTrue(relayProvider != null);
            config.forwarderAddress = constants.ZERO_ADDRESS;
            const rProvider = new RelayProvider(underlyingProvider, config);
            rProvider.addAccount(ownerEOA);
            const bytecodeHash = web3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            const swAddress = rProvider.calculateSmartWalletAddress(
                factory.address,
                ownerEOA.address,
                recoverer,
                walletIndex,
                bytecodeHash
            );

            assert.isTrue(
                (await token.balanceOf(swAddress)).toNumber() < 10,
                'Account must have insufficient funds'
            );

            const expectedCode = await web3.eth.getCode(swAddress);
            assert.equal('0x', expectedCode);

            const trxData: EnvelopingTransactionDetails = {
                from: ownerEOA.address,
                to: customLogic,
                data: logicData,
                tokenContract: token.address,
                tokenAmount: '10',
                // tokenGas: '50000',
                recoverer: recoverer,
                callForwarder: factory.address,
                index: walletIndex.toString(),
                isSmartWalletDeploy: true,
                callVerifier: deployVerifierInstance.address,
                smartWalletAddress: swAddress
            };

            try {
                await rProvider.deploySmartWallet(trxData);
                assert.fail();
            } catch (error) {
                assert.include(
                    error.message,
                    "view call to 'deployCall' reverted in client"
                );
            }
        });

        it('should correctly deploy the smart wallet', async function () {
            const ownerEOA = await getGaslessAccount();
            const recoverer = constants.ZERO_ADDRESS;
            const customLogic = constants.ZERO_ADDRESS;
            const logicData = '0x';
            const walletIndex = 0;
            const env = await getTestingEnvironment();
            const config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId,
                deployVerifierAddress: deployVerifierInstance.address,
                relayVerifierAddress: verifierInstance.address
            });
            assert.isTrue(relayProvider != null);
            config.forwarderAddress = constants.ZERO_ADDRESS;
            const rProvider = new RelayProvider(underlyingProvider, config);
            rProvider.addAccount(ownerEOA);
            const bytecodeHash = web3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            const swAddress = rProvider.calculateSmartWalletAddress(
                factory.address,
                ownerEOA.address,
                recoverer,
                walletIndex,
                bytecodeHash
            );
            await token.mint('10000', swAddress);

            let expectedCode = await web3.eth.getCode(swAddress);
            assert.equal('0x', expectedCode);

            const trxData: EnvelopingTransactionDetails = {
                from: ownerEOA.address,
                to: customLogic,
                data: logicData,
                // gas: toHex('400000'),
                tokenContract: token.address,
                tokenAmount: '10',
                tokenGas: '50000',
                recoverer: recoverer,
                index: walletIndex.toString(),
                callVerifier: deployVerifierInstance.address,
                callForwarder: factory.address,
                isSmartWalletDeploy: true
            };

            const txHash = await rProvider.deploySmartWallet(trxData);
            const trx = await web3.eth.getTransactionReceipt(txHash);

            const logs = abiDecoder.decodeLogs(trx.logs);
            const deployedEvent = logs.find(
                (e: any) => e != null && e.name === 'Deployed'
            );
            const event = deployedEvent.events[0];
            assert.equal(event.name, 'addr');
            const generatedSWAddress = toChecksumAddress(
                event.value,
                env.chainId
            );

            assert.equal(generatedSWAddress, swAddress);
            const deployedCode = await web3.eth.getCode(generatedSWAddress);
            expectedCode = await factory.getCreationBytecode();
            expectedCode = '0x' + expectedCode.slice(20, expectedCode.length);
            assert.equal(deployedCode, expectedCode);
        });

        it('should correclty deploy the smart wallet when tokenGas is not defined', async function () {
            const ownerEOA = await getGaslessAccount();
            const recoverer = constants.ZERO_ADDRESS;
            const customLogic = constants.ZERO_ADDRESS;
            const logicData = '0x';
            const walletIndex = 0;
            const env = await getTestingEnvironment();
            const config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId,
                deployVerifierAddress: deployVerifierInstance.address,
                relayVerifierAddress: verifierInstance.address
            });
            assert.isTrue(relayProvider != null);
            config.forwarderAddress = constants.ZERO_ADDRESS;
            const rProvider = new RelayProvider(underlyingProvider, config);
            rProvider.addAccount(ownerEOA);
            const bytecodeHash = web3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            const swAddress = rProvider.calculateSmartWalletAddress(
                factory.address,
                ownerEOA.address,
                recoverer,
                walletIndex,
                bytecodeHash
            );
            await token.mint('10000', swAddress);

            let expectedCode = await web3.eth.getCode(swAddress);
            assert.equal('0x', expectedCode);

            const trxData: EnvelopingTransactionDetails = {
                from: ownerEOA.address,
                to: customLogic,
                data: logicData,
                // gas: toHex('400000'),
                tokenContract: token.address,
                tokenAmount: '10',
                // tokenGas: '50000',
                recoverer: recoverer,
                index: walletIndex.toString(),
                callVerifier: deployVerifierInstance.address,
                callForwarder: factory.address,
                isSmartWalletDeploy: true,
                smartWalletAddress: swAddress // so the client knows how to estimate tokenGas
            };

            const txHash = await rProvider.deploySmartWallet(trxData);
            const trx = await web3.eth.getTransactionReceipt(txHash);

            const logs = abiDecoder.decodeLogs(trx.logs);
            const deployedEvent = logs.find(
                (e: any) => e != null && e.name === 'Deployed'
            );
            const event = deployedEvent.events[0];
            assert.equal(event.name, 'addr');
            const generatedSWAddress = toChecksumAddress(
                event.value,
                env.chainId
            );

            assert.equal(generatedSWAddress, swAddress);
            const deployedCode = await web3.eth.getCode(generatedSWAddress);
            expectedCode = await factory.getCreationBytecode();
            expectedCode = '0x' + expectedCode.slice(20, expectedCode.length);
            assert.equal(deployedCode, expectedCode);
        });

        it('should fail to deploy the smart wallet is tokenGas and smartWalletAddress are not defined', async function () {
            const ownerEOA = await getGaslessAccount();
            const recoverer = constants.ZERO_ADDRESS;
            const customLogic = constants.ZERO_ADDRESS;
            const logicData = '0x';
            const walletIndex = 0;
            const env = await getTestingEnvironment();
            const config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId,
                deployVerifierAddress: deployVerifierInstance.address,
                relayVerifierAddress: verifierInstance.address
            });
            assert.isTrue(relayProvider != null);
            config.forwarderAddress = constants.ZERO_ADDRESS;
            const rProvider = new RelayProvider(underlyingProvider, config);
            rProvider.addAccount(ownerEOA);
            const bytecodeHash = web3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            const swAddress = rProvider.calculateSmartWalletAddress(
                factory.address,
                ownerEOA.address,
                recoverer,
                walletIndex,
                bytecodeHash
            );
            await token.mint('10000', swAddress);

            const expectedCode = await web3.eth.getCode(swAddress);
            assert.equal('0x', expectedCode);

            const trxData: EnvelopingTransactionDetails = {
                from: ownerEOA.address,
                to: customLogic,
                data: logicData,
                // gas: toHex('400000'),
                tokenContract: token.address,
                tokenAmount: '10',
                // tokenGas: '50000',
                recoverer: recoverer,
                index: walletIndex.toString(),
                callVerifier: deployVerifierInstance.address,
                callForwarder: factory.address,
                isSmartWalletDeploy: true,
                smartWalletAddress: swAddress
            };

            try {
                await rProvider.deploySmartWallet(trxData);
            } catch (error) {
                assert.equal(
                    error.message,
                    'In a deploy, if tokenGas is not defined, then the calculated SmartWallet address is needed to estimate the tokenGas value'
                );
            }
        });

        it('should subscribe to events', async () => {
            const block = await web3.eth.getBlockNumber();

            const eventPromise = new Promise((resolve, reject) => {
                // @ts-ignore
                testRecipient2.contract.once(
                    'SampleRecipientEmitted',
                    { fromBlock: block },
                    (err, ev) => {
                        if (err !== null) {
                            reject(err);
                        } else {
                            resolve(ev);
                        }
                    }
                );
            });

            await testRecipient2.emitMessage('hello again', {
                from: gaslessAccount.address,
                gas: '100000',
                callVerifier: verifierInstance.address
            });
            const log: any = await eventPromise;

            assert.equal(log.returnValues.message, 'hello again');
        });

        // note that the revert reason here was discovered via some truffle/ganache magic (see truffle/reason.js)
        // this is not the way the revert reason is being reported by Enveloping solidity contracts
        it('should fail if transaction failed', async () => {
            await expectRevert(
                testRecipient.testRevert({
                    from: gaslessAccount.address,
                    callVerifier: verifierInstance.address
                }),
                'Destination contract method reverted in local view call'
            );
        });
    });

    describe('_ethSendTransaction', function () {
        const id = 777;
        let testRecipient: TestRecipientInstance;
        let config: EnvelopingConfig;
        let jsonRpcPayload: JsonRpcPayload;

        before(async function () {
            const TestRecipient = artifacts.require('TestRecipient');
            testRecipient = await TestRecipient.new();

            const env = await getTestingEnvironment();
            config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId
            });
            config.forwarderAddress = smartWallet.address;

            // call to emitMessage('hello world')
            jsonRpcPayload = {
                jsonrpc: '2.0',
                id,
                method: 'eth_sendTransaction',
                params: [
                    {
                        from: gaslessAccount.address,
                        gas: '0x186a0',
                        gasPrice: '0x4a817c800',
                        forceGasPrice: '0x51f4d5c00',
                        callVerifier: verifierInstance.address,
                        to: testRecipient.address,
                        data: testRecipient.contract.methods
                            .emitMessage('hello world')
                            .encodeABI()
                    }
                ]
            };
        });

        it('should call callback with error if relayTransaction throws', async function () {
            const badRelayClient: any = new BadRelayClient(
                true,
                false,
                underlyingProvider,
                config
            );
            const relayProvider = new RelayProvider(
                underlyingProvider,
                config,
                {},
                badRelayClient
            );
            const promisified = new Promise((resolve, reject) =>
                relayProvider._ethSendTransaction(
                    jsonRpcPayload,
                    (error: Error | null): void => {
                        reject(error);
                    }
                )
            );
            await expect(promisified).to.be.eventually.rejectedWith(
                `Rejected relayTransaction call - Reason: ${BadRelayClient.message}`
            );
        });

        it('should call callback with error containing relaying results dump if relayTransaction does not return a transaction object', async function () {
            const badRelayClient: any = new BadRelayClient(
                false,
                true,
                underlyingProvider,
                config
            );
            const relayProvider = new RelayProvider(
                underlyingProvider,
                config,
                {},
                badRelayClient
            );
            const promisified = new Promise((resolve, reject) =>
                relayProvider._ethSendTransaction(
                    jsonRpcPayload,
                    (error: Error | null): void => {
                        reject(error);
                    }
                )
            );
            await expect(promisified).to.be.eventually.rejectedWith(
                'Failed to relay call. Results:'
            );
        });

        it('should convert a returned transaction to a compatible rpc transaction hash response', async function () {
            const env = await getTestingEnvironment();
            const config = configure({
                logLevel: 5,
                relayHubAddress: relayHub.address,
                chainId: env.chainId,
                relayVerifierAddress: verifierInstance.address,
                deployVerifierAddress: deployVerifierInstance.address
            });
            config.forwarderAddress = smartWallet.address;

            const relayProvider = new RelayProvider(underlyingProvider, config);
            relayProvider.addAccount(gaslessAccount);
            const response: JsonRpcResponse = await new Promise(
                (resolve, reject) =>
                    relayProvider._ethSendTransaction(
                        jsonRpcPayload,
                        (
                            error: Error | null,
                            result?: JsonRpcResponse
                        ): void => {
                            if (error != null) {
                                reject(error);
                            } else {
                                if (result !== undefined) {
                                    resolve(result);
                                } else throw new Error('Result is undefined');
                            }
                        }
                    )
            );
            assert.equal(id, response.id);
            assert.equal('2.0', response.jsonrpc);
            // I don't want to hard-code tx hash, so for now just checking it is there
            assert.equal(66, response.result.length);
        });
    });

    // TODO: most of this code is copy-pasted from the RelayHub.test.ts. Maybe extract better utils?
    describe('_getRelayStatus', function () {
        let relayProvider: RelayProvider;
        let testRecipient: TestRecipientInstance;
        const gas = toBN(3e6).toString();

        // It is not strictly necessary to make this test against actual tx receipt, but I prefer to do it anyway
        before(async function () {
            const TestRecipient = artifacts.require('TestRecipient');
            testRecipient = await TestRecipient.new();
            const env = await getTestingEnvironment();
            const config = configure({
                relayHubAddress: relayHub.address,
                logLevel: 5,
                chainId: env.chainId,
                relayVerifierAddress: verifierInstance.address,
                deployVerifierAddress: verifierInstance.address,
                forwarderAddress: smartWallet.address
            });

            // @ts-ignore
            Object.keys(TestRecipient.events).forEach(function (topic) {
                // @ts-ignore
                relayHub.constructor.network.events[topic] =
                    TestRecipient.events[topic];
            });
            relayProvider = new RelayProvider(underlyingProvider, config);
            relayProvider.addAccount(gaslessAccount);
            // @ts-ignore
            TestRecipient.web3.setProvider(relayProvider);
            // add accounts[0], accounts[1] and accounts[2] as worker, manager and owner
            await relayHub.stakeForAddress(accounts[1], 1000, {
                value: ether('1'),
                from: accounts[2]
            });
            await relayHub.addRelayWorkers([accounts[0]], {
                from: accounts[1]
            });

            // create desired transactions
            const nonceToUse = await smartWallet.nonce();
            const { relayRequest, signature } = await prepareTransaction(
                relayHub.address,
                testRecipient,
                gaslessAccount,
                accounts[0],
                verifierInstance.address,
                nonceToUse.toString(),
                smartWallet.address,
                token.address,
                '1'
            );

            await verifierInstance.setReturnInvalidErrorCode(false);
            await verifierInstance.setRevertPreRelayCall(false);
            await verifierInstance.setOverspendAcceptGas(false);

            const innerTxSuccessReceiptTruffle = await relayHub.relayCall(
                relayRequest,
                signature,
                {
                    from: accounts[0],
                    gas,
                    gasPrice: '1'
                }
            );

            expectEvent.inLogs(
                innerTxSuccessReceiptTruffle.logs,
                'TransactionRelayed'
            );
            expectEvent.inLogs(
                innerTxSuccessReceiptTruffle.logs,
                'SampleRecipientEmitted'
            );

            const notRelayedTxReceiptTruffle = await testRecipient.emitMessage(
                'hello world with gas',
                {
                    from: gaslessAccount.address,
                    gas: '100000',
                    gasPrice: '1',
                    callVerifier: verifierInstance.address
                }
            );
            assert.equal(notRelayedTxReceiptTruffle.logs.length, 1);
            expectEvent.inLogs(
                notRelayedTxReceiptTruffle.logs,
                'SampleRecipientEmitted'
            );
        });

        it('should fail to send transaction if verifier reverts in local execution', async function () {
            await verifierInstance.setReturnInvalidErrorCode(false);
            await verifierInstance.setRevertPreRelayCall(true);
            await verifierInstance.setOverspendAcceptGas(false);

            try {
                await testRecipient.emitMessage('hello again', {
                    from: gaslessAccount.address,
                    gas: '100000',
                    gasPrice: '1',
                    callVerifier: verifierInstance.address
                });
            } catch (error) {
                const err: string =
                    error instanceof Error
                        ? error.message
                        : JSON.stringify(error);
                if (revertReasonEnabled) {
                    assert.isTrue(
                        err.includes(
                            "verifier rejected in local view call : view call to 'relayCall' reverted in verifier"
                        )
                    );
                    assert.isTrue(
                        err.includes('revertPreRelayCall: Reverting')
                    );
                }
                return;
            }

            assert.fail('It should have thrown an exception');
        });

        it('should fail to send transaction if verifier fails in local execution', async function () {
            await verifierInstance.setReturnInvalidErrorCode(true);
            await verifierInstance.setRevertPreRelayCall(false);
            await verifierInstance.setOverspendAcceptGas(false);

            try {
                await testRecipient.emitMessage('hello again', {
                    from: gaslessAccount.address,
                    gas: '100000',
                    gasPrice: '1',
                    callVerifier: verifierInstance.address
                });
            } catch (error) {
                const err = String(error);
                if (revertReasonEnabled) {
                    assert.isTrue(
                        err.includes(
                            "verifier rejected in local view call : view call to 'relayCall' reverted in verifier"
                        )
                    );
                    assert.isTrue(err.includes('invalid code'));
                }
                return;
            }

            assert.fail('It should have thrown an exception');
        });
    });

    describe('_getAccounts', function () {
        it('should append ephemeral accounts to the ones from the underlying provider', async function () {
            const relayProvider = new RelayProvider(underlyingProvider, {
                logLevel: 5
            });
            const web3 = new Web3(relayProvider);
            const accountsBefore = await web3.eth.getAccounts();
            const newAccount = relayProvider.newAccount();
            const address = '0x982a8cbe734cb8c29a6a7e02a3b0e4512148f6f9';
            relayProvider.addAccount({
                privateKey: Buffer.from(
                    'd353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c',
                    'hex'
                ),
                address
            });
            const accountsAfter = await web3.eth.getAccounts();
            const newAccounts = accountsAfter
                .filter((value) => !accountsBefore.includes(value))
                .map((it) => it.toLowerCase());
            assert.equal(newAccounts.length, 2);
            assert.include(newAccounts, address);
            assert.include(newAccounts, newAccount.address);
        });
    });

    describe('new contract deployment', function () {
        let TestRecipient: TestRecipientContract;
        before(async function () {
            TestRecipient = artifacts.require('TestRecipient');

            const config = configure({
                logLevel: 5,
                relayHubAddress: relayHub.address,
                chainId: (await getTestingEnvironment()).chainId
            });
            config.forwarderAddress = smartWallet.address;

            let websocketProvider: WebsocketProvider;

            if (isRsk(await getTestingEnvironment())) {
                websocketProvider = new Web3.providers.WebsocketProvider(
                    'ws://localhost:4445/websocket'
                );
            } else {
                websocketProvider = new Web3.providers.WebsocketProvider(
                    underlyingProvider.host
                );
            }

            relayProvider = new RelayProvider(websocketProvider as any, config);
            // @ts-ignore
            TestRecipient.web3.setProvider(relayProvider);
        });

        it('should throw on calling .new without useEnveloping: false', async function () {
            await expect(TestRecipient.new()).to.be.eventually.rejectedWith(
                'Enveloping cannot relay contract deployment transactions. Add {from: accountWithRBTC, useEnveloping: false}.'
            );
        });

        it('should deploy a contract without Enveloping on calling .new with useEnveloping: false', async function () {
            const testRecipient = await TestRecipient.new({
                from: accounts[0],
                useEnveloping: false
            });
            const receipt = await web3.eth.getTransactionReceipt(
                testRecipient.transactionHash
            );
            assert.equal(receipt.from.toLowerCase(), accounts[0].toLowerCase());
        });
    });
});

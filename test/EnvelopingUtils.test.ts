import { ChildProcessWithoutNullStreams } from 'child_process';
import { BN, toBuffer } from 'ethereumjs-util';
import {
    SmartWalletFactoryInstance,
    RelayHubInstance,
    SmartWalletInstance,
    TestDeployVerifierEverythingAcceptedInstance,
    TestRecipientInstance,
    TestTokenInstance,
    TestVerifierEverythingAcceptedInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    createSmartWalletFactory,
    deployHub,
    getTestingEnvironment,
    startRelay,
    stopRelay
} from './TestUtils';
import {
    EnvelopingConfig,
    constants,
    isSameAddress,
    TypedRequestData,
    DeployRequest,
    RelayRequest
} from '@rsksmart/rif-relay-common';
import { randomHex, toChecksumAddress } from 'web3-utils';
import { PrefixedHexString } from 'ethereumjs-tx';
import sigUtil from 'eth-sig-util';
import Web3 from 'web3';
// @ts-ignore
import abiDecoder from 'abi-decoder';
import { hdkey as EthereumHDKey } from 'ethereumjs-wallet';
import {
    DiscoveryConfig,
    SmartWalletDiscovery,
    configure,
    Enveloping,
    SignatureProvider,
    AccountKeypair
} from '@rsksmart/rif-relay-client';
import { WebsocketProvider } from 'web3-core';
import { RIF_RELAY_URL } from './Utils';

contract('Enveloping utils', function (accounts) {
    describe('Relay-related functionalities', function () {
        const TestRecipient = artifacts.require('tests/TestRecipient');
        const TestToken = artifacts.require('TestToken');
        const SmartWallet = artifacts.require('SmartWallet');
        const TestVerifierEverythingAccepted = artifacts.require(
            'tests/TestVerifierEverythingAccepted'
        );
        const TestDeployVerifierEverythingAccepted = artifacts.require(
            'tests/TestDeployVerifierEverythingAccepted'
        );
        const SmartWalletFactory = artifacts.require('SmartWalletFactory');

        const localhost = RIF_RELAY_URL;
        const message = 'hello world';

        // @ts-ignore
        abiDecoder.addABI(TestRecipient.abi);
        // @ts-ignore
        abiDecoder.addABI(SmartWalletFactory.abi);
        let enveloping: Enveloping;
        let tokenContract: TestTokenInstance;
        let relayHub: RelayHubInstance;
        let verifier: TestVerifierEverythingAcceptedInstance;
        let deployVerifier: TestDeployVerifierEverythingAcceptedInstance;
        let factory: SmartWalletFactoryInstance;
        let sWalletTemplate: SmartWalletInstance;
        let testRecipient: TestRecipientInstance;
        let chainId: number;
        let workerAddress: string;
        let config: EnvelopingConfig;
        let fundedAccount: AccountKeypair;
        let gaslessAccount: AccountKeypair;
        let relayproc: ChildProcessWithoutNullStreams;
        let swAddress: string;
        let index: string;

        const signatureProvider: SignatureProvider = {
            sign: (dataToSign: TypedRequestData) => {
                const privKey = toBuffer(
                    '0x082f57b8084286a079aeb9f2d0e17e565ced44a2cb9ce4844e6d4b9d89f3f595'
                );
                // @ts-ignore
                return sigUtil.signTypedData_v4(privKey, { data: dataToSign });
            },
            verifySign: (
                signature: PrefixedHexString,
                dataToSign: TypedRequestData,
                request: RelayRequest | DeployRequest
            ) => {
                // @ts-ignore
                const rec = sigUtil.recoverTypedSignature_v4({
                    data: dataToSign,
                    sig: signature
                });
                return isSameAddress(request.request.from, rec);
            }
        };

        const deploySmartWallet = async function deploySmartWallet(
            tokenContract: string,
            tokenAmount: string,
            tokenGas: string
        ): Promise<string | undefined> {
            const deployRequest = await enveloping.createDeployRequest(
                gaslessAccount.address,
                tokenContract,
                tokenAmount,
                tokenGas,
                '1000000000',
                index
            );
            const deploySignature = enveloping.signDeployRequest(
                signatureProvider,
                deployRequest
            );
            const httpDeployRequest =
                await enveloping.generateDeployTransactionRequest(
                    deploySignature,
                    deployRequest
                );
            const sentDeployTransaction = await enveloping.sendTransaction(
                localhost,
                httpDeployRequest
            );
            return sentDeployTransaction.transaction
                ?.hash(true)
                .toString('hex');
        };

        const assertSmartWalletDeployedCorrectly =
            async function assertSmartWalletDeployedCorrectly(
                swAddress: string
            ): Promise<void> {
                const deployedCode = await web3.eth.getCode(swAddress);
                let expectedCode = await factory.getCreationBytecode();
                expectedCode =
                    '0x' + expectedCode.slice(20, expectedCode.length);
                assert.equal(deployedCode, expectedCode);
            };

        const relayTransaction = async function relayTransaction(
            tokenContract: string,
            tokenAmount: string,
            tokenGas: string
        ): Promise<string | undefined> {
            const encodedFunction = testRecipient.contract.methods
                .emitMessage(message)
                .encodeABI();
            const relayRequest = await enveloping.createRelayRequest(
                gaslessAccount.address,
                testRecipient.address,
                swAddress,
                encodedFunction,
                tokenContract,
                tokenAmount,
                tokenGas
            );
            const relaySignature = enveloping.signRelayRequest(
                signatureProvider,
                relayRequest
            );
            const httpRelayRequest =
                await enveloping.generateRelayTransactionRequest(
                    relaySignature,
                    relayRequest
                );
            const sentRelayTransaction = await enveloping.sendTransaction(
                localhost,
                httpRelayRequest
            );
            return sentRelayTransaction.transaction?.hash(true).toString('hex');
        };

        before(async () => {
            gaslessAccount = {
                privateKey: toBuffer(
                    '0x082f57b8084286a079aeb9f2d0e17e565ced44a2cb9ce4844e6d4b9d89f3f595'
                ),
                address: '0x09a1eda29f664ac8f68106f6567276df0c65d859'
            };
            fundedAccount = {
                privateKey: toBuffer(
                    '0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4'
                ),
                address: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
            };
            testRecipient = await TestRecipient.new();
            sWalletTemplate = await SmartWallet.new();
            verifier = await TestVerifierEverythingAccepted.new();
            deployVerifier = await TestDeployVerifierEverythingAccepted.new();
            factory = await createSmartWalletFactory(sWalletTemplate);
            chainId = (await getTestingEnvironment()).chainId;
            tokenContract = await TestToken.new();
            relayHub = await deployHub();
        });

        beforeEach(async () => {
            index = randomHex(32);
            swAddress = await factory.getSmartWalletAddress(
                gaslessAccount.address,
                constants.ZERO_ADDRESS,
                index
            );

            const partialConfig: Partial<EnvelopingConfig> = {
                relayHubAddress: relayHub.address,
                smartWalletFactoryAddress: factory.address,
                chainId: chainId,
                relayVerifierAddress: verifier.address,
                deployVerifierAddress: deployVerifier.address,
                preferredRelays: [RIF_RELAY_URL]
            };

            config = configure(partialConfig);
            const serverData = await startRelay(relayHub, {
                stake: 1e18,
                delay: 3600 * 24 * 7,
                url: 'asd',
                relayOwner: fundedAccount.address,
                gasPriceFactor: 1,
                // @ts-ignore
                rskNodeUrl: web3.currentProvider.host,
                relayVerifierAddress: verifier.address,
                deployVerifierAddress: deployVerifier.address
            });
            relayproc = serverData.proc;
            workerAddress = serverData.worker;
            enveloping = new Enveloping(config, web3, workerAddress);
            await enveloping._init();
        });

        afterEach(async function () {
            await stopRelay(relayproc);
        });

        it('Should deploy a smart wallet correctly and relay a tx using enveloping utils without tokens', async () => {
            const expectedInitialCode = await web3.eth.getCode(swAddress);
            assert.equal('0x', expectedInitialCode);

            const txDeployHash = await deploySmartWallet(
                constants.ZERO_ADDRESS,
                '0',
                '0'
            );

            if (txDeployHash === undefined) {
                assert.fail(
                    'Transacion has not been send or it threw an error'
                );
            }

            let txReceipt = await web3.eth.getTransactionReceipt(txDeployHash);
            let logs = abiDecoder.decodeLogs(txReceipt.logs);

            const deployedEvent = logs.find(
                (e: any) => e != null && e.name === 'Deployed'
            );
            assert.equal(
                swAddress.toLowerCase(),
                deployedEvent.events[0].value.toLowerCase()
            );

            await assertSmartWalletDeployedCorrectly(swAddress);

            const txRelayHash = await relayTransaction(
                constants.ZERO_ADDRESS,
                '0',
                '0'
            );

            if (txRelayHash === undefined) {
                assert.fail(
                    'Transacion has not been send or it threw an error'
                );
            }

            txReceipt = await web3.eth.getTransactionReceipt(txRelayHash);
            logs = abiDecoder.decodeLogs(txReceipt.logs);

            const sampleRecipientEmittedEvent = logs.find(
                (e: any) => e != null && e.name === 'SampleRecipientEmitted'
            );

            assert.equal(message, sampleRecipientEmittedEvent.events[0].value);
            assert.equal(
                swAddress.toLowerCase(),
                sampleRecipientEmittedEvent.events[1].value.toLowerCase()
            );
            assert.equal(
                workerAddress.toLowerCase(),
                sampleRecipientEmittedEvent.events[2].value.toLowerCase()
            );
        });

        it('Should deploy a smart wallet correctly and relay a tx using enveloping utils paying with tokens', async () => {
            const expectedInitialCode = await web3.eth.getCode(swAddress);
            const balanceTransfered = new BN(10);
            assert.equal('0x', expectedInitialCode);
            await tokenContract.mint('100', swAddress);
            const previousBalance = await tokenContract.balanceOf(
                workerAddress
            );

            const txDeployHash = await deploySmartWallet(
                tokenContract.address,
                '10',
                '50000'
            );

            if (txDeployHash === undefined) {
                assert.fail(
                    'Transacion has not been send or it threw an error'
                );
            }

            let txReceipt = await web3.eth.getTransactionReceipt(txDeployHash);
            let logs = abiDecoder.decodeLogs(txReceipt.logs);

            const deployedEvent = logs.find(
                (e: any) => e != null && e.name === 'Deployed'
            );
            assert.equal(
                swAddress.toLowerCase(),
                deployedEvent.events[0].value.toLowerCase()
            );

            await assertSmartWalletDeployedCorrectly(swAddress);

            const newBalance = await tokenContract.balanceOf(workerAddress);
            assert.equal(
                newBalance.toNumber(),
                previousBalance.add(balanceTransfered).toNumber()
            );

            const txRelayHash = await relayTransaction(
                tokenContract.address,
                '10',
                '50000'
            );

            if (txRelayHash === undefined) {
                assert.fail('Transacion has not been send');
            }

            const finalBalance = await tokenContract.balanceOf(workerAddress);

            txReceipt = await web3.eth.getTransactionReceipt(txRelayHash);
            logs = abiDecoder.decodeLogs(txReceipt.logs);

            const sampleRecipientEmittedEvent = logs.find(
                (e: any) => e != null && e.name === 'SampleRecipientEmitted'
            );

            assert.equal(message, sampleRecipientEmittedEvent.events[0].value);
            assert.equal(
                swAddress.toLowerCase(),
                sampleRecipientEmittedEvent.events[1].value.toLowerCase()
            );
            assert.equal(
                workerAddress.toLowerCase(),
                sampleRecipientEmittedEvent.events[2].value.toLowerCase()
            );

            assert.equal(
                finalBalance.toNumber(),
                newBalance.add(balanceTransfered).toNumber()
            );
        });
    });

    describe('discoverAccountsFromExtendedPublicKeys', function () {
        const currentPassword = '0';
        const TestToken = artifacts.require('TestToken');
        const SmartWallet = artifacts.require('SmartWallet');
        const SmartWalletFactory = artifacts.require('SmartWalletFactory');
        let socketProvider: WebsocketProvider;
        let byteCodeHash: string;
        const mnemonic =
            'figure arrow make ginger educate drip thing theory champion faint vendor push';
        let currentWeb3: Web3;
        const discoverableAccounts = new Set<string>();
        const usedPublicKeys: string[] = [];
        let token: TestTokenInstance;
        let factory: SmartWalletFactoryInstance;
        let chainId: number;

        before(async function () {
            chainId = (await getTestingEnvironment()).chainId;
            socketProvider = new Web3.providers.WebsocketProvider(
                'ws://127.0.0.1:4445/websocket'
            );

            currentWeb3 = new Web3(socketProvider);

            TestToken.setProvider(socketProvider, undefined);
            SmartWallet.setProvider(socketProvider, undefined);
            SmartWalletFactory.setProvider(socketProvider, undefined);

            const sWalletTemplate = await SmartWallet.new();
            factory = await SmartWalletFactory.new(sWalletTemplate.address);
            byteCodeHash = currentWeb3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            token = await TestToken.new();

            const rootKey: EthereumHDKey =
                SmartWalletDiscovery.getRootExtKeyFromMnemonic(
                    mnemonic,
                    currentPassword
                );

            for (let accIdx = 0; accIdx < 2; accIdx++) {
                const firstAccountRoot = rootKey.derivePath(
                    `m/44'/37310'/${accIdx}'/0`
                );
                usedPublicKeys.push(
                    firstAccountRoot.publicExtendedKey().toString()
                );

                for (let i = 0; i < 20; i++) {
                    const account = firstAccountRoot
                        .deriveChild(i)
                        .getWallet()
                        .getAddressString();
                    await currentWeb3.eth.sendTransaction({
                        from: accounts[0],
                        to: account,
                        value: 1
                    });
                    discoverableAccounts.add(account);

                    for (let j = 0; j < 20; j++) {
                        const swAddress = calculateSmartWalletAddress(
                            factory.address,
                            account,
                            constants.ZERO_ADDRESS,
                            j,
                            byteCodeHash
                        );
                        await currentWeb3.eth.sendTransaction({
                            from: accounts[0],
                            to: swAddress,
                            value: 1
                        });
                        discoverableAccounts.add(swAddress);
                    }
                }
            }
        });

        after(function () {
            const socketProvider =
                currentWeb3.currentProvider as WebsocketProvider;
            socketProvider.disconnect(0, '');
            assert.isFalse(
                socketProvider.connected,
                'Socket connection did not end'
            );
        });

        function calculateSmartWalletAddress(
            factory: string,
            ownerEOA: string,
            recoverer: string,
            walletIndex: number,
            bytecodeHash: string
        ): string {
            const salt: string =
                web3.utils.soliditySha3(
                    { t: 'address', v: ownerEOA },
                    { t: 'address', v: recoverer },
                    { t: 'uint256', v: walletIndex }
                ) ?? '';

            const _data: string =
                web3.utils.soliditySha3(
                    { t: 'bytes1', v: '0xff' },
                    { t: 'address', v: factory },
                    { t: 'bytes32', v: salt },
                    { t: 'bytes32', v: bytecodeHash }
                ) ?? '';

            return toChecksumAddress(
                '0x' + _data.slice(26, _data.length),
                chainId
            );
        }

        it('Should discover Accounts using External Public Keys', async () => {
            const config: DiscoveryConfig = new DiscoveryConfig({
                factory: factory.address,
                recoverer: constants.ZERO_ADDRESS,
                isCustomWallet: false,
                isTestNet: true
            });

            const discoveredAccounts =
                await Enveloping.discoverAccountsFromExtendedPublicKeys(
                    config,
                    socketProvider,
                    usedPublicKeys,
                    [token.address]
                );
            assert.equal(
                discoveredAccounts.length,
                40,
                'Incorrect number of EOA Accounts discovered'
            );

            for (let i = 0; i < discoveredAccounts.length; i++) {
                const discoveredAccount = discoveredAccounts[i];
                assert.equal(
                    discoveredAccount.swAccounts.length,
                    20,
                    `incorrect sw accounts discovered for address ${discoveredAccount.eoaAccount}`
                );

                const account = discoveredAccount.eoaAccount;
                assert.isTrue(
                    discoverableAccounts.has(account),
                    'Discovered Account not part of Discoverable Set'
                );
                discoverableAccounts.delete(account);

                for (let j = 0; j < 20; j++) {
                    const swAccount = discoveredAccount.swAccounts[j];
                    assert.isTrue(
                        discoverableAccounts.has(swAccount),
                        'Discovered SWAccount not part of Discoverable Set'
                    );
                    discoverableAccounts.delete(swAccount);
                }
            }

            assert.isTrue(
                discoverableAccounts.size === 0,
                'Some Discoverable Accounts were not found'
            );
        });
    });

    describe('discoverAccountsUsingMnemonic', function () {
        const currentPassword = '1';
        const TestToken = artifacts.require('TestToken');
        const SmartWallet = artifacts.require('SmartWallet');
        const SmartWalletFactory = artifacts.require('SmartWalletFactory');
        let socketProvider: WebsocketProvider;
        let byteCodeHash: string;
        const mnemonic =
            'figure arrow make ginger educate drip thing theory champion faint vendor push';
        let currentWeb3: Web3;
        const discoverableAccounts = new Set<string>();
        const usedPublicKeys: string[] = [];
        let token: TestTokenInstance;
        let factory: SmartWalletFactoryInstance;
        let chainId: number;

        before(async function () {
            chainId = (await getTestingEnvironment()).chainId;
            socketProvider = new Web3.providers.WebsocketProvider(
                'ws://127.0.0.1:4445/websocket'
            );

            currentWeb3 = new Web3(socketProvider);

            TestToken.setProvider(socketProvider, undefined);
            SmartWallet.setProvider(socketProvider, undefined);
            SmartWalletFactory.setProvider(socketProvider, undefined);

            const sWalletTemplate = await SmartWallet.new();
            factory = await SmartWalletFactory.new(sWalletTemplate.address);
            byteCodeHash = currentWeb3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            token = await TestToken.new();

            const rootKey: EthereumHDKey =
                SmartWalletDiscovery.getRootExtKeyFromMnemonic(
                    mnemonic,
                    currentPassword
                );

            for (let accIdx = 0; accIdx < 2; accIdx++) {
                const firstAccountRoot = rootKey.derivePath(
                    `m/44'/37310'/${accIdx}'/0`
                );
                usedPublicKeys.push(
                    firstAccountRoot.publicExtendedKey().toString()
                );

                for (let i = 0; i < 20; i++) {
                    const account = firstAccountRoot
                        .deriveChild(i)
                        .getWallet()
                        .getAddressString();
                    await currentWeb3.eth.sendTransaction({
                        from: accounts[0],
                        to: account,
                        value: 1
                    });
                    discoverableAccounts.add(account);

                    for (let j = 0; j < 20; j++) {
                        const swAddress = calculateSmartWalletAddress(
                            factory.address,
                            account,
                            constants.ZERO_ADDRESS,
                            j,
                            byteCodeHash
                        );
                        await currentWeb3.eth.sendTransaction({
                            from: accounts[0],
                            to: swAddress,
                            value: 1
                        });
                        discoverableAccounts.add(swAddress);
                    }
                }
            }
        });

        after(function () {
            const socketProvider =
                currentWeb3.currentProvider as WebsocketProvider;
            socketProvider.disconnect(0, '');
            assert.isFalse(
                socketProvider.connected,
                'Socket connection did not end'
            );
        });

        function calculateSmartWalletAddress(
            factory: string,
            ownerEOA: string,
            recoverer: string,
            walletIndex: number,
            bytecodeHash: string
        ): string {
            const salt: string =
                web3.utils.soliditySha3(
                    { t: 'address', v: ownerEOA },
                    { t: 'address', v: recoverer },
                    { t: 'uint256', v: walletIndex }
                ) ?? '';

            const _data: string =
                web3.utils.soliditySha3(
                    { t: 'bytes1', v: '0xff' },
                    { t: 'address', v: factory },
                    { t: 'bytes32', v: salt },
                    { t: 'bytes32', v: bytecodeHash }
                ) ?? '';

            return toChecksumAddress(
                '0x' + _data.slice(26, _data.length),
                chainId
            );
        }

        it('Should discover Accounts using Mnemonic', async () => {
            const config: DiscoveryConfig = new DiscoveryConfig({
                factory: factory.address,
                recoverer: constants.ZERO_ADDRESS,
                isCustomWallet: false,
                isTestNet: true
            });

            const discoveredAccounts =
                await Enveloping.discoverAccountsUsingMnemonic(
                    config,
                    socketProvider,
                    mnemonic,
                    currentPassword,
                    [token.address]
                );

            assert.equal(
                discoveredAccounts.length,
                40,
                'Incorrect number of EOA Accounts discovered'
            );

            for (let i = 0; i < discoveredAccounts.length; i++) {
                assert.equal(
                    discoveredAccounts[i].swAccounts.length,
                    20,
                    `incorrect sw accounts discovered for address ${discoveredAccounts[i].eoaAccount}`
                );
                const account = discoveredAccounts[i].eoaAccount;
                assert.isTrue(
                    discoverableAccounts.has(account),
                    'Discovered Account not part of Discoverable Set'
                );
                discoverableAccounts.delete(account);

                for (let j = 0; j < 20; j++) {
                    const swAccount = discoveredAccounts[i].swAccounts[j];
                    assert.isTrue(
                        discoverableAccounts.has(swAccount),
                        'Discovered SWAccount not part of Discoverable Set'
                    );
                    discoverableAccounts.delete(swAccount);
                }
            }

            assert.isTrue(
                discoverableAccounts.size === 0,
                'Some Discoverable Accounts were not found'
            );
        });
    });

    describe('discoverAccounts - using template method', function () {
        const currentPassword = '2';
        const TestToken = artifacts.require('TestToken');
        const SmartWallet = artifacts.require('SmartWallet');
        const SmartWalletFactory = artifacts.require('SmartWalletFactory');
        let socketProvider: WebsocketProvider;
        let byteCodeHash: string;
        const mnemonic =
            'figure arrow make ginger educate drip thing theory champion faint vendor push';
        let currentWeb3: Web3;
        const discoverableAccounts = new Set<string>();
        const usedPublicKeys: string[] = [];
        let token: TestTokenInstance;
        let factory: SmartWalletFactoryInstance;
        let chainId: number;

        async function getUsedPubKey(
            accountIdx: number
        ): Promise<string | undefined> {
            return accountIdx < usedPublicKeys.length
                ? usedPublicKeys[accountIdx]
                : undefined;
        }

        before(async function () {
            chainId = (await getTestingEnvironment()).chainId;
            socketProvider = new Web3.providers.WebsocketProvider(
                'ws://127.0.0.1:4445/websocket'
            );

            currentWeb3 = new Web3(socketProvider);

            TestToken.setProvider(socketProvider, undefined);
            SmartWallet.setProvider(socketProvider, undefined);
            SmartWalletFactory.setProvider(socketProvider, undefined);

            const sWalletTemplate = await SmartWallet.new();
            factory = await SmartWalletFactory.new(sWalletTemplate.address);
            byteCodeHash = currentWeb3.utils.keccak256(
                await factory.getCreationBytecode()
            );
            token = await TestToken.new();

            const rootKey: EthereumHDKey =
                SmartWalletDiscovery.getRootExtKeyFromMnemonic(
                    mnemonic,
                    currentPassword
                );

            for (let accIdx = 0; accIdx < 2; accIdx++) {
                const firstAccountRoot = rootKey.derivePath(
                    `m/44'/37310'/${accIdx}'/0`
                );
                usedPublicKeys.push(
                    firstAccountRoot.publicExtendedKey().toString()
                );

                for (let i = 0; i < 20; i++) {
                    const account = firstAccountRoot
                        .deriveChild(i)
                        .getWallet()
                        .getAddressString();
                    await currentWeb3.eth.sendTransaction({
                        from: accounts[0],
                        to: account,
                        value: 1
                    });
                    discoverableAccounts.add(account);

                    for (let j = 0; j < 20; j++) {
                        const swAddress = calculateSmartWalletAddress(
                            factory.address,
                            account,
                            constants.ZERO_ADDRESS,
                            j,
                            byteCodeHash
                        );
                        await currentWeb3.eth.sendTransaction({
                            from: accounts[0],
                            to: swAddress,
                            value: 1
                        });
                        discoverableAccounts.add(swAddress);
                    }
                }
            }
        });

        after(function () {
            const socketProvider =
                currentWeb3.currentProvider as WebsocketProvider;
            socketProvider.disconnect(0, '');
            assert.isFalse(
                socketProvider.connected,
                'Socket connection did not end'
            );
        });

        function calculateSmartWalletAddress(
            factory: string,
            ownerEOA: string,
            recoverer: string,
            walletIndex: number,
            bytecodeHash: string
        ): string {
            const salt: string =
                web3.utils.soliditySha3(
                    { t: 'address', v: ownerEOA },
                    { t: 'address', v: recoverer },
                    { t: 'uint256', v: walletIndex }
                ) ?? '';

            const _data: string =
                web3.utils.soliditySha3(
                    { t: 'bytes1', v: '0xff' },
                    { t: 'address', v: factory },
                    { t: 'bytes32', v: salt },
                    { t: 'bytes32', v: bytecodeHash }
                ) ?? '';

            return toChecksumAddress(
                '0x' + _data.slice(26, _data.length),
                chainId
            );
        }

        it('Should discover Accounts using template method', async () => {
            const config: DiscoveryConfig = new DiscoveryConfig({
                factory: factory.address,
                recoverer: constants.ZERO_ADDRESS,
                isCustomWallet: false,
                isTestNet: true
            });

            const discoveredAccounts = await Enveloping.discoverAccounts(
                config,
                socketProvider,
                getUsedPubKey,
                [token.address]
            );

            assert.equal(
                discoveredAccounts.length,
                40,
                'Incorrect number of EOA Accounts discovered'
            );

            for (let i = 0; i < discoveredAccounts.length; i++) {
                assert.equal(
                    discoveredAccounts[i].swAccounts.length,
                    20,
                    `incorrect sw accounts discovered for address ${discoveredAccounts[i].eoaAccount}`
                );
                const account = discoveredAccounts[i].eoaAccount;
                assert.isTrue(
                    discoverableAccounts.has(account),
                    'Discovered Account not part of Discoverable Set'
                );
                discoverableAccounts.delete(account);

                for (let j = 0; j < 20; j++) {
                    const swAccount = discoveredAccounts[i].swAccounts[j];
                    assert.isTrue(
                        discoverableAccounts.has(swAccount),
                        'Discovered SWAccount not part of Discoverable Set'
                    );
                    discoverableAccounts.delete(swAccount);
                }
            }

            assert.isTrue(
                discoverableAccounts.size === 0,
                'Some Discoverable Accounts were not found'
            );
        });
    });
});

import { ether } from '@openzeppelin/test-helpers';
import { AccountKeypair, configure } from '@rsksmart/rif-relay-client';
import {
    constants,
    ContractInteractor,
    Environment,
    getLocalEip712Signature,
    RelayMetadata,
    RelayTransactionRequest
} from '@rsksmart/rif-relay-common';
import { RelayRequest, TypedRequestData } from '@rsksmart/rif-relay-contracts';
import {
    Dummy2Instance,
    Dummy3Instance,
    DummyInstance,
    IForwarderInstance,
    PenalizerInstance,
    RelayHubInstance,
    RelayVerifierInstance,
    SmartWalletFactoryInstance,
    SmartWalletInstance,
    TestTokenInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    KeyManager,
    RelayServer,
    ServerConfigParams,
    ServerDependencies,
    TxStoreManager
} from '@rsksmart/rif-relay-server';
import Web3 from 'web3';
import {
    createSmartWallet,
    createSmartWalletFactory,
    deployHub,
    getGaslessAccount,
    getTestingEnvironment
} from './TestUtils';
import { hdkey as EthereumHDKey } from 'ethereumjs-wallet';
import { AbiItem } from 'web3-utils';
// @ts-ignore
import abiDecoder from 'abi-decoder';

const Penalizer = artifacts.require('Penalizer');
const Dummy = artifacts.require('Dummy');
const Dummy2 = artifacts.require('Dummy2');
const Dummy3 = artifacts.require('Dummy3');
const SmartWallet = artifacts.require('SmartWallet');
const TestToken = artifacts.require('TestToken');
const RelayVerifier = artifacts.require('RelayVerifier');
const RelayHubContract = artifacts.require('RelayHub');

// @ts-ignore
abiDecoder.addABI(SmartWallet.abi);

type Result = {
    transaction: string;
    beforeExecution: string;
    afterExecution: string;
    gasUsed: number;
    gas: number;
    gasEstimated: number;
    cumulativeGasUsed: number;
};

contract('DummyServer', function ([_]) {
    let env: Environment;
    let chainId: number;
    let penalizer: PenalizerInstance;
    let relayHub: RelayHubInstance;
    let relayVerifier: RelayVerifierInstance;
    let factory: SmartWalletFactoryInstance;
    let gaslessAccount: AccountKeypair;
    let forwarder: IForwarderInstance;
    let relayRequest: RelayRequest;
    let token: TestTokenInstance;
    let dummy: DummyInstance;
    let dummy2: Dummy2Instance;
    let dummy3: Dummy3Instance;

    let nonce: string;
    let gasPrice: string;
    let contractInteractor: ContractInteractor;
    let relayServer: RelayServer;
    let config: Partial<ServerConfigParams>;

    beforeEach(async function () {
        env = await getTestingEnvironment();
        chainId = env.chainId;
        penalizer = await Penalizer.new();
        relayHub = await deployHub(penalizer.address);

        const smartWalletTemplate: SmartWalletInstance =
            await SmartWallet.new();
        factory = await createSmartWalletFactory(smartWalletTemplate);
        relayVerifier = await RelayVerifier.new(factory.address);
        gaslessAccount = await getGaslessAccount();
        forwarder = await createSmartWallet(
            _,
            gaslessAccount.address,
            factory,
            gaslessAccount.privateKey,
            chainId
        );
        token = await TestToken.new();
        nonce = (await forwarder.nonce()).toString();
        gasPrice = '60000000';
        config = {
            port: 9090,
            trustedVerifiers: [relayVerifier.address],
            checkInterval: 1000
        };
        const web3provider = new Web3.providers.HttpProvider(
            'http://localhost:4444'
        );
        const randomSeed = Buffer.from('');
        const managerKeyManager = new KeyManager(1, undefined, randomSeed);
        const workersKeyManager = new KeyManager(1);
        contractInteractor = new ContractInteractor(
            web3provider,
            configure({
                relayHubAddress: relayHub.address,
                deployVerifierAddress: constants.ZERO_ADDRESS,
                relayVerifierAddress: constants.ZERO_ADDRESS
            })
        );
        await contractInteractor.init();
        const txStoreManager = new TxStoreManager({ inMemory: true });
        const dependencies: ServerDependencies = {
            managerKeyManager,
            workersKeyManager,
            contractInteractor,
            txStoreManager
        };
        relayServer = new RelayServer(config, dependencies);

        await web3.eth.sendTransaction({
            from: _,
            to: relayServer.managerAddress,
            value: relayServer.config.managerTargetBalance
        });

        await web3.eth.sendTransaction({
            from: _,
            to: relayServer.workerAddress,
            value: relayServer.config.workerTargetBalance
        });
        await relayVerifier.acceptToken(token.address);
        await token.mint(ether('10'), forwarder.address);
        await relayHub.stakeForAddress(relayServer.managerAddress, 1000, {
            value: ether('2'),
            from: _
        });

        const hdkey = EthereumHDKey.fromMasterSeed(randomSeed);
        const account = hdkey.deriveChild(0).getWallet();

        const web3Account = await web3.eth.accounts.privateKeyToAccount(
            account.getPrivateKeyString()
        );
        web3.eth.accounts.wallet.add(web3Account);

        const swContract = new web3.eth.Contract(
            RelayHubContract.abi as AbiItem[],
            relayHub.address
        );

        await swContract.methods
            .addRelayWorkers([relayServer.workerAddress])
            .send({
                from: web3Account.address,
                gas: '2000000'
            });
        await relayServer.init();
        relayServer.setReadyState(true);
    });

    const estimateTokenGas = async (from: string, gasPrice: string) => {
        const estimation = await token.contract.methods
            .transfer(relayServer.managerAddress, ether('1'))
            .estimateGas({
                from,
                gasPrice
            });

        return applyInternalCorrection(estimation);
    };

    const estimateInternallCall = async (
        from: string,
        to: string,
        gasPrice: string,
        data: string
    ) => {
        const estimation = await web3.eth.estimateGas({
            from,
            to,
            gasPrice,
            data
        });

        return applyInternalCorrection(estimation);
    };

    const applyInternalCorrection = (estimation: number) => {
        return estimation > constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
            ? estimation - constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
            : estimation;
    };

    const pushToResults = (result: Result, results: Array<Result>) => {
        results.push(result);
    };

    let encodedFunctionDummy1;

    beforeEach(async function () {
        dummy = await Dummy.new();
        dummy2 = await Dummy2.new();
        dummy3 = await Dummy3.new();
        encodedFunctionDummy1 = dummy.contract.methods.stress(20).encodeABI();
    });

    describe('Dummy3', async function () {
        const results: Array<Result> = [];

        after(function () {
            console.table(results);
        });

        describe('callExternal(dummy2)', function () {
            const description = 'callExternal(dummy2)';
            let encodedFunctionDummy2;
            beforeEach(function () {
                encodedFunctionDummy2 = dummy2.contract.methods
                    .callExternal(dummy.address, encodedFunctionDummy1)
                    .encodeABI();
            });

            it('callExternal', async function () {
                const transaction = `${description}-callExternal`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });

            it('callExternalPush', async function () {
                const transaction = `${description}-callExternalPush`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2, 20)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });

            it('callExternalRefund', async function () {
                const transaction = `${description}-callExternalRefund`;
                const encodedFunction = dummy3.contract.methods
                    .callExternalRefund(
                        dummy2.address,
                        encodedFunctionDummy2,
                        20
                    )
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });
        });

        describe('callExternalPush(dummy2)', function () {
            let encodedFunctionDummy2;
            const description = 'callExternalPush(dummy2)';
            beforeEach(function () {
                encodedFunctionDummy2 = dummy2.contract.methods
                    .callExternal(dummy.address, encodedFunctionDummy1, 20)
                    .encodeABI();
            });

            it('callExternal', async function () {
                const transaction = `${description}-callExternal`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });

            it('callExternalPush', async function () {
                const transaction = `${description}-callExternalPush`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2, 20)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });

            it('callExternalRefund', async function () {
                const transaction = `${description}-callExternalRefund`;
                const encodedFunction = dummy3.contract.methods
                    .callExternalRefund(
                        dummy2.address,
                        encodedFunctionDummy2,
                        20
                    )
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });
        });

        describe('callExternalRefund(dummy2)', function () {
            let encodedFunctionDummy2;
            const description = 'callExternalRefund(dummy2)';
            beforeEach(function () {
                encodedFunctionDummy2 = dummy2.contract.methods
                    .callExternalRefund(
                        dummy.address,
                        encodedFunctionDummy1,
                        20
                    )
                    .encodeABI();
            });

            it('callExternal', async function () {
                const transaction = `${description}-callExternal`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });

            it('callExternalPush', async function () {
                const transaction = `${description}-callExternalPush`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2, 20)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });

            it('callExternalRefund', async function () {
                const transaction = `${description}-callExternalRefund`;
                const encodedFunction = dummy3.contract.methods
                    .callExternalRefund(
                        dummy2.address,
                        encodedFunctionDummy2,
                        20
                    )
                    .encodeABI();
                const gas = await estimateInternallCall(
                    gaslessAccount.address,
                    dummy3.address,
                    gasPrice,
                    encodedFunction
                );
                const tokenGas = await estimateTokenGas(
                    forwarder.address,
                    gasPrice
                );

                relayRequest = {
                    request: {
                        data: encodedFunction,
                        from: gaslessAccount.address,
                        gas: gas.toString(),
                        nonce,
                        relayHub: relayHub.address,
                        to: dummy3.address,
                        tokenAmount: ether('1').toString(),
                        tokenContract: token.address,
                        tokenGas: tokenGas.toString(),
                        value: '0'
                    },
                    relayData: {
                        callForwarder: forwarder.address,
                        callVerifier: relayVerifier.address,
                        feesReceiver: relayServer.workerAddress,
                        gasPrice
                    }
                };
                const dataToSign = new TypedRequestData(
                    chainId,
                    forwarder.address,
                    relayRequest
                );
                const signature = getLocalEip712Signature(
                    dataToSign,
                    gaslessAccount.privateKey
                );

                const transactionCount =
                    await contractInteractor.getTransactionCount(
                        relayServer.managerAddress
                    );
                const relayMaxNonce = transactionCount + 3;

                const metadata: RelayMetadata = {
                    relayHubAddress: relayHub.address,
                    relayMaxNonce,
                    signature
                };

                const request: RelayTransactionRequest = {
                    relayRequest,
                    metadata
                };

                console.log(transaction);
                const { transactionHash, maxPossibleGas } =
                    await relayServer.createRelayTransaction(request);

                const result = await web3.eth.getTransactionReceipt(
                    transactionHash
                );

                const logs = abiDecoder.decodeLogs(result.logs);
                pushToResults(
                    {
                        transaction,
                        beforeExecution: logs[0].events[0].value,
                        afterExecution: logs[1].events[0].value,
                        gasUsed: result.gasUsed,
                        cumulativeGasUsed: result.cumulativeGasUsed,
                        gasEstimated: maxPossibleGas,
                        gas
                    },
                    results
                );
            });
        });
    });

    describe('Dummy2', async function () {
        const results: Array<Result> = [];

        after(function () {
            console.table(results);
        });

        it('callExternal', async function () {
            const transaction = 'callExternal';
            const encodedFunction = dummy2.contract.methods
                .callExternal(dummy2.address, encodedFunctionDummy1)
                .encodeABI();
            const gas = await estimateInternallCall(
                gaslessAccount.address,
                dummy2.address,
                gasPrice,
                encodedFunction
            );
            const tokenGas = await estimateTokenGas(
                forwarder.address,
                gasPrice
            );

            relayRequest = {
                request: {
                    data: encodedFunction,
                    from: gaslessAccount.address,
                    gas: gas.toString(),
                    nonce,
                    relayHub: relayHub.address,
                    to: dummy2.address,
                    tokenAmount: ether('1').toString(),
                    tokenContract: token.address,
                    tokenGas: tokenGas.toString(),
                    value: '0'
                },
                relayData: {
                    callForwarder: forwarder.address,
                    callVerifier: relayVerifier.address,
                    feesReceiver: relayServer.workerAddress,
                    gasPrice
                }
            };
            const dataToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                relayRequest
            );
            const signature = getLocalEip712Signature(
                dataToSign,
                gaslessAccount.privateKey
            );

            const transactionCount =
                await contractInteractor.getTransactionCount(
                    relayServer.managerAddress
                );
            const relayMaxNonce = transactionCount + 3;

            const metadata: RelayMetadata = {
                relayHubAddress: relayHub.address,
                relayMaxNonce,
                signature
            };

            const request: RelayTransactionRequest = {
                relayRequest,
                metadata
            };

            console.log(transaction);
            const { transactionHash, maxPossibleGas } =
                await relayServer.createRelayTransaction(request);

            const result = await web3.eth.getTransactionReceipt(
                transactionHash
            );

            const logs = abiDecoder.decodeLogs(result.logs);
            pushToResults(
                {
                    transaction,
                    beforeExecution: logs[0].events[0].value,
                    afterExecution: logs[1].events[0].value,
                    gasUsed: result.gasUsed,
                    cumulativeGasUsed: result.cumulativeGasUsed,
                    gasEstimated: maxPossibleGas,
                    gas
                },
                results
            );
        });

        it('callExternalPush', async function () {
            const transaction = 'callExternalPush';
            const encodedFunction = dummy2.contract.methods
                .callExternal(dummy2.address, encodedFunctionDummy1, 20)
                .encodeABI();
            const gas = await estimateInternallCall(
                gaslessAccount.address,
                dummy2.address,
                gasPrice,
                encodedFunction
            );
            const tokenGas = await estimateTokenGas(
                forwarder.address,
                gasPrice
            );

            relayRequest = {
                request: {
                    data: encodedFunction,
                    from: gaslessAccount.address,
                    gas: gas.toString(),
                    nonce,
                    relayHub: relayHub.address,
                    to: dummy2.address,
                    tokenAmount: ether('1').toString(),
                    tokenContract: token.address,
                    tokenGas: tokenGas.toString(),
                    value: '0'
                },
                relayData: {
                    callForwarder: forwarder.address,
                    callVerifier: relayVerifier.address,
                    feesReceiver: relayServer.workerAddress,
                    gasPrice
                }
            };
            const dataToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                relayRequest
            );
            const signature = getLocalEip712Signature(
                dataToSign,
                gaslessAccount.privateKey
            );

            const transactionCount =
                await contractInteractor.getTransactionCount(
                    relayServer.managerAddress
                );
            const relayMaxNonce = transactionCount + 3;

            const metadata: RelayMetadata = {
                relayHubAddress: relayHub.address,
                relayMaxNonce,
                signature
            };

            const request: RelayTransactionRequest = {
                relayRequest,
                metadata
            };

            console.log(transaction);
            const { transactionHash, maxPossibleGas } =
                await relayServer.createRelayTransaction(request);

            const result = await web3.eth.getTransactionReceipt(
                transactionHash
            );

            const logs = abiDecoder.decodeLogs(result.logs);
            pushToResults(
                {
                    transaction,
                    beforeExecution: logs[0].events[0].value,
                    afterExecution: logs[1].events[0].value,
                    gasUsed: result.gasUsed,
                    cumulativeGasUsed: result.cumulativeGasUsed,
                    gasEstimated: maxPossibleGas,
                    gas
                },
                results
            );
        });

        it('callExternalRefund', async function () {
            const transaction = 'callExternalRefund';
            const encodedFunction = dummy2.contract.methods
                .callExternalRefund(dummy2.address, encodedFunctionDummy1, 20)
                .encodeABI();
            const gas = await estimateInternallCall(
                gaslessAccount.address,
                dummy2.address,
                gasPrice,
                encodedFunction
            );
            const tokenGas = await estimateTokenGas(
                forwarder.address,
                gasPrice
            );

            relayRequest = {
                request: {
                    data: encodedFunction,
                    from: gaslessAccount.address,
                    gas: gas.toString(),
                    nonce,
                    relayHub: relayHub.address,
                    to: dummy2.address,
                    tokenAmount: ether('1').toString(),
                    tokenContract: token.address,
                    tokenGas: tokenGas.toString(),
                    value: '0'
                },
                relayData: {
                    callForwarder: forwarder.address,
                    callVerifier: relayVerifier.address,
                    feesReceiver: relayServer.workerAddress,
                    gasPrice
                }
            };
            const dataToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                relayRequest
            );
            const signature = getLocalEip712Signature(
                dataToSign,
                gaslessAccount.privateKey
            );

            const transactionCount =
                await contractInteractor.getTransactionCount(
                    relayServer.managerAddress
                );
            const relayMaxNonce = transactionCount + 3;

            const metadata: RelayMetadata = {
                relayHubAddress: relayHub.address,
                relayMaxNonce,
                signature
            };

            const request: RelayTransactionRequest = {
                relayRequest,
                metadata
            };

            console.log(transaction);
            const { transactionHash, maxPossibleGas } =
                await relayServer.createRelayTransaction(request);

            const result = await web3.eth.getTransactionReceipt(
                transactionHash
            );

            const logs = abiDecoder.decodeLogs(result.logs);
            pushToResults(
                {
                    transaction,
                    beforeExecution: logs[0].events[0].value,
                    afterExecution: logs[1].events[0].value,
                    gasUsed: result.gasUsed,
                    cumulativeGasUsed: result.cumulativeGasUsed,
                    gasEstimated: maxPossibleGas,
                    gas
                },
                results
            );
        });
    });

    describe('Dummy', async function () {
        const results: Array<Result> = [];

        after(function () {
            console.table(results);
        });

        it('stress(20)', async function () {
            const transaction = 'stress(20)';
            const encodedFunction = encodedFunctionDummy1;
            const gas = await estimateInternallCall(
                gaslessAccount.address,
                dummy.address,
                gasPrice,
                encodedFunction
            );
            const tokenGas = await estimateTokenGas(
                forwarder.address,
                gasPrice
            );

            relayRequest = {
                request: {
                    data: encodedFunction,
                    from: gaslessAccount.address,
                    gas: gas.toString(),
                    nonce,
                    relayHub: relayHub.address,
                    to: dummy.address,
                    tokenAmount: ether('1').toString(),
                    tokenContract: token.address,
                    tokenGas: tokenGas.toString(),
                    value: '0'
                },
                relayData: {
                    callForwarder: forwarder.address,
                    callVerifier: relayVerifier.address,
                    feesReceiver: relayServer.workerAddress,
                    gasPrice
                }
            };
            const dataToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                relayRequest
            );
            const signature = getLocalEip712Signature(
                dataToSign,
                gaslessAccount.privateKey
            );

            const transactionCount =
                await contractInteractor.getTransactionCount(
                    relayServer.managerAddress
                );
            const relayMaxNonce = transactionCount + 3;

            const metadata: RelayMetadata = {
                relayHubAddress: relayHub.address,
                relayMaxNonce,
                signature
            };

            const request: RelayTransactionRequest = {
                relayRequest,
                metadata
            };

            console.log(transaction);
            const { transactionHash, maxPossibleGas } =
                await relayServer.createRelayTransaction(request);

            const result = await web3.eth.getTransactionReceipt(
                transactionHash
            );

            const logs = abiDecoder.decodeLogs(result.logs);
            pushToResults(
                {
                    transaction,
                    beforeExecution: logs[0].events[0].value,
                    afterExecution: logs[1].events[0].value,
                    gasUsed: result.gasUsed,
                    cumulativeGasUsed: result.cumulativeGasUsed,
                    gasEstimated: maxPossibleGas,
                    gas
                },
                results
            );
        });
    });
});

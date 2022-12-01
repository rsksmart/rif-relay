import { AccountKeypair } from '@rsksmart/rif-relay-client';
import {
    constants,
    Environment,
    getLocalEip712Signature
} from '@rsksmart/rif-relay-common';
import { RelayRequest, TypedRequestData } from '@rsksmart/rif-relay-contracts';
import {
    IForwarderInstance,
    PenalizerInstance,
    RelayHubInstance,
    SmartWalletFactoryInstance,
    SmartWalletInstance,
    DummyInstance,
    TestTokenInstance,
    Dummy2Instance,
    Dummy3Instance,
    RelayVerifierInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    createSmartWallet,
    createSmartWalletFactory,
    deployHub,
    getGaslessAccount,
    getTestingEnvironment
} from './TestUtils';
import { ether } from '@openzeppelin/test-helpers';
// @ts-ignore
import abiDecoder from 'abi-decoder';
import { TransactionReceipt } from 'web3-core';

const Penalizer = artifacts.require('Penalizer');
const Dummy = artifacts.require('Dummy');
const Dummy2 = artifacts.require('Dummy2');
const Dummy3 = artifacts.require('Dummy3');
const SmartWallet = artifacts.require('SmartWallet');
const TestToken = artifacts.require('TestToken');
const RelayVerifier = artifacts.require('RelayVerifier');

// @ts-ignore
abiDecoder.addABI(SmartWallet.abi);

type Result = {
    transaction: string;
    beforeExecution: string;
    afterExecution: string;
    gasUsed: number;
    gas: number;
    gasEstimated: string;
    cumulativeGasUsed: number;
};

contract('Dummy', function ([_, relayOwner, relayManager, relayWorker]) {
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
        await token.mint(ether('10'), forwarder.address);
        await relayHub.stakeForAddress(relayManager, 1000, {
            value: ether('2'),
            from: relayOwner
        });

        await relayHub.addRelayWorkers([relayWorker], {
            from: relayManager
        });
        nonce = (await forwarder.nonce()).toString();
        gasPrice = '60000000';
    });

    const estimateTokenGas = async (from: string, gasPrice: string) => {
        const estimation = await token.contract.methods
            .transfer(relayWorker, ether('1'))
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
            let encodedFunctionDummy2;
            const description = 'callExternal(dummy2)';
            beforeEach(function () {
                encodedFunctionDummy2 = dummy2.contract.methods
                    .callExternal(dummy.address, encodedFunctionDummy1)
                    .encodeABI();
            });

            it('callExternal', async function () {
                const transaction = `callExternal-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternalPush-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2, 20)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternalRefund-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternalRefund(
                        dummy2.address,
                        encodedFunctionDummy2,
                        20
                    )
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternal-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternalPush-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2, 20)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternalRefund-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternalRefund(
                        dummy2.address,
                        encodedFunctionDummy2,
                        20
                    )
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternal-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternalPush-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternal(dummy2.address, encodedFunctionDummy2, 20)
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                const transaction = `callExternalRefund-${description}`;
                const encodedFunction = dummy3.contract.methods
                    .callExternalRefund(
                        dummy2.address,
                        encodedFunctionDummy2,
                        20
                    )
                    .encodeABI();
                const gas = await estimateInternallCall(
                    forwarder.address,
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
                        feesReceiver: relayWorker,
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

                const method = relayHub.contract.methods.relayCall(
                    relayRequest,
                    signature
                );

                const maxPossibleGas = await method.estimateGas({
                    gasPrice,
                    from: relayWorker
                });

                const result = (await web3.eth.sendTransaction({
                    from: relayWorker,
                    to: relayHub.address,
                    data: method.encodeABI(),
                    value: '',
                    gasPrice,
                    gas: maxPossibleGas
                })) as TransactionReceipt;

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
                    feesReceiver: relayWorker,
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

            const method = relayHub.contract.methods.relayCall(
                relayRequest,
                signature
            );

            const maxPossibleGas = await method.estimateGas({
                gasPrice,
                from: relayWorker
            });

            const result = (await web3.eth.sendTransaction({
                from: relayWorker,
                to: relayHub.address,
                data: method.encodeABI(),
                value: '',
                gasPrice,
                gas: maxPossibleGas
            })) as TransactionReceipt;

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
                    feesReceiver: relayWorker,
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

            const method = relayHub.contract.methods.relayCall(
                relayRequest,
                signature
            );

            const maxPossibleGas = await method.estimateGas({
                gasPrice,
                from: relayWorker
            });

            const result = (await web3.eth.sendTransaction({
                from: relayWorker,
                to: relayHub.address,
                data: method.encodeABI(),
                value: '',
                gasPrice,
                gas: maxPossibleGas
            })) as TransactionReceipt;

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
                    feesReceiver: relayWorker,
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

            const method = relayHub.contract.methods.relayCall(
                relayRequest,
                signature
            );

            const maxPossibleGas = await method.estimateGas({
                gasPrice,
                from: relayWorker
            });

            const result = (await web3.eth.sendTransaction({
                from: relayWorker,
                to: relayHub.address,
                data: method.encodeABI(),
                value: '',
                gasPrice,
                gas: maxPossibleGas
            })) as TransactionReceipt;

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
                    feesReceiver: relayWorker,
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

            const method = relayHub.contract.methods.relayCall(
                relayRequest,
                signature
            );

            const maxPossibleGas = await method.estimateGas({
                gasPrice,
                from: relayWorker
            });

            const result = (await web3.eth.sendTransaction({
                from: relayWorker,
                to: relayHub.address,
                data: method.encodeABI(),
                value: '',
                gasPrice,
                gas: maxPossibleGas
            })) as TransactionReceipt;

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

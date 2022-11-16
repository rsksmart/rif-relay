import { ether } from '@openzeppelin/test-helpers';
import chai from 'chai';
import {
    Environment,
    getLocalEip712Signature,
    constants
} from '@rsksmart/rif-relay-common';
// @ts-ignore
import abiDecoder from 'abi-decoder';
import {
    IWalletFactory,
    IRelayHub,
    RelayRequest,
    cloneRelayRequest,
    TypedRequestData
} from '@rsksmart/rif-relay-contracts';
import {
    RelayHubInstance,
    PenalizerInstance,
    TestRecipientInstance,
    IForwarderInstance,
    TestVerifierEverythingAcceptedInstance,
    TestVerifierConfigurableMisbehaviorInstance,
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
import { keccak } from 'ethereumjs-util';
import { toBN, toHex } from 'web3-utils';
import { TransactionReceipt } from 'web3-core';
const { assert } = chai.use(chaiAsPromised);
const SmartWallet = artifacts.require('SmartWallet');
const Penalizer = artifacts.require('Penalizer');
const TestVerifierEverythingAccepted = artifacts.require(
    'TestVerifierEverythingAccepted'
);
const TestRecipient = artifacts.require('TestRecipient');
const TestVerifierConfigurableMisbehavior = artifacts.require(
    'TestVerifierConfigurableMisbehavior'
);

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
    const gasLimit = '3000000';
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
                    data: '',
                    from: gaslessAccount.address,
                    nonce: (await forwarderInstance.nonce()).toString(),
                    value: '0',
                    gas: gasLimit,
                    tokenContract: token.address,
                    tokenAmount: '1',
                    tokenGas: '50000'
                },
                relayData: {
                    gasPrice,
                    feesReceiver: relayWorker,
                    callForwarder: forwarder,
                    callVerifier: verifier
                }
            };
        });

        context('with staked and registered relay', function () {
            const url = 'http://relay.com';
            const message = 'Enveloping RelayHub';

            let relayRequest: RelayRequest;
            let encodedFunction: string;

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
            });

            context('with funded verifier', function () {
                let misbehavingVerifier: TestVerifierConfigurableMisbehaviorInstance;
                let relayRequestMisbehavingVerifier: RelayRequest;
                const gas = 4e6;

                beforeEach(async function () {
                    misbehavingVerifier =
                        await TestVerifierConfigurableMisbehavior.new();

                    relayRequestMisbehavingVerifier =
                        cloneRelayRequest(relayRequest);
                    relayRequestMisbehavingVerifier.relayData.callVerifier =
                        misbehavingVerifier.address;
                });

                it('gas prediction tests - with token payment', async function () {
                    const SmartWallet = artifacts.require('SmartWallet');
                    const smartWalletTemplate: SmartWalletInstance =
                        await SmartWallet.new();
                    const smartWalletFactory: SmartWalletFactoryInstance =
                        await createSmartWalletFactory(smartWalletTemplate);
                    const sWalletInstance = await createSmartWallet(
                        _,
                        gaslessAccount.address,
                        smartWalletFactory,
                        gaslessAccount.privateKey,
                        chainId
                    );

                    const nonceBefore = await sWalletInstance.nonce();
                    await token.mint('10000', sWalletInstance.address);
                    let swalletInitialBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    let relayWorkerInitialBalance = await token.balanceOf(
                        relayWorker
                    );
                    let message =
                        'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING ';
                    message = message.concat(message);

                    let balanceToTransfer = toHex(
                        swalletInitialBalance.toNumber()
                    );
                    const completeReq: RelayRequest = cloneRelayRequest(
                        sharedRelayRequestData
                    );
                    completeReq.request.data =
                        recipientContract.contract.methods
                            .emitMessage(message)
                            .encodeABI();
                    completeReq.request.nonce = nonceBefore.toString();
                    completeReq.relayData.callForwarder =
                        sWalletInstance.address;
                    completeReq.request.tokenAmount = balanceToTransfer;
                    completeReq.request.tokenContract = token.address;

                    let estimatedDestinationCallGas =
                        await web3.eth.estimateGas({
                            from: completeReq.relayData.callForwarder,
                            to: completeReq.request.to,
                            gasPrice: completeReq.relayData.gasPrice,
                            data: completeReq.request.data
                        });

                    let internalDestinationCallCost =
                        estimatedDestinationCallGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedDestinationCallGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedDestinationCallGas;
                    internalDestinationCallCost =
                        internalDestinationCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                    let estimatedTokenPaymentGas = await web3.eth.estimateGas({
                        from: completeReq.relayData.callForwarder,
                        to: token.address,
                        data: token.contract.methods
                            .transfer(relayWorker, balanceToTransfer)
                            .encodeABI()
                    });

                    let internalTokenCallCost =
                        estimatedTokenPaymentGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedTokenPaymentGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedTokenPaymentGas;
                    internalTokenCallCost =
                        internalTokenCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                    completeReq.request.gas = toHex(
                        internalDestinationCallCost
                    );
                    completeReq.request.tokenGas = toHex(internalTokenCallCost);

                    let reqToSign = new TypedRequestData(
                        chainId,
                        sWalletInstance.address,
                        completeReq
                    );

                    let sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );

                    let detailedEstimation = await web3.eth.estimateGas({
                        from: relayWorker,
                        to: relayHubInstance.address,
                        data: relayHubInstance.contract.methods
                            .relayCall(completeReq, sig)
                            .encodeABI(),
                        gasPrice,
                        gas: 6800000
                    });

                    // gas estimation fit
                    // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
                    // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
                    const a0 = Number('35095.980');
                    const a1 = Number('1.098');
                    const estimatedCost =
                        a1 *
                            (internalDestinationCallCost +
                                internalTokenCallCost) +
                        a0;

                    console.log(
                        'The destination contract call estimate is: ',
                        internalDestinationCallCost
                    );
                    console.log(
                        'The token gas estimate is: ',
                        internalTokenCallCost
                    );
                    console.log(
                        'X = ',
                        internalDestinationCallCost + internalTokenCallCost
                    );
                    console.log('The predicted total cost is: ', estimatedCost);
                    console.log('Detailed estimation: ', detailedEstimation);
                    const { tx } = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );

                    let sWalletFinalBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    let relayWorkerFinalBalance = await token.balanceOf(
                        relayWorker
                    );

                    assert.isTrue(
                        swalletInitialBalance.eq(
                            sWalletFinalBalance.add(toBN(balanceToTransfer))
                        ),
                        'SW Payment did not occur'
                    );
                    assert.isTrue(
                        relayWorkerFinalBalance.eq(
                            relayWorkerInitialBalance.add(
                                toBN(balanceToTransfer)
                            )
                        ),
                        'Worker did not receive payment'
                    );

                    let nonceAfter = await sWalletInstance.nonce();
                    assert.equal(
                        nonceBefore.addn(1).toNumber(),
                        nonceAfter.toNumber(),
                        'Incorrect nonce after execution'
                    );

                    let txReceipt = await web3.eth.getTransactionReceipt(tx);

                    console.log(
                        `Cumulative Gas Used: ${txReceipt.cumulativeGasUsed}`
                    );

                    let logs = abiDecoder.decodeLogs(txReceipt.logs);
                    let sampleRecipientEmittedEvent = logs.find(
                        (e: any) =>
                            e != null && e.name === 'SampleRecipientEmitted'
                    );

                    assert.equal(
                        message,
                        sampleRecipientEmittedEvent.events[0].value
                    );
                    assert.equal(
                        sWalletInstance.address.toLowerCase(),
                        sampleRecipientEmittedEvent.events[1].value.toLowerCase()
                    );
                    assert.equal(
                        relayWorker.toLowerCase(),
                        sampleRecipientEmittedEvent.events[2].value.toLowerCase()
                    );

                    let transactionRelayedEvent = logs.find(
                        (e: any) => e != null && e.name === 'TransactionRelayed'
                    );
                    assert.isTrue(
                        transactionRelayedEvent !== undefined &&
                            transactionRelayedEvent !== null,
                        'TransactionRelayedEvent not found'
                    );

                    // SECOND CALL
                    await token.mint('100', sWalletInstance.address);

                    swalletInitialBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    balanceToTransfer = toHex(swalletInitialBalance.toNumber());
                    relayWorkerInitialBalance = await token.balanceOf(
                        relayWorker
                    );

                    completeReq.request.tokenAmount = toHex(
                        swalletInitialBalance
                    );
                    estimatedDestinationCallGas = await web3.eth.estimateGas({
                        from: completeReq.relayData.callForwarder,
                        to: completeReq.request.to,
                        gasPrice: completeReq.relayData.gasPrice,
                        data: completeReq.request.data
                    });

                    internalDestinationCallCost =
                        estimatedDestinationCallGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedDestinationCallGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedDestinationCallGas;
                    internalDestinationCallCost =
                        internalDestinationCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                    estimatedTokenPaymentGas = await web3.eth.estimateGas({
                        from: completeReq.relayData.callForwarder,
                        to: token.address,
                        data: token.contract.methods
                            .transfer(relayWorker, balanceToTransfer)
                            .encodeABI()
                    });

                    internalTokenCallCost =
                        estimatedTokenPaymentGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedTokenPaymentGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedTokenPaymentGas;
                    internalTokenCallCost =
                        internalTokenCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                    completeReq.request.gas = toHex(
                        internalDestinationCallCost
                    );
                    completeReq.request.tokenGas = toHex(internalTokenCallCost);

                    completeReq.request.nonce = nonceBefore
                        .add(toBN(1))
                        .toString();
                    reqToSign = new TypedRequestData(
                        chainId,
                        sWalletInstance.address,
                        completeReq
                    );

                    sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );

                    detailedEstimation = await web3.eth.estimateGas({
                        from: relayWorker,
                        to: relayHubInstance.address,
                        data: relayHubInstance.contract.methods
                            .relayCall(completeReq, sig)
                            .encodeABI(),
                        gasPrice
                    });

                    const result = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );

                    console.log('ROUND 2');
                    console.log(
                        'The destination contract call estimate is: ',
                        internalDestinationCallCost
                    );
                    console.log(
                        'The token gas estimate is: ',
                        internalTokenCallCost
                    );
                    console.log(
                        'X = ',
                        internalDestinationCallCost + internalTokenCallCost
                    );
                    console.log('Detailed estimation: ', detailedEstimation);

                    sWalletFinalBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    relayWorkerFinalBalance = await token.balanceOf(
                        relayWorker
                    );

                    assert.isTrue(
                        swalletInitialBalance.eq(
                            sWalletFinalBalance.add(toBN(balanceToTransfer))
                        ),
                        'SW Payment did not occur'
                    );
                    assert.isTrue(
                        relayWorkerFinalBalance.eq(
                            relayWorkerInitialBalance.add(
                                toBN(balanceToTransfer)
                            )
                        ),
                        'Worker did not receive payment'
                    );

                    nonceAfter = await sWalletInstance.nonce();
                    assert.equal(
                        nonceBefore.addn(2).toNumber(),
                        nonceAfter.toNumber(),
                        'Incorrect nonce after execution'
                    );

                    txReceipt = await web3.eth.getTransactionReceipt(result.tx);

                    console.log(
                        `Cumulative Gas Used in second run: ${txReceipt.cumulativeGasUsed}`
                    );

                    logs = abiDecoder.decodeLogs(txReceipt.logs);
                    sampleRecipientEmittedEvent = logs.find(
                        (e: any) =>
                            e != null && e.name === 'SampleRecipientEmitted'
                    );

                    assert.equal(
                        message,
                        sampleRecipientEmittedEvent.events[0].value
                    );
                    assert.equal(
                        sWalletInstance.address.toLowerCase(),
                        sampleRecipientEmittedEvent.events[1].value.toLowerCase()
                    );
                    assert.equal(
                        relayWorker.toLowerCase(),
                        sampleRecipientEmittedEvent.events[2].value.toLowerCase()
                    );

                    transactionRelayedEvent = logs.find(
                        (e: any) => e != null && e.name === 'TransactionRelayed'
                    );
                    assert.isTrue(
                        transactionRelayedEvent !== undefined &&
                            transactionRelayedEvent !== null,
                        'TransactionRelayedEvent not found'
                    );
                });

                it('gas prediction tests - without token payment', async function () {
                    const SmartWallet = artifacts.require('SmartWallet');
                    const smartWalletTemplate: SmartWalletInstance =
                        await SmartWallet.new();
                    const smartWalletFactory: SmartWalletFactoryInstance =
                        await createSmartWalletFactory(smartWalletTemplate);
                    const sWalletInstance = await createSmartWallet(
                        _,
                        gaslessAccount.address,
                        smartWalletFactory,
                        gaslessAccount.privateKey,
                        chainId
                    );

                    const nonceBefore = await sWalletInstance.nonce();
                    let swalletInitialBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    let relayWorkerInitialBalance = await token.balanceOf(
                        relayWorker
                    );
                    let message =
                        'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING ';
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);

                    const completeReq: RelayRequest = cloneRelayRequest(
                        sharedRelayRequestData
                    );
                    completeReq.request.data =
                        recipientContract.contract.methods
                            .emitMessage(message)
                            .encodeABI();
                    completeReq.request.nonce = nonceBefore.toString();
                    completeReq.relayData.callForwarder =
                        sWalletInstance.address;
                    completeReq.request.tokenAmount = '0x00';
                    completeReq.request.tokenContract = constants.ZERO_ADDRESS;
                    completeReq.request.tokenGas = '0x00';

                    let estimatedDestinationCallGas =
                        await web3.eth.estimateGas({
                            from: completeReq.relayData.callForwarder,
                            to: completeReq.request.to,
                            gasPrice: completeReq.relayData.gasPrice,
                            data: completeReq.request.data
                        });

                    let internalDestinationCallCost =
                        estimatedDestinationCallGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedDestinationCallGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedDestinationCallGas;
                    internalDestinationCallCost =
                        internalDestinationCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                    completeReq.request.gas = toHex(
                        internalDestinationCallCost
                    );

                    let reqToSign = new TypedRequestData(
                        chainId,
                        sWalletInstance.address,
                        completeReq
                    );

                    let sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );

                    let detailedEstimation = await web3.eth.estimateGas({
                        from: relayWorker,
                        to: relayHubInstance.address,
                        data: relayHubInstance.contract.methods
                            .relayCall(completeReq, sig)
                            .encodeABI(),
                        gasPrice,
                        gas: 6800000
                    });

                    // gas estimation fit
                    // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
                    // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
                    const a0 = Number('35095.980');
                    const a1 = Number('1.098');
                    const estimatedCost = a1 * internalDestinationCallCost + a0;

                    console.log(
                        'The destination contract call estimate is: ',
                        internalDestinationCallCost
                    );
                    console.log('X = ', internalDestinationCallCost);
                    console.log('The predicted total cost is: ', estimatedCost);
                    console.log('Detailed estimation: ', detailedEstimation);
                    const { tx } = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );

                    let sWalletFinalBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    let relayWorkerFinalBalance = await token.balanceOf(
                        relayWorker
                    );

                    assert.isTrue(
                        swalletInitialBalance.eq(sWalletFinalBalance),
                        'SW Payment did occur'
                    );
                    assert.isTrue(
                        relayWorkerFinalBalance.eq(relayWorkerInitialBalance),
                        'Worker did receive payment'
                    );

                    let nonceAfter = await sWalletInstance.nonce();
                    assert.equal(
                        nonceBefore.addn(1).toNumber(),
                        nonceAfter.toNumber(),
                        'Incorrect nonce after execution'
                    );

                    let txReceipt = await web3.eth.getTransactionReceipt(tx);

                    console.log(
                        `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`
                    );

                    let logs = abiDecoder.decodeLogs(txReceipt.logs);
                    let sampleRecipientEmittedEvent = logs.find(
                        (e: any) =>
                            e != null && e.name === 'SampleRecipientEmitted'
                    );

                    assert.equal(
                        message,
                        sampleRecipientEmittedEvent.events[0].value
                    );
                    assert.equal(
                        sWalletInstance.address.toLowerCase(),
                        sampleRecipientEmittedEvent.events[1].value.toLowerCase()
                    );
                    assert.equal(
                        relayWorker.toLowerCase(),
                        sampleRecipientEmittedEvent.events[2].value.toLowerCase()
                    );

                    let transactionRelayedEvent = logs.find(
                        (e: any) => e != null && e.name === 'TransactionRelayed'
                    );
                    assert.isTrue(
                        transactionRelayedEvent !== undefined &&
                            transactionRelayedEvent !== null,
                        'TransactionRelayedEvent not found'
                    );

                    // SECOND CALL

                    swalletInitialBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    relayWorkerInitialBalance = await token.balanceOf(
                        relayWorker
                    );

                    estimatedDestinationCallGas = await web3.eth.estimateGas({
                        from: completeReq.relayData.callForwarder,
                        to: completeReq.request.to,
                        gasPrice: completeReq.relayData.gasPrice,
                        data: completeReq.request.data
                    });

                    internalDestinationCallCost =
                        estimatedDestinationCallGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedDestinationCallGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedDestinationCallGas;
                    internalDestinationCallCost =
                        internalDestinationCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                    completeReq.request.gas = toHex(
                        internalDestinationCallCost
                    );

                    completeReq.request.nonce = nonceBefore
                        .add(toBN(1))
                        .toString();
                    reqToSign = new TypedRequestData(
                        chainId,
                        sWalletInstance.address,
                        completeReq
                    );

                    sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );

                    detailedEstimation = await web3.eth.estimateGas({
                        from: relayWorker,
                        to: relayHubInstance.address,
                        data: relayHubInstance.contract.methods
                            .relayCall(completeReq, sig)
                            .encodeABI(),
                        gasPrice
                    });

                    const result = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );

                    console.log('ROUND 2');
                    console.log(
                        'The destination contract call estimate is: ',
                        internalDestinationCallCost
                    );
                    console.log('X = ', internalDestinationCallCost);
                    console.log('Detailed estimation: ', detailedEstimation);

                    sWalletFinalBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    relayWorkerFinalBalance = await token.balanceOf(
                        relayWorker
                    );

                    assert.isTrue(
                        swalletInitialBalance.eq(sWalletFinalBalance),
                        'SW Payment did occur'
                    );
                    assert.isTrue(
                        relayWorkerFinalBalance.eq(relayWorkerInitialBalance),
                        'Worker did receive payment'
                    );

                    nonceAfter = await sWalletInstance.nonce();
                    assert.equal(
                        nonceBefore.addn(2).toNumber(),
                        nonceAfter.toNumber(),
                        'Incorrect nonce after execution'
                    );

                    txReceipt = await web3.eth.getTransactionReceipt(result.tx);

                    console.log(
                        `Cummulative Gas Used in second run: ${txReceipt.cumulativeGasUsed}`
                    );

                    logs = abiDecoder.decodeLogs(txReceipt.logs);
                    sampleRecipientEmittedEvent = logs.find(
                        (e: any) =>
                            e != null && e.name === 'SampleRecipientEmitted'
                    );

                    assert.equal(
                        message,
                        sampleRecipientEmittedEvent.events[0].value
                    );
                    assert.equal(
                        sWalletInstance.address.toLowerCase(),
                        sampleRecipientEmittedEvent.events[1].value.toLowerCase()
                    );
                    assert.equal(
                        relayWorker.toLowerCase(),
                        sampleRecipientEmittedEvent.events[2].value.toLowerCase()
                    );

                    transactionRelayedEvent = logs.find(
                        (e: any) => e != null && e.name === 'TransactionRelayed'
                    );
                    assert.isTrue(
                        transactionRelayedEvent !== undefined &&
                            transactionRelayedEvent !== null,
                        'TransactionRelayedEvent not found'
                    );
                });

                it('gas estimation tests for SmartWallet', async function () {
                    const SmartWallet = artifacts.require('SmartWallet');
                    const smartWalletTemplate: SmartWalletInstance =
                        await SmartWallet.new();
                    const smartWalletFactory: SmartWalletFactoryInstance =
                        await createSmartWalletFactory(smartWalletTemplate);
                    const sWalletInstance = await createSmartWallet(
                        _,
                        gaslessAccount.address,
                        smartWalletFactory,
                        gaslessAccount.privateKey,
                        chainId
                    );

                    const nonceBefore = await sWalletInstance.nonce();
                    await token.mint('10000', sWalletInstance.address);

                    let message =
                        'RIF Enveloping RIF Enveloping RIF Enveloping RIF Enveloping';
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    message = message.concat(message);
                    const completeReq: RelayRequest = cloneRelayRequest(
                        sharedRelayRequestData
                    );
                    completeReq.request.data =
                        recipientContract.contract.methods
                            .emitMessage(message)
                            .encodeABI();
                    completeReq.request.nonce = nonceBefore.toString();
                    completeReq.relayData.callForwarder =
                        sWalletInstance.address;
                    completeReq.request.tokenAmount = '0x00';
                    completeReq.request.tokenGas = '0';

                    const reqToSign = new TypedRequestData(
                        chainId,
                        sWalletInstance.address,
                        completeReq
                    );

                    const sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );

                    const estimatedDestinationCallCost =
                        await web3.eth.estimateGas({
                            from: completeReq.relayData.callForwarder,
                            to: completeReq.request.to,
                            gasPrice: completeReq.relayData.gasPrice,
                            data: completeReq.request.data
                        });

                    // tokenAmount is set to 0
                    const tokenPaymentEstimation = 0;
                    /* const tokenPaymentEstimation = await web3.eth.estimateGas({
                            from: completeReq.relayData.callForwarder,
                            to: token.address,
                            data: token.contract.methods.transfer(relayWorker, '1').encodeABI()
                        }); */

                    // gas estimation fit
                    // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
                    // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
                    const a0 = Number('37796.074');
                    const a1 = Number('1.086');
                    const estimatedCost =
                        a1 *
                            (estimatedDestinationCallCost +
                                tokenPaymentEstimation) +
                        a0;

                    console.log(
                        'The destination contract call estimate is: ',
                        estimatedDestinationCallCost
                    );
                    console.log(
                        'The token gas estimate is: ',
                        tokenPaymentEstimation
                    );
                    console.log(
                        'X = ',
                        estimatedDestinationCallCost + tokenPaymentEstimation
                    );

                    console.log('The predicted total cost is: ', estimatedCost);
                    const { tx } = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );

                    const nonceAfter = await sWalletInstance.nonce();
                    assert.equal(
                        nonceBefore.addn(1).toNumber(),
                        nonceAfter.toNumber(),
                        'Incorrect nonce after execution'
                    );

                    const eventHash = keccak('GasUsed(uint256,uint256)');
                    const txReceipt = await web3.eth.getTransactionReceipt(tx);

                    // const costForCalling = 0;
                    // const overheadCost = txReceipt.cumulativeGasUsed - costForCalling - estimatedDestinationCallCost;
                    // console.log('data overhead: ', overheadCost);

                    // console.log('---------------SmartWallet: RelayCall metrics------------------------')
                    console.log(
                        `Cumulative Gas Used: ${txReceipt.cumulativeGasUsed}`
                    );
                    console.log(`Gas Used: ${txReceipt.gasUsed}`);

                    let previousGas: BigInt = BigInt(0);
                    let previousStep: string | null = null;
                    for (let i = 0; i < txReceipt.logs.length; i++) {
                        const log = txReceipt.logs[i];
                        if (
                            '0x' + eventHash.toString('hex') ===
                            log.topics[0]
                        ) {
                            const step = log.data.substring(0, 66);
                            const gasUsed: BigInt = BigInt(
                                '0x' + log.data.substring(67, log.data.length)
                            );
                            console.log(
                                '---------------------------------------'
                            );
                            console.log('step :', BigInt(step).toString());
                            console.log('gasLeft :', gasUsed.toString());

                            if (previousStep != null) {
                                console.log(
                                    `Steps substraction ${BigInt(
                                        step
                                    ).toString()} and ${BigInt(
                                        previousStep
                                    ).toString()}`
                                );
                                console.log(
                                    (
                                        previousGas.valueOf() -
                                        gasUsed.valueOf()
                                    ).toString()
                                );
                            }
                            console.log(
                                '---------------------------------------'
                            );

                            // TODO: we should check this
                            // @ts-ignore
                            previousGas = BigInt(gasUsed);
                            previousStep = step;
                        }
                    }

                    const logs = abiDecoder.decodeLogs(txReceipt.logs);
                    const sampleRecipientEmittedEvent = logs.find(
                        (e: any) =>
                            e != null && e.name === 'SampleRecipientEmitted'
                    );

                    assert.equal(
                        message,
                        sampleRecipientEmittedEvent.events[0].value
                    );
                    assert.equal(
                        sWalletInstance.address.toLowerCase(),
                        sampleRecipientEmittedEvent.events[1].value.toLowerCase()
                    );
                    assert.equal(
                        relayWorker.toLowerCase(),
                        sampleRecipientEmittedEvent.events[2].value.toLowerCase()
                    );

                    const transactionRelayedEvent = logs.find(
                        (e: any) => e != null && e.name === 'TransactionRelayed'
                    );

                    assert.isNotNull(transactionRelayedEvent);

                    const callWithoutRelay =
                        await recipientContract.emitMessage(message);
                    const cumulativeGasUsedWithoutRelay: number =
                        callWithoutRelay.receipt.cumulativeGasUsed;
                    const gasOverhead =
                        txReceipt.cumulativeGasUsed -
                        cumulativeGasUsedWithoutRelay;
                    console.log(
                        '--------------- Destination Call Without enveloping------------------------'
                    );
                    console.log(
                        `Gas Used: ${callWithoutRelay.receipt.gasUsed}, Cummulative Gas Used: ${cumulativeGasUsedWithoutRelay}`
                    );
                    console.log('---------------------------------------');
                    console.log(
                        '--------------- Destination Call with enveloping------------------------'
                    );
                    console.log(
                        `Gas Used: ${txReceipt.gasUsed}, CumulativeGasUsed: ${txReceipt.cumulativeGasUsed}`
                    );
                    console.log('---------------------------------------');
                    console.log(
                        `--------------- Enveloping Overhead (message length: ${message.length}) ------------------------`
                    );
                    console.log(`Overhead Gas: ${gasOverhead}`);
                    console.log('---------------------------------------');

                    console.log('Round 2');

                    completeReq.request.nonce = nonceAfter.toString();
                    const reqToSign2 = new TypedRequestData(
                        chainId,
                        sWalletInstance.address,
                        completeReq
                    );

                    const sig2 = getLocalEip712Signature(
                        reqToSign2,
                        gaslessAccount.privateKey
                    );
                    const { tx: tx2 } = await relayHubInstance.relayCall(
                        completeReq,
                        sig2,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );
                    const txReceipt2 = await web3.eth.getTransactionReceipt(
                        tx2
                    );
                    console.log(
                        '--------------- Destination Call with enveloping------------------------'
                    );
                    console.log(
                        `Gas Used: ${txReceipt2.gasUsed}, CumulativeGasUsed: ${txReceipt2.cumulativeGasUsed}`
                    );
                });

                it('gas estimation tests', async function () {
                    const nonceBefore = await forwarderInstance.nonce();
                    const TestToken = artifacts.require('TestToken');
                    const tokenInstance = await TestToken.new();
                    await tokenInstance.mint('1000000', forwarder);

                    const completeReq = {
                        request: {
                            ...relayRequest.request,
                            data: recipientContract.contract.methods
                                .emitMessage(message)
                                .encodeABI(),
                            nonce: nonceBefore.toString(),
                            tokenContract: tokenInstance.address,
                            tokenAmount: '0',
                            tokenGas: '0'
                        },
                        relayData: {
                            ...relayRequest.relayData
                        }
                    };

                    const reqToSign = new TypedRequestData(
                        chainId,
                        forwarder,
                        completeReq
                    );

                    const sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );

                    const { tx } = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );

                    const nonceAfter = await forwarderInstance.nonce();
                    assert.equal(
                        nonceBefore.addn(1).toNumber(),
                        nonceAfter.toNumber()
                    );

                    const eventHash = keccak('GasUsed(uint256,uint256)');
                    const txReceipt = await web3.eth.getTransactionReceipt(tx);
                    console.log('---------------------------------------');

                    console.log(`Gas Used: ${txReceipt.gasUsed}`);
                    console.log(
                        `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`
                    );

                    let previousGas: BigInt = BigInt(0);
                    let previousStep: null | string = null;
                    for (let i = 0; i < txReceipt.logs.length; i++) {
                        const log = txReceipt.logs[i];
                        if (
                            '0x' + eventHash.toString('hex') ===
                            log.topics[0]
                        ) {
                            const step = log.data.substring(0, 66);
                            const gasUsed: BigInt = BigInt(
                                '0x' + log.data.substring(67, log.data.length)
                            );
                            console.log(
                                '---------------------------------------'
                            );
                            console.log('step :', BigInt(step).toString());
                            console.log('gasLeft :', gasUsed.toString());

                            if (previousStep != null) {
                                console.log(
                                    `Steps substraction ${BigInt(
                                        step
                                    ).toString()} and ${BigInt(
                                        previousStep
                                    ).toString()}`
                                );
                                console.log(
                                    (
                                        previousGas.valueOf() -
                                        gasUsed.valueOf()
                                    ).toString()
                                );
                            }
                            console.log(
                                '---------------------------------------'
                            );
                            // TODO: we should check this
                            // @ts-ignore
                            previousGas = BigInt(gasUsed);
                            previousStep = step;
                        }
                    }

                    const logs = abiDecoder.decodeLogs(txReceipt.logs);
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
                        (e: any) => e != null && e.name === 'TransactionRelayed'
                    );

                    assert.isNotNull(transactionRelayedEvent);
                });

                async function forgeRequest(
                    transferReceiver: string,
                    balanceToTransfer: string,
                    sWalletInstance: SmartWalletInstance,
                    fees: string
                ) {
                    const completeReq: RelayRequest = cloneRelayRequest(
                        sharedRelayRequestData
                    );
                    completeReq.request.data = token.contract.methods
                        .transfer(transferReceiver, balanceToTransfer)
                        .encodeABI();
                    completeReq.request.to = token.address;
                    const nonceBefore = await sWalletInstance.nonce();
                    completeReq.request.nonce = nonceBefore.toString();
                    completeReq.relayData.callForwarder =
                        sWalletInstance.address;
                    completeReq.request.tokenAmount = fees;
                    const isSponsored = fees === '0x0';
                    completeReq.request.tokenContract = isSponsored
                        ? constants.ZERO_ADDRESS
                        : token.address;

                    const estimatedDestinationCallGas =
                        await web3.eth.estimateGas({
                            from: completeReq.relayData.callForwarder,
                            to: completeReq.request.to,
                            gasPrice: completeReq.relayData.gasPrice,
                            data: completeReq.request.data
                        });

                    let internalDestinationCallCost =
                        estimatedDestinationCallGas >
                        constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            ? estimatedDestinationCallGas -
                              constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                            : estimatedDestinationCallGas;
                    internalDestinationCallCost =
                        internalDestinationCallCost *
                        constants.ESTIMATED_GAS_CORRECTION_FACTOR;
                    completeReq.request.gas = toHex(
                        internalDestinationCallCost
                    );

                    const estimatedTokenPaymentGas = await web3.eth.estimateGas(
                        {
                            from: completeReq.relayData.callForwarder,
                            to: token.address,
                            data: token.contract.methods
                                .transfer(relayWorker, fees)
                                .encodeABI()
                        }
                    );

                    if (!isSponsored) {
                        let internalTokenCallCost =
                            estimatedTokenPaymentGas >
                            constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                                ? estimatedTokenPaymentGas -
                                  constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                                : estimatedTokenPaymentGas;
                        internalTokenCallCost =
                            internalTokenCallCost *
                            constants.ESTIMATED_GAS_CORRECTION_FACTOR;

                        completeReq.request.tokenGas = toHex(
                            internalTokenCallCost
                        );
                    }
                    return completeReq;
                }

                function signRequest(request: RelayRequest, sWalletAddress) {
                    const reqToSign = new TypedRequestData(
                        chainId,
                        sWalletAddress,
                        request
                    );

                    const sig = getLocalEip712Signature(
                        reqToSign,
                        gaslessAccount.privateKey
                    );
                    return sig;
                }

                async function createSmartWalletInstance() {
                    const SmartWallet = artifacts.require('SmartWallet');
                    const smartWalletTemplate: SmartWalletInstance =
                        await SmartWallet.new();
                    const smartWalletFactory: SmartWalletFactoryInstance =
                        await createSmartWalletFactory(smartWalletTemplate);
                    const sWalletInstance = await createSmartWallet(
                        _,
                        gaslessAccount.address,
                        smartWalletFactory,
                        gaslessAccount.privateKey,
                        chainId
                    );
                    return sWalletInstance;
                }

                function logGasOverhead(gasOverhead: number) {
                    // bg and fg colours taken from https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
                    const bgMagenta = '\x1B[45m';
                    const fgWhite = '\x1B[37m';
                    const reset = '\x1b[0m';
                    console.log(`Enveloping Overhead Gas: ${gasOverhead}`);
                    console.log(
                        bgMagenta,
                        fgWhite,
                        `Enveloping Overhead Gas: ${gasOverhead}`,
                        reset
                    );
                }

                async function printGasStatus(txReceipt: TransactionReceipt) {
                    const callWithoutRelay = await token.transfer(
                        gaslessAccount.address,
                        '1000'
                    );
                    const gasUsedWithoutRelay: number =
                        callWithoutRelay.receipt.gasUsed;
                    const gasOverhead = txReceipt.gasUsed - gasUsedWithoutRelay;
                    console.log(
                        `Destination Call Without enveloping - Gas Used: ${callWithoutRelay.receipt.gasUsed}`
                    );
                    console.log(
                        `Destination Call with enveloping - Gas Used: ${txReceipt.gasUsed}`
                    );
                    logGasOverhead(gasOverhead);
                }

                async function estimateGasOverhead(fees: string) {
                    const sWalletInstance = await createSmartWalletInstance();
                    // refill SW balance
                    await token.mint('10000', sWalletInstance.address);

                    const swalletInitialBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    const relayWorkerInitialBalance = await token.balanceOf(
                        relayWorker
                    );

                    const accounts = await web3.eth.getAccounts();
                    const firstAccount = accounts[0];
                    // necessary to execute the transfer tx without relay
                    await token.mint('10000', firstAccount);
                    const transferReceiver = accounts[1];
                    const balanceToTransfer = toHex(1000);

                    // forge the request
                    const hexFees = toHex(fees);
                    const completeReq: RelayRequest = await forgeRequest(
                        transferReceiver,
                        balanceToTransfer,
                        sWalletInstance,
                        hexFees
                    );

                    const sig = signRequest(
                        completeReq,
                        sWalletInstance.address
                    );

                    const { tx } = await relayHubInstance.relayCall(
                        completeReq,
                        sig,
                        {
                            from: relayWorker,
                            gas,
                            gasPrice
                        }
                    );
                    const txReceipt = await web3.eth.getTransactionReceipt(tx);

                    // assert the transaction has been relayed correctly
                    const sWalletFinalBalance = await token.balanceOf(
                        sWalletInstance.address
                    );
                    const relayWorkerFinalBalance = await token.balanceOf(
                        relayWorker
                    );
                    assert.isTrue(
                        swalletInitialBalance.eq(
                            sWalletFinalBalance
                                .add(toBN(hexFees))
                                .add(toBN(balanceToTransfer))
                        ),
                        'SW Payment did not occur'
                    );
                    assert.isTrue(
                        relayWorkerFinalBalance.eq(
                            relayWorkerInitialBalance.add(toBN(hexFees))
                        ),
                        'Worker did not receive payment'
                    );
                    const logs = abiDecoder.decodeLogs(txReceipt.logs);
                    const findLog = (logs: any, name: string) =>
                        logs.find((e: any) => e != null && e.name === name);
                    const transactionRelayedEvent = findLog(
                        logs,
                        'TransactionRelayed'
                    );
                    assert.isTrue(
                        transactionRelayedEvent !== undefined &&
                            transactionRelayedEvent !== null,
                        'TransactionRelayedEvent not found'
                    );
                    await printGasStatus(txReceipt);
                }

                it.only('gas estimation tests for token transfer - with token payment', async function () {
                    await estimateGasOverhead('5000');
                });

                it.only('gas estimation tests for token transfer - without token payment', async function () {
                    await estimateGasOverhead('0');
                });
            });
        });
    });
});

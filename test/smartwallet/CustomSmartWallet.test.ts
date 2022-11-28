import {
    TestForwarderTargetInstance,
    TestTokenInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';

import {
    EIP712TypedData,
    // @ts-ignore
    signTypedData_v4,
    TypedDataUtils
} from 'eth-sig-util';
import { BN, bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util';
import {
    bytes32,
    containsEvent,
    createCustomSmartWallet,
    createCustomSmartWalletFactory,
    getTestingEnvironment
} from '../TestUtils';
import { constants } from '@rsksmart/rif-relay-common';
import {
    TypedRequestData,
    ForwardRequestType,
    RelayRequest,
    ForwardRequest,
    RelayData
} from '@rsksmart/rif-relay-contracts';
import { expectRevert } from '@openzeppelin/test-helpers';

//@ts-ignore
import sourceMapSupport from 'source-map-support';
//@ts-ignore
sourceMapSupport.install({ errorFormatterForce: true });

const TestForwarderTarget = artifacts.require('TestForwarderTarget');
const TestToken = artifacts.require('TestToken');
const TestSmartWallet = artifacts.require('TestSmartWallet');
const SuccessCustomLogic = artifacts.require('SuccessCustomLogic');
const FailureCustomLogic = artifacts.require('FailureCustomLogic');
const ProxyCustomLogic = artifacts.require('ProxyCustomLogic');
const CustomSmartWallet = artifacts.require('CustomSmartWallet');

async function fillTokens(
    token: TestTokenInstance,
    recipient: string,
    amount: string
): Promise<void> {
    await token.mint(amount, recipient);
}

async function getTokenBalance(
    token: TestTokenInstance,
    account: string
): Promise<BN> {
    return await token.balanceOf(account);
}

function createRequest(
    request: Partial<ForwardRequest>,
    relayData: Partial<RelayData>
): RelayRequest {
    const baseRequest: RelayRequest = {
        request: {
            relayHub: constants.ZERO_ADDRESS,
            from: constants.ZERO_ADDRESS,
            to: constants.ZERO_ADDRESS,
            value: '0',
            gas: '1000000',
            nonce: '0',
            data: '0x',
            tokenContract: constants.ZERO_ADDRESS,
            tokenAmount: '1',
            tokenGas: '50000'
        },
        relayData: {
            gasPrice: '1',
            feesReceiver: constants.ZERO_ADDRESS,
            callForwarder: constants.ZERO_ADDRESS,
            callVerifier: constants.ZERO_ADDRESS
        }
    };
    return {
        request: {
            ...baseRequest.request,
            ...request
        },
        relayData: {
            ...baseRequest.relayData,
            ...relayData
        }
    };
}

function signRequest(
    senderPrivateKey: Buffer,
    relayRequest: RelayRequest,
    chainId: number
): { signature: string; suffixData: string } {
    const reqData: EIP712TypedData = new TypedRequestData(
        chainId,
        relayRequest.relayData.callForwarder,
        relayRequest
    );
    const signature = signTypedData_v4(senderPrivateKey, { data: reqData });
    const suffixData = bufferToHex(
        TypedDataUtils.encodeData(
            reqData.primaryType,
            reqData.message,
            reqData.types
        ).slice((1 + ForwardRequestType.length) * 32)
    );
    return { signature, suffixData };
}

contract(
    'Custom Smart Wallet using TestToken',
    ([worker, fundedAccount, otherAccount]) => {
        const countParams = ForwardRequestType.length;
        const senderPrivateKey = toBuffer(bytes32(1));
        const fundedAccountPrivateKey: Buffer = Buffer.from(
            '0c06818f82e04c564290b32ab86b25676731fc34e9a546108bf109194c8e3aae',
            'hex'
        );
        let chainId: number;
        let senderAddress: string;
        let token: TestTokenInstance;
        let relayData: Partial<RelayData>;

        before(async () => {
            senderAddress = bufferToHex(
                privateToAddress(senderPrivateKey)
            ).toLowerCase();
            token = await TestToken.new();
        });

        beforeEach(async () => {
            chainId = (await getTestingEnvironment()).chainId;
        });

        describe('#verifyAndCall', () => {
            let recipient: TestForwarderTargetInstance;
            let recipientFunction: any;

            beforeEach(async () => {
                recipient = await TestForwarderTarget.new();
                recipientFunction = recipient.contract.methods
                    .emitMessage('hello')
                    .encodeABI();
            });

            it('should call function with custom logic', async () => {
                // Init smart wallet and
                const customLogic = await SuccessCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    senderAddress,
                    factory,
                    senderPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );
                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };

                const initialWorkerTokenBalance = await getTokenBalance(
                    token,
                    worker
                );
                const initialSWalletTokenBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );
                const initialNonce = await smartWallet.nonce();

                const relayRequest = await createRequest(
                    {
                        data: recipientFunction,
                        to: recipient.address,
                        nonce: initialNonce.toString(),
                        relayHub: worker,
                        tokenContract: token.address,
                        from: senderAddress
                    },
                    relayData
                );
                const { signature, suffixData } = signRequest(
                    senderPrivateKey,
                    relayRequest,
                    chainId
                );

                const result = await smartWallet.execute(
                    suffixData,
                    relayRequest.request,
                    worker,
                    signature,
                    {
                        from: worker
                    }
                );

                // @ts-ignore
                assert(
                    containsEvent(
                        customLogic.abi,
                        result.receipt.rawLogs,
                        'LogicCalled'
                    ),
                    'Should call custom logic'
                );

                const tknBalance = await getTokenBalance(token, worker);
                const swTknBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance.sub(initialWorkerTokenBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new worker token balance'
                );
                assert.equal(
                    initialSWalletTokenBalance.sub(swTknBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new smart wallet token balance'
                );

                assert.equal(
                    (await smartWallet.nonce()).toString(),
                    initialNonce.add(new BN(1)).toString(),
                    'verifyAndCall should increment nonce'
                );
            });

            it("should call function from custom logic with wallet's address", async () => {
                // Init smart wallet and
                const customLogic = await ProxyCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    senderAddress,
                    factory,
                    senderPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );
                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };

                const initialWorkerTokenBalance = await getTokenBalance(
                    token,
                    worker
                );
                const initialSWalletTokenBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                const initialNonce = await smartWallet.nonce();

                const relayRequest = await createRequest(
                    {
                        data: recipientFunction,
                        to: recipient.address,
                        nonce: initialNonce.toString(),
                        relayHub: worker,
                        tokenContract: token.address,
                        from: senderAddress
                    },
                    relayData
                );
                const reqData: EIP712TypedData = new TypedRequestData(
                    chainId,
                    smartWallet.address,
                    relayRequest
                );
                const sig = signTypedData_v4(senderPrivateKey, {
                    data: reqData
                });
                const suffixData = bufferToHex(
                    TypedDataUtils.encodeData(
                        reqData.primaryType,
                        reqData.message,
                        reqData.types
                    ).slice((1 + countParams) * 32)
                );

                const result = await smartWallet.execute(
                    suffixData,
                    relayRequest.request,
                    worker,
                    sig,
                    { from: worker }
                );

                // @ts-ignore
                assert(
                    containsEvent(
                        customLogic.abi,
                        result.receipt.rawLogs,
                        'LogicCalled'
                    ),
                    'Should call custom logic'
                );

                // @ts-ignore
                const logs = await recipient.getPastEvents(
                    'TestForwarderMessage'
                );
                assert.equal(logs.length, 1, 'TestRecipient should emit');
                assert.equal(
                    logs[0].args.origin,
                    worker,
                    'test "from" account is the tx.origin'
                );
                assert.equal(
                    logs[0].args.msgSender,
                    smartWallet.address,
                    'msg.sender must be the smart wallet address'
                );

                const tknBalance = await getTokenBalance(token, worker);
                const swTknBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance.sub(initialWorkerTokenBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new worker token balance'
                );
                assert.equal(
                    initialSWalletTokenBalance.sub(swTknBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new smart wallet token balance'
                );

                assert.equal(
                    (await smartWallet.nonce()).toString(),
                    initialNonce.add(new BN(1)).toString(),
                    'verifyAndCall should increment nonce'
                );
            });

            it('should revert if logic revert', async () => {
                const customLogic = await FailureCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    senderAddress,
                    factory,
                    senderPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );
                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };

                const caller = await TestSmartWallet.new();

                const initialWorkerTokenBalance = await getTokenBalance(
                    token,
                    worker
                );
                const initialSWalletTokenBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                const initialNonce = await smartWallet.nonce();

                const relayRequest = await createRequest(
                    {
                        data: recipientFunction,
                        to: recipient.address,
                        nonce: initialNonce.toString(),
                        relayHub: caller.address,
                        tokenContract: token.address,
                        from: senderAddress
                    },
                    relayData
                );
                const reqData: EIP712TypedData = new TypedRequestData(
                    chainId,
                    smartWallet.address,
                    relayRequest
                );
                const sig = signTypedData_v4(senderPrivateKey, {
                    data: reqData
                });
                const suffixData = bufferToHex(
                    TypedDataUtils.encodeData(
                        reqData.primaryType,
                        reqData.message,
                        reqData.types
                    ).slice((1 + countParams) * 32)
                );

                const result = await caller.callExecute(
                    smartWallet.address,
                    relayRequest.request,
                    worker,
                    suffixData,
                    sig,
                    { from: worker }
                );
                assert.equal(
                    result.logs[0].args.error,
                    'always fail',
                    'Incorrect message'
                );
                assert.equal(
                    result.logs[0].args.success,
                    false,
                    'Should have failed'
                );

                const tknBalance = await getTokenBalance(token, worker);
                const swTknBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance.sub(initialWorkerTokenBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new worker token balance'
                );
                assert.equal(
                    initialSWalletTokenBalance.sub(swTknBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new smart wallet token balance'
                );

                assert.equal(
                    (await smartWallet.nonce()).toString(),
                    initialNonce.add(new BN(1)).toString(),
                    'verifyAndCall should increment nonce'
                );
            });

            it('should not be able to re-submit after revert', async () => {
                const customLogic = await FailureCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    senderAddress,
                    factory,
                    senderPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );
                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };

                const caller = await TestSmartWallet.new();

                const initialWorkerTokenBalance = await getTokenBalance(
                    token,
                    worker
                );
                const initialSWalletTokenBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                const initialNonce = await smartWallet.nonce();

                const relayRequest = await createRequest(
                    {
                        data: recipientFunction,
                        to: recipient.address,
                        nonce: initialNonce.toString(),
                        relayHub: caller.address,
                        tokenContract: token.address,
                        from: senderAddress
                    },
                    relayData
                );
                const reqData: EIP712TypedData = new TypedRequestData(
                    chainId,
                    smartWallet.address,
                    relayRequest
                );
                const sig = signTypedData_v4(senderPrivateKey, {
                    data: reqData
                });
                const suffixData = bufferToHex(
                    TypedDataUtils.encodeData(
                        reqData.primaryType,
                        reqData.message,
                        reqData.types
                    ).slice((1 + countParams) * 32)
                );

                const result = await caller.callExecute(
                    smartWallet.address,
                    relayRequest.request,
                    worker,
                    suffixData,
                    sig,
                    { from: worker }
                );
                assert.equal(
                    result.logs[0].args.error,
                    'always fail',
                    'Incorrect message'
                );
                assert.equal(
                    result.logs[0].args.success,
                    false,
                    'Should have failed'
                );

                const tknBalance = await getTokenBalance(token, worker);
                const swTknBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance.sub(initialWorkerTokenBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new worker token balance'
                );
                assert.equal(
                    initialSWalletTokenBalance.sub(swTknBalance).toString(),
                    new BN(1).toString(),
                    'Incorrect new smart wallet token balance'
                );

                await expectRevert.unspecified(
                    caller.callExecute(
                        smartWallet.address,
                        relayRequest.request,
                        worker,
                        suffixData,
                        sig,
                        { from: worker }
                    ),
                    'nonce mismatch'
                );

                const tknBalance2 = await getTokenBalance(token, worker);
                const swTknBalance2 = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance2.toString(),
                    tknBalance.toString(),
                    'Incorrect new worker token balance'
                );
                assert.equal(
                    swTknBalance2.toString(),
                    swTknBalance.toString(),
                    'Incorrect new smart wallet token balance'
                );

                assert.equal(
                    (await smartWallet.nonce()).toString(),
                    initialNonce.add(new BN(1)).toString(),
                    'verifyAndCall should increment nonce'
                );
            });
        });

        describe('#verifyAndCallByOwner', () => {
            let recipient: TestForwarderTargetInstance;
            let recipientFunction: any;

            beforeEach(async () => {
                recipient = await TestForwarderTarget.new();
                recipientFunction = recipient.contract.methods
                    .emitMessage('hello')
                    .encodeABI();
            });

            it('should call function with custom logic', async () => {
                // Init smart wallet and
                const customLogic = await SuccessCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    fundedAccount,
                    factory,
                    fundedAccountPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );

                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };

                const initialWorkerTokenBalance = await getTokenBalance(
                    token,
                    worker
                );
                const initialSWalletTokenBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                const initialNonce = await smartWallet.nonce();

                const result = await smartWallet.directExecute(
                    recipient.address,
                    recipientFunction,
                    { from: fundedAccount }
                );

                // @ts-ignore
                assert(
                    containsEvent(
                        customLogic.abi,
                        result.receipt.rawLogs,
                        'LogicCalled'
                    ),
                    'Should call custom logic'
                );

                const tknBalance = await getTokenBalance(token, worker);
                const swTknBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance.sub(initialWorkerTokenBalance).toString(),
                    new BN(0).toString(),
                    'worker token balance should not change'
                );
                assert.equal(
                    initialSWalletTokenBalance.sub(swTknBalance).toString(),
                    new BN(0).toString(),
                    'smart wallet token balance should not change'
                );

                assert.equal(
                    (await smartWallet.nonce()).toString(),
                    initialNonce.toString(),
                    'direct execute should NOT increment nonce'
                );
            });

            it('should revert if logic revert', async () => {
                const customLogic = await FailureCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    fundedAccount,
                    factory,
                    fundedAccountPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );
                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };
                await smartWallet.directExecute(
                    recipient.address,
                    recipientFunction,
                    {
                        from: fundedAccount
                    }
                );
                const result = await smartWallet.directExecute.call(
                    recipient.address,
                    recipientFunction,
                    { from: fundedAccount }
                );
                assert.isTrue(!result[0], 'should revert');
            });

            it("should call function from custom logic with wallet's address", async () => {
                // Init smart wallet and
                const customLogic = await ProxyCustomLogic.new();
                const template = await CustomSmartWallet.new();
                const factory = await createCustomSmartWalletFactory(template);
                const smartWallet = await createCustomSmartWallet(
                    otherAccount,
                    fundedAccount,
                    factory,
                    fundedAccountPrivateKey,
                    chainId,
                    customLogic.address,
                    '0x'
                );
                await fillTokens(token, smartWallet.address, '1000');
                relayData = {
                    callForwarder: smartWallet.address
                };

                const initialWorkerTokenBalance = await getTokenBalance(
                    token,
                    worker
                );
                const initialSWalletTokenBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                const initialNonce = await smartWallet.nonce();

                const result = await smartWallet.directExecute(
                    recipient.address,
                    recipientFunction,
                    { from: fundedAccount }
                );

                // @ts-ignore
                assert(
                    containsEvent(
                        customLogic.abi,
                        result.receipt.rawLogs,
                        'LogicCalled'
                    ),
                    'Should call custom logic'
                );

                // @ts-ignore
                const logs = await recipient.getPastEvents(
                    'TestForwarderMessage'
                );
                assert.equal(logs.length, 1, 'TestRecipient should emit');
                assert.equal(
                    logs[0].args.origin,
                    fundedAccount,
                    'test "from" account is the tx.origin'
                );
                assert.equal(
                    logs[0].args.msgSender,
                    smartWallet.address,
                    'msg.sender must be the smart wallet address'
                );

                const tknBalance = await getTokenBalance(token, worker);
                const swTknBalance = await getTokenBalance(
                    token,
                    smartWallet.address
                );

                assert.equal(
                    tknBalance.sub(initialWorkerTokenBalance).toString(),
                    new BN(0).toString(),
                    'worker token balance should not change'
                );
                assert.equal(
                    initialSWalletTokenBalance.sub(swTknBalance).toString(),
                    new BN(0).toString(),
                    'smart wallet token balance should not cahnge'
                );

                assert.equal(
                    (await smartWallet.nonce()).toString(),
                    initialNonce.toString(),
                    'direct execute should NOT increment nonce'
                );
            });
        });
    }
);

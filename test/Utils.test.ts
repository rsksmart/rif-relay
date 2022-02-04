// @ts-ignore
import { recoverTypedSignature_v4 } from 'eth-sig-util';
import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';

import {
    constants,
    estimateMaxPossibleRelayCallWithLinearFit,
    getLocalEip712Signature
} from '@rsksmart/rif-relay-common';
import { RelayRequest, TypedRequestData } from '@rsksmart/rif-relay-contracts';
import { expectEvent } from '@openzeppelin/test-helpers';
import {
    SmartWalletInstance,
    TestRecipientInstance,
    TestUtilInstance,
    SmartWalletFactoryInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import { PrefixedHexString } from 'ethereumjs-tx';
import {
    encodeRevertReason,
    createSmartWalletFactory,
    createSmartWallet,
    getGaslessAccount
} from './TestUtils';
import { AccountKeypair } from '@rsksmart/rif-relay-client';

//@ts-ignore
import sourceMapSupport from 'source-map-support';
//@ts-ignore
sourceMapSupport.install({ errorFormatterForce: true });

const { assert } = chai.use(chaiAsPromised);

const TestUtil = artifacts.require('TestUtil');
const TestRecipient = artifacts.require('TestRecipient');
const SmartWallet = artifacts.require('SmartWallet');

contract('Utils', function (accounts) {
    // This test verifies signing typed data with a local implementation of signTypedData
    describe('#getLocalEip712Signature()', function () {
        // ganache always reports chainId as '1'
        let senderAccount: AccountKeypair;
        let chainId: number;
        let forwarder: PrefixedHexString;
        let relayRequest: RelayRequest;
        let senderAddress: string;
        let senderPrivateKey: Buffer;
        let testUtil: TestUtilInstance;
        let recipient: TestRecipientInstance;

        let forwarderInstance: SmartWalletInstance;
        before(async () => {
            senderAccount = await getGaslessAccount();
            senderAddress = senderAccount.address;
            senderPrivateKey = senderAccount.privateKey;
            testUtil = await TestUtil.new();
            chainId = (await testUtil.libGetChainID()).toNumber();
            const smartWalletTemplate: SmartWalletInstance =
                await SmartWallet.new();
            const factory: SmartWalletFactoryInstance =
                await createSmartWalletFactory(smartWalletTemplate);
            forwarderInstance = await createSmartWallet(
                accounts[0],
                senderAddress,
                factory,
                senderPrivateKey,
                chainId
            );
            forwarder = forwarderInstance.address;
            recipient = await TestRecipient.new();

            const senderNonce = '0';
            const target = recipient.address;
            const encodedFunction = '0xdeadbeef';
            const gasPrice = '1';
            const gasLimit = '1000000';
            const verifier = accounts[7];
            const relayWorker = accounts[9];

            relayRequest = {
                request: {
                    relayHub: testUtil.address,
                    to: target,
                    data: encodedFunction,
                    from: senderAddress,
                    nonce: senderNonce,
                    value: '0',
                    gas: gasLimit,
                    tokenContract: constants.ZERO_ADDRESS,
                    collectorContract: constants.ZERO_ADDRESS,
                    tokenAmount: '0',
                    tokenGas: '0'
                },
                relayData: {
                    gasPrice,
                    relayWorker,
                    callForwarder: forwarder,
                    callVerifier: verifier
                }
            };
        });

        it('should generate a valid EIP-712 compatible signature', async function () {
            const dataToSign = new TypedRequestData(
                chainId,
                forwarder,
                relayRequest
            );

            const sig = await getLocalEip712Signature(
                dataToSign,
                senderPrivateKey
            );

            const recoveredAccount = recoverTypedSignature_v4({
                data: dataToSign,
                sig
            });
            assert.strictEqual(
                senderAddress.toLowerCase(),
                recoveredAccount.toLowerCase()
            );

            await testUtil.callForwarderVerify(relayRequest, sig);
        });

        describe('#callForwarderVerifyAndCall', () => {
            it('should return revert result', async function () {
                relayRequest.request.data = await recipient.contract.methods
                    .testRevert()
                    .encodeABI();
                const sig = getLocalEip712Signature(
                    new TypedRequestData(chainId, forwarder, relayRequest),
                    senderPrivateKey
                );
                const ret = await testUtil.callForwarderVerifyAndCall(
                    relayRequest,
                    sig
                );
                const expectedReturnValue = encodeRevertReason('always fail');
                expectEvent(ret, 'Called', {
                    success: false,
                    error: expectedReturnValue
                });
            });

            it('should correctly calculate the linear estimation', async function () {
                const gas = 40000;
                const tokenGas = 18000;

                const expectedRelayGasNoToken = 127771;
                const expectedRelayGasWithToken = 136993;

                const gasNoToken = estimateMaxPossibleRelayCallWithLinearFit(
                    gas,
                    0
                );
                const gasToken = estimateMaxPossibleRelayCallWithLinearFit(
                    gas,
                    tokenGas
                );

                assert.equal(
                    expectedRelayGasNoToken,
                    gasNoToken,
                    'Estimation with no tokenGas differs'
                );
                assert.equal(
                    expectedRelayGasWithToken,
                    gasToken,
                    'Estimation with tokenGas differs'
                );
            });

            it('should call target', async function () {
                relayRequest.request.data = recipient.contract.methods
                    .emitMessage('hello')
                    .encodeABI();
                relayRequest.request.nonce = (
                    await forwarderInstance.nonce()
                ).toString();

                const sig = getLocalEip712Signature(
                    new TypedRequestData(chainId, forwarder, relayRequest),
                    senderPrivateKey
                );
                const ret = await testUtil.callForwarderVerifyAndCall(
                    relayRequest,
                    sig
                );
                expectEvent(ret, 'Called', {
                    error: null
                });
                const logs = await recipient.contract.getPastEvents(null, {
                    fromBlock: 1
                });
                assert.equal(logs[0].event, 'SampleRecipientEmitted');
            });
        });
    });
});

import { ether, expectRevert } from '@openzeppelin/test-helpers';
import chai from 'chai';
import {
    Environment,
    decodeRevertReason,
    getLocalEip712Signature,
    removeHexPrefix,
    RelayRequest,
    cloneRelayRequest,
    DeployRequest,
    cloneDeployRequest,
    TypedRequestData,
    getDomainSeparatorHash,
    TypedDeployRequestData,
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
    TestVerifierConfigurableMisbehaviorInstance,
    SmartWalletInstance,
    SmartWalletFactoryInstance,
    TestTokenInstance,
    TestDeployVerifierConfigurableMisbehaviorInstance,
    TestDeployVerifierEverythingAcceptedInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    stripHex,
    deployHub,
    encodeRevertReason,
    getTestingEnvironment,
    createSmartWallet,
    getGaslessAccount,
    createSmartWalletFactory,
    evmMineMany
} from './TestUtils';
import chaiAsPromised from 'chai-as-promised';
import { AccountKeypair } from '@rsksmart/rif-relay-client';
import { keccak } from 'ethereumjs-util';
import { toBN, toChecksumAddress, toHex } from 'web3-utils';
const { assert } = chai.use(chaiAsPromised);
const SmartWallet = artifacts.require('SmartWallet');
const Penalizer = artifacts.require('Penalizer');
const TestVerifierEverythingAccepted = artifacts.require(
    'TestVerifierEverythingAccepted'
);
const TestDeployVerifierEverythingAccepted = artifacts.require(
    'TestDeployVerifierEverythingAccepted'
);
const TestRecipient = artifacts.require('TestRecipient');
const TestVerifierConfigurableMisbehavior = artifacts.require(
    'TestVerifierConfigurableMisbehavior'
);
const TestDeployVerifierConfigurableMisbehavior = artifacts.require(
    'TestDeployVerifierConfigurableMisbehavior'
);

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi);
abiDecoder.addABI(IWalletFactory.abi);
abiDecoder.addABI(IRelayHub.abi);

contract(
    'RelayHub',
    function ([
        _,
        relayOwner,
        relayManager,
        relayWorker,
        incorrectWorker,
        incorrectRelayManager,
        unknownWorker,
        beneficiary,
        penalizerMock
    ]) {
        let chainId: number;
        let relayHub: string;
        let penalizer: PenalizerInstance;
        let relayHubInstance: RelayHubInstance;
        let recipientContract: TestRecipientInstance;
        let verifierContract: TestVerifierEverythingAcceptedInstance;
        let deployVerifierContract: TestDeployVerifierEverythingAcceptedInstance;
        let forwarderInstance: IForwarderInstance;
        let target: string;
        let verifier: string;
        let forwarder: string;
        let gaslessAccount: AccountKeypair;
        const gasLimit = '3000000';
        const gasPrice = '1';
        let sharedRelayRequestData: RelayRequest;
        let sharedDeployRequestData: DeployRequest;
        let env: Environment;
        let token: TestTokenInstance;
        let factory: SmartWalletFactoryInstance;

        describe('add/disable relay workers', function () {
            beforeEach(async function () {
                penalizer = await Penalizer.new();
                env = await getTestingEnvironment();
                chainId = env.chainId;
                relayHubInstance = await deployHub(penalizer.address);
                verifierContract = await TestVerifierEverythingAccepted.new();
                deployVerifierContract =
                    await TestDeployVerifierEverythingAccepted.new();
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
                        relayWorker,
                        callForwarder: forwarder,
                        callVerifier: verifier
                    }
                };
            });

            it('should register and allow to disable new relay workers', async function () {
                await relayHubInstance.stakeForAddress(relayManager, 1000, {
                    value: ether('1'),
                    from: relayOwner
                });

                const relayWorkersBefore = await relayHubInstance.workerCount(
                    relayManager
                );
                assert.equal(
                    relayWorkersBefore.toNumber(),
                    0,
                    `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`
                );

                let txResponse = await relayHubInstance.addRelayWorkers(
                    [relayWorker],
                    {
                        from: relayManager
                    }
                );
                let receipt = await web3.eth.getTransactionReceipt(
                    txResponse.tx
                );
                let logs = abiDecoder.decodeLogs(receipt.logs);

                const relayWorkersAddedEvent = logs.find(
                    (e: any) => e != null && e.name === 'RelayWorkersAdded'
                );
                assert.equal(
                    relayManager.toLowerCase(),
                    relayWorkersAddedEvent.events[0].value.toLowerCase()
                );
                assert.equal(
                    relayWorker.toLowerCase(),
                    relayWorkersAddedEvent.events[1].value[0].toLowerCase()
                );
                assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value);

                let relayWorkersAfter = await relayHubInstance.workerCount(
                    relayManager
                );
                assert.equal(
                    relayWorkersAfter.toNumber(),
                    1,
                    'Workers must be one'
                );

                let manager = await relayHubInstance.workerToManager(
                    relayWorker
                );
                // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
                let expectedManager = '0x00000000000000000000000'.concat(
                    stripHex(relayManager.concat('1'))
                );

                assert.equal(
                    manager.toLowerCase(),
                    expectedManager.toLowerCase(),
                    `Incorrect relay manager: ${manager}`
                );

                txResponse = await relayHubInstance.disableRelayWorkers(
                    [relayWorker],
                    {
                        from: relayManager
                    }
                );

                receipt = await web3.eth.getTransactionReceipt(txResponse.tx);
                logs = abiDecoder.decodeLogs(receipt.logs);
                const relayWorkersDisabledEvent = logs.find(
                    (e: any) => e != null && e.name === 'RelayWorkersDisabled'
                );
                assert.equal(
                    relayManager.toLowerCase(),
                    relayWorkersDisabledEvent.events[0].value.toLowerCase()
                );
                assert.equal(
                    relayWorker.toLowerCase(),
                    relayWorkersDisabledEvent.events[1].value[0].toLowerCase()
                );
                assert.equal(
                    toBN(0),
                    relayWorkersDisabledEvent.events[2].value
                );

                relayWorkersAfter = await relayHubInstance.workerCount(
                    relayManager
                );
                assert.equal(
                    relayWorkersAfter.toNumber(),
                    0,
                    'Workers must be zero'
                );

                manager = await relayHubInstance.workerToManager(relayWorker);
                expectedManager = '0x00000000000000000000000'.concat(
                    stripHex(relayManager.concat('0'))
                );
                assert.equal(
                    manager.toLowerCase(),
                    expectedManager.toLowerCase(),
                    `Incorrect relay manager: ${manager}`
                );
            });

            it('should fail to disable more relay workers than available', async function () {
                await relayHubInstance.stakeForAddress(relayManager, 1000, {
                    value: ether('1'),
                    from: relayOwner
                });

                const relayWorkersBefore = await relayHubInstance.workerCount(
                    relayManager
                );
                assert.equal(
                    relayWorkersBefore.toNumber(),
                    0,
                    `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`
                );

                const txResponse = await relayHubInstance.addRelayWorkers(
                    [relayWorker],
                    { from: relayManager }
                );

                const receipt = await web3.eth.getTransactionReceipt(
                    txResponse.tx
                );
                const logs = abiDecoder.decodeLogs(receipt.logs);

                const relayWorkersAddedEvent = logs.find(
                    (e: any) => e != null && e.name === 'RelayWorkersAdded'
                );
                assert.equal(
                    relayManager.toLowerCase(),
                    relayWorkersAddedEvent.events[0].value.toLowerCase()
                );
                assert.equal(
                    relayWorker.toLowerCase(),
                    relayWorkersAddedEvent.events[1].value[0].toLowerCase()
                );
                assert.equal(toBN(1), relayWorkersAddedEvent.events[2].value);

                let relayWorkersAfter = await relayHubInstance.workerCount(
                    relayManager
                );
                assert.equal(
                    relayWorkersAfter.toNumber(),
                    1,
                    'Workers must be one'
                );

                let manager = await relayHubInstance.workerToManager(
                    relayWorker
                );
                // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
                let expectedManager = '0x00000000000000000000000'.concat(
                    stripHex(relayManager.concat('1'))
                );

                assert.equal(
                    manager.toLowerCase(),
                    expectedManager.toLowerCase(),
                    `Incorrect relay manager: ${manager}`
                );

                await expectRevert(
                    relayHubInstance.disableRelayWorkers(
                        [relayWorker, relayWorker],
                        {
                            from: relayManager
                        }
                    ),
                    'invalid quantity of workers'
                );

                relayWorkersAfter = await relayHubInstance.workerCount(
                    relayManager
                );
                assert.equal(
                    relayWorkersAfter.toNumber(),
                    1,
                    'Workers must be one'
                );

                manager = await relayHubInstance.workerToManager(relayWorker);
                expectedManager = '0x00000000000000000000000'.concat(
                    stripHex(relayManager.concat('1'))
                );
                assert.equal(
                    manager.toLowerCase(),
                    expectedManager.toLowerCase(),
                    `Incorrect relay manager: ${manager}`
                );
            });

            it('should only allow the corresponding relay manager to disable their respective relay workers', async function () {
                await relayHubInstance.stakeForAddress(relayManager, 1000, {
                    value: ether('1'),
                    from: relayOwner
                });

                await relayHubInstance.stakeForAddress(
                    incorrectRelayManager,
                    1000,
                    {
                        value: ether('1'),
                        from: relayOwner
                    }
                );

                const relayWorkersBefore = await relayHubInstance.workerCount(
                    relayManager
                );
                const relayWorkersBefore2 = await relayHubInstance.workerCount(
                    incorrectRelayManager
                );
                assert.equal(
                    relayWorkersBefore.toNumber(),
                    0,
                    `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`
                );
                assert.equal(
                    relayWorkersBefore2.toNumber(),
                    0,
                    `Initial workers must be zero but was ${relayWorkersBefore2.toNumber()}`
                );

                await relayHubInstance.addRelayWorkers([relayWorker], {
                    from: relayManager
                });
                await relayHubInstance.addRelayWorkers([incorrectWorker], {
                    from: incorrectRelayManager
                });

                const relayWorkersAfter = await relayHubInstance.workerCount(
                    relayManager
                );
                let relayWorkersAfter2 = await relayHubInstance.workerCount(
                    incorrectRelayManager
                );

                assert.equal(
                    relayWorkersAfter.toNumber(),
                    1,
                    'Workers must be one'
                );
                assert.equal(
                    relayWorkersAfter2.toNumber(),
                    1,
                    'Workers must be one'
                );

                let manager = await relayHubInstance.workerToManager(
                    relayWorker
                );
                let manager2 = await relayHubInstance.workerToManager(
                    incorrectWorker
                );

                // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
                let expectedManager = '0x00000000000000000000000'.concat(
                    stripHex(relayManager.concat('1'))
                );
                let expectedManager2 = '0x00000000000000000000000'.concat(
                    stripHex(incorrectRelayManager.concat('1'))
                );

                assert.equal(
                    manager.toLowerCase(),
                    expectedManager.toLowerCase(),
                    `Incorrect relay manager: ${manager}`
                );
                assert.equal(
                    manager2.toLowerCase(),
                    expectedManager2.toLowerCase(),
                    `Incorrect relay manager: ${manager2}`
                );

                await expectRevert(
                    relayHubInstance.disableRelayWorkers([relayWorker], {
                        from: incorrectRelayManager
                    }),
                    'Incorrect Manager'
                );

                relayWorkersAfter2 = await relayHubInstance.workerCount(
                    incorrectRelayManager
                );
                assert.equal(
                    relayWorkersAfter2.toNumber(),
                    1,
                    "Workers shouldn't have changed"
                );

                manager = await relayHubInstance.workerToManager(relayWorker);
                expectedManager = '0x00000000000000000000000'.concat(
                    stripHex(relayManager.concat('1'))
                );
                assert.equal(
                    manager.toLowerCase(),
                    expectedManager.toLowerCase(),
                    `Incorrect relay manager: ${manager}`
                );

                manager2 = await relayHubInstance.workerToManager(
                    incorrectWorker
                );
                expectedManager2 = '0x00000000000000000000000'.concat(
                    stripHex(incorrectRelayManager.concat('1'))
                );
                assert.equal(
                    manager2.toLowerCase(),
                    expectedManager2.toLowerCase(),
                    `Incorrect relay manager: ${manager2}`
                );
            });
        });

        describe('relayCall', function () {
            beforeEach(async function () {
                env = await getTestingEnvironment();
                chainId = env.chainId;

                penalizer = await Penalizer.new();
                relayHubInstance = await deployHub(penalizer.address);
                verifierContract = await TestVerifierEverythingAccepted.new();
                deployVerifierContract =
                    await TestDeployVerifierEverythingAccepted.new();
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
                        relayWorker,
                        callForwarder: forwarder,
                        callVerifier: verifier
                    }
                };
            });

            it('should retrieve version number', async function () {
                const version = await relayHubInstance.versionHub();
                assert.match(
                    version,
                    /2\.\d*\.\d*-?.*\+enveloping\.hub\.irelayhub/
                );
            });

            // TODO review gasPrice for RSK
            context('with unknown worker', function () {
                const gas = 4e6;
                let relayRequest: RelayRequest;
                let signature: string;
                beforeEach(async function () {
                    relayRequest = cloneRelayRequest(sharedRelayRequestData);
                    relayRequest.request.data = '0xdeadbeef';
                    relayRequest.relayData.relayWorker = unknownWorker;

                    const dataToSign = new TypedRequestData(
                        chainId,
                        forwarder,
                        relayRequest
                    );
                    signature = getLocalEip712Signature(
                        dataToSign,
                        gaslessAccount.privateKey
                    );
                });

                it('should not accept a relay call with a disabled worker - 2', async function () {
                    await expectRevert(
                        relayHubInstance.relayCall(relayRequest, signature, {
                            from: unknownWorker,
                            gas
                        }),
                        'Not an enabled worker'
                    );
                });
            });

            context('with manager stake unlocked', function () {
                const gas = 4e6;
                let relayRequest: RelayRequest;
                let signature: string;
                beforeEach(async function () {
                    relayRequest = cloneRelayRequest(sharedRelayRequestData);
                    relayRequest.request.data = '0xdeadbeef';

                    const dataToSign = new TypedRequestData(
                        chainId,
                        forwarder,
                        relayRequest
                    );
                    signature = getLocalEip712Signature(
                        dataToSign,
                        gaslessAccount.privateKey
                    );

                    await relayHubInstance.stakeForAddress(relayManager, 1000, {
                        value: ether('1'),
                        from: relayOwner
                    });
                    await relayHubInstance.addRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                });
                it('should not accept a relay call', async function () {
                    await relayHubInstance.unlockStake(relayManager, {
                        from: relayOwner
                    });
                    await expectRevert(
                        relayHubInstance.relayCall(relayRequest, signature, {
                            from: relayWorker,
                            gas
                        }),
                        'RelayManager not staked'
                    );
                });
                it('should not accept a relay call with a disabled worker', async function () {
                    await relayHubInstance.disableRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                    await expectRevert(
                        relayHubInstance.relayCall(relayRequest, signature, {
                            from: relayWorker,
                            gas
                        }),
                        'Not an enabled worker'
                    );
                });
            });

            context('with staked and registered relay', function () {
                const url = 'http://relay.com';
                const message = 'Enveloping RelayHub';
                const messageWithNoParams = 'Method with no parameters';

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

                context(
                    'with relay worker that is not externally-owned account',
                    function () {
                        it('should not accept relay requests', async function () {
                            const signature = '0xdeadbeef';
                            const gas = 4e6;
                            const TestRelayWorkerContract = artifacts.require(
                                'TestRelayWorkerContract'
                            );
                            const testRelayWorkerContract =
                                await TestRelayWorkerContract.new();
                            await relayHubInstance.addRelayWorkers(
                                [testRelayWorkerContract.address],
                                {
                                    from: relayManager
                                }
                            );

                            await expectRevert(
                                testRelayWorkerContract.relayCall(
                                    relayHubInstance.address,
                                    relayRequest,
                                    signature,
                                    {
                                        gas
                                    }
                                ),
                                'RelayWorker cannot be a contract'
                            );
                        });
                    }
                );
                context('with view functions only', function () {
                    let misbehavingVerifier: TestVerifierConfigurableMisbehaviorInstance;
                    let relayRequestMisbehavingVerifier: RelayRequest;

                    beforeEach(async function () {
                        misbehavingVerifier =
                            await TestVerifierConfigurableMisbehavior.new();
                        relayRequestMisbehavingVerifier =
                            cloneRelayRequest(relayRequest);
                        relayRequestMisbehavingVerifier.relayData.callVerifier =
                            misbehavingVerifier.address;
                    });

                    // TODO re-enable
                    it.skip("should get 'verifierAccepted = true' and no revert reason as view call result of 'relayCall' for a valid transaction", async function () {
                        const relayCallView =
                            await relayHubInstance.contract.methods
                                .relayCall(
                                    relayRequest,
                                    signatureWithPermissiveVerifier
                                )
                                .call({
                                    from: relayWorker,
                                    gas: 7e6
                                });
                        assert.equal(relayCallView.returnValue, null);
                        assert.equal(relayCallView.verifierAccepted, true);
                    });

                    // TODO re-enable
                    it.skip("should get Verifier's reject reason from view call result of 'relayCall' for a transaction with a wrong signature", async function () {
                        await misbehavingVerifier.setReturnInvalidErrorCode(
                            true
                        );
                        const relayCallView =
                            await relayHubInstance.contract.methods
                                .relayCall(
                                    relayRequestMisbehavingVerifier,
                                    '0x'
                                )
                                .call({ from: relayWorker });

                        assert.equal(relayCallView.verifierAccepted, false);

                        assert.equal(
                            relayCallView.returnValue,
                            encodeRevertReason('invalid code')
                        );
                        assert.equal(
                            decodeRevertReason(relayCallView.returnValue),
                            'invalid code'
                        );
                    });
                });

                context('with funded verifier', function () {
                    let signature;

                    let misbehavingVerifier: TestVerifierConfigurableMisbehaviorInstance;

                    let signatureWithMisbehavingVerifier: string;
                    let relayRequestMisbehavingVerifier: RelayRequest;
                    const gas = 4e6;

                    beforeEach(async function () {
                        misbehavingVerifier =
                            await TestVerifierConfigurableMisbehavior.new();

                        let dataToSign = new TypedRequestData(
                            chainId,
                            forwarder,
                            relayRequest
                        );

                        signature = getLocalEip712Signature(
                            dataToSign,
                            gaslessAccount.privateKey
                        );

                        relayRequestMisbehavingVerifier =
                            cloneRelayRequest(relayRequest);
                        relayRequestMisbehavingVerifier.relayData.callVerifier =
                            misbehavingVerifier.address;

                        dataToSign = new TypedRequestData(
                            chainId,
                            forwarder,
                            relayRequestMisbehavingVerifier
                        );
                        signatureWithMisbehavingVerifier =
                            getLocalEip712Signature(
                                dataToSign,
                                gaslessAccount.privateKey
                            );
                    });

                    it.skip('gas prediction tests - with token payment', async function () {
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

                        let estimatedTokenPaymentGas =
                            await web3.eth.estimateGas({
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
                        completeReq.request.tokenGas = toHex(
                            internalTokenCallCost
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
                        console.log(
                            'The predicted total cost is: ',
                            estimatedCost
                        );
                        console.log(
                            'Detailed estimation: ',
                            detailedEstimation
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

                        let txReceipt = await web3.eth.getTransactionReceipt(
                            tx
                        );

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
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
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
                        balanceToTransfer = toHex(
                            swalletInitialBalance.toNumber()
                        );
                        relayWorkerInitialBalance = await token.balanceOf(
                            relayWorker
                        );

                        completeReq.request.tokenAmount = toHex(
                            swalletInitialBalance
                        );
                        estimatedDestinationCallGas =
                            await web3.eth.estimateGas({
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
                        completeReq.request.tokenGas = toHex(
                            internalTokenCallCost
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
                        console.log(
                            'The token gas estimate is: ',
                            internalTokenCallCost
                        );
                        console.log(
                            'X = ',
                            internalDestinationCallCost + internalTokenCallCost
                        );
                        console.log(
                            'Detailed estimation: ',
                            detailedEstimation
                        );

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

                        txReceipt = await web3.eth.getTransactionReceipt(
                            result.tx
                        );

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
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
                        );
                        assert.isTrue(
                            transactionRelayedEvent !== undefined &&
                                transactionRelayedEvent !== null,
                            'TransactionRelayedEvent not found'
                        );
                    });

                    it.skip('gas prediction tests - without token payment', async function () {
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
                        completeReq.request.tokenContract =
                            constants.ZERO_ADDRESS;
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
                        const estimatedCost =
                            a1 * internalDestinationCallCost + a0;

                        console.log(
                            'The destination contract call estimate is: ',
                            internalDestinationCallCost
                        );
                        console.log('X = ', internalDestinationCallCost);
                        console.log(
                            'The predicted total cost is: ',
                            estimatedCost
                        );
                        console.log(
                            'Detailed estimation: ',
                            detailedEstimation
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
                            relayWorkerFinalBalance.eq(
                                relayWorkerInitialBalance
                            ),
                            'Worker did receive payment'
                        );

                        let nonceAfter = await sWalletInstance.nonce();
                        assert.equal(
                            nonceBefore.addn(1).toNumber(),
                            nonceAfter.toNumber(),
                            'Incorrect nonce after execution'
                        );

                        let txReceipt = await web3.eth.getTransactionReceipt(
                            tx
                        );

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
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
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

                        estimatedDestinationCallGas =
                            await web3.eth.estimateGas({
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
                        console.log(
                            'Detailed estimation: ',
                            detailedEstimation
                        );

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
                            relayWorkerFinalBalance.eq(
                                relayWorkerInitialBalance
                            ),
                            'Worker did receive payment'
                        );

                        nonceAfter = await sWalletInstance.nonce();
                        assert.equal(
                            nonceBefore.addn(2).toNumber(),
                            nonceAfter.toNumber(),
                            'Incorrect nonce after execution'
                        );

                        txReceipt = await web3.eth.getTransactionReceipt(
                            result.tx
                        );

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
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
                        );
                        assert.isTrue(
                            transactionRelayedEvent !== undefined &&
                                transactionRelayedEvent !== null,
                            'TransactionRelayedEvent not found'
                        );
                    });

                    it.skip('gas estimation tests for SmartWallet', async function () {
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
                        message = message.concat(message);
                        const completeReq: RelayRequest = cloneRelayRequest(
                            sharedRelayRequestData
                        );
                        completeReq.request.data =
                            recipientContract.contract.methods
                                .emitMessage3(message)
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

                        const tokenPaymentEstimation = 0; /* await web3.eth.estimateGas({
            from: completeReq.relayData.callForwarder,
            to: token.address,
            data: token.contract.methods.transfer(relayWorker, '1').encodeABI()
          }) */

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
                            estimatedDestinationCallCost +
                                tokenPaymentEstimation
                        );

                        console.log(
                            'The predicted total cost is: ',
                            estimatedCost
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

                        const nonceAfter = await sWalletInstance.nonce();
                        assert.equal(
                            nonceBefore.addn(1).toNumber(),
                            nonceAfter.toNumber(),
                            'Incorrect nonce after execution'
                        );

                        const eventHash = keccak('GasUsed(uint256,uint256)');
                        const txReceipt = await web3.eth.getTransactionReceipt(
                            tx
                        );

                        // const overheadCost = txReceipt.cumulativeGasUsed - costForCalling - estimatedDestinationCallCost
                        // console.log("data overhead: ", overheadCost)

                        // console.log('---------------SmartWallet: RelayCall metrics------------------------')
                        console.log(
                            `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`
                        );

                        let previousGas: BigInt = BigInt(0);
                        let previousStep = null;
                        for (let i = 0; i < txReceipt.logs.length; i++) {
                            const log = txReceipt.logs[i];
                            if (
                                '0x' + eventHash.toString('hex') ===
                                log.topics[0]
                            ) {
                                const step = log.data.substring(0, 66);
                                const gasUsed: BigInt = BigInt(
                                    '0x' +
                                        log.data.substring(67, log.data.length)
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
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
                        );

                        assert.isNotNull(transactionRelayedEvent);

                        // const callWithoutRelay = await recipientContract.emitMessage(message)
                        // const gasUsed: number = callWithoutRelay.receipt.cumulativeGasUsed
                        // const txReceiptWithoutRelay = await web3.eth.getTransactionReceipt(callWithoutRelay)
                        // console.log('--------------- Destination Call Without enveloping------------------------')
                        // console.log(`Cummulative Gas Used: ${gasUsed}`)
                        // console.log('---------------------------------------')
                        // console.log('--------------- Enveloping Overhead ------------------------')
                        // console.log(`Overhead Gas: ${txReceipt.cumulativeGasUsed - gasUsed}`)
                        // console.log('---------------------------------------')
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
                        const txReceipt = await web3.eth.getTransactionReceipt(
                            tx
                        );
                        console.log('---------------------------------------');

                        console.log(`Gas Used: ${txReceipt.gasUsed}`);
                        console.log(
                            `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`
                        );

                        let previousGas: BigInt = BigInt(0);
                        let previousStep = null;
                        for (let i = 0; i < txReceipt.logs.length; i++) {
                            const log = txReceipt.logs[i];
                            if (
                                '0x' + eventHash.toString('hex') ===
                                log.topics[0]
                            ) {
                                const step = log.data.substring(0, 66);
                                const gasUsed: BigInt = BigInt(
                                    '0x' +
                                        log.data.substring(67, log.data.length)
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
                            (e: any) =>
                                e != null && e.name === 'TransactionRelayed'
                        );

                        assert.isNotNull(transactionRelayedEvent);
                    });

                    it('should fail to relay if the worker has been disabled', async function () {
                        let manager = await relayHubInstance.workerToManager(
                            relayWorker
                        );
                        // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
                        let expectedManager =
                            '0x00000000000000000000000'.concat(
                                stripHex(relayManager.concat('1'))
                            );

                        assert.equal(
                            manager.toLowerCase(),
                            expectedManager.toLowerCase(),
                            `Incorrect relay manager: ${manager}`
                        );

                        await relayHubInstance.disableRelayWorkers(
                            [relayWorker],
                            {
                                from: relayManager
                            }
                        );
                        manager = await relayHubInstance.workerToManager(
                            relayWorker
                        );
                        expectedManager = '0x00000000000000000000000'.concat(
                            stripHex(relayManager.concat('0'))
                        );
                        assert.equal(
                            manager.toLowerCase(),
                            expectedManager.toLowerCase(),
                            `Incorrect relay manager: ${manager}`
                        );

                        await expectRevert(
                            relayHubInstance.relayCall(
                                relayRequest,
                                signatureWithPermissiveVerifier,
                                {
                                    from: relayWorker,
                                    gas,
                                    gasPrice
                                }
                            ),
                            'Not an enabled worker'
                        );
                    });

                    it('relayCall executes the transaction and increments sender nonce on hub', async function () {
                        const nonceBefore = await forwarderInstance.nonce();

                        const { tx } = await relayHubInstance.relayCall(
                            relayRequest,
                            signatureWithPermissiveVerifier,
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

                        const receipt = await web3.eth.getTransactionReceipt(
                            tx
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
                    });

                    it('relayCall should refuse to re-send transaction with same nonce', async function () {
                        const { tx } = await relayHubInstance.relayCall(
                            relayRequest,
                            signatureWithPermissiveVerifier,
                            {
                                from: relayWorker,
                                gas,
                                gasPrice
                            }
                        );

                        const receipt = await web3.eth.getTransactionReceipt(
                            tx
                        );
                        const logs = abiDecoder.decodeLogs(receipt.logs);
                        const sampleRecipientEmittedEvent = logs.find(
                            (e: any) =>
                                e != null && e.name === 'SampleRecipientEmitted'
                        );

                        assert.isNotNull(sampleRecipientEmittedEvent);

                        await expectRevert(
                            relayHubInstance.relayCall(
                                relayRequest,
                                signatureWithPermissiveVerifier,
                                {
                                    from: relayWorker,
                                    gas,
                                    gasPrice
                                }
                            ),
                            'nonce mismatch'
                        );
                    });
                    // This test is added due to a regression that almost slipped to production.
                    it('relayCall executes the transaction with no parameters', async function () {
                        const encodedFunction =
                            recipientContract.contract.methods
                                .emitMessageNoParams()
                                .encodeABI();
                        const relayRequestNoCallData =
                            cloneRelayRequest(relayRequest);
                        relayRequestNoCallData.request.data = encodedFunction;
                        const dataToSign = new TypedRequestData(
                            chainId,
                            forwarder,
                            relayRequestNoCallData
                        );
                        signature = getLocalEip712Signature(
                            dataToSign,
                            gaslessAccount.privateKey
                        );
                        const { tx } = await relayHubInstance.relayCall(
                            relayRequestNoCallData,
                            signature,
                            {
                                from: relayWorker,
                                gas,
                                gasPrice
                            }
                        );

                        const receipt = await web3.eth.getTransactionReceipt(
                            tx
                        );
                        const logs = abiDecoder.decodeLogs(receipt.logs);
                        const sampleRecipientEmittedEvent = logs.find(
                            (e: any) =>
                                e != null && e.name === 'SampleRecipientEmitted'
                        );

                        assert.equal(
                            messageWithNoParams,
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
                    });

                    it('relayCall executes a transaction even if recipient call reverts', async function () {
                        const encodedFunction =
                            recipientContract.contract.methods
                                .testRevert()
                                .encodeABI();
                        const relayRequestRevert =
                            cloneRelayRequest(relayRequest);
                        relayRequestRevert.request.data = encodedFunction;
                        const dataToSign = new TypedRequestData(
                            chainId,
                            forwarder,
                            relayRequestRevert
                        );
                        signature = getLocalEip712Signature(
                            dataToSign,
                            gaslessAccount.privateKey
                        );
                        const { tx } = await relayHubInstance.relayCall(
                            relayRequestRevert,
                            signature,
                            {
                                from: relayWorker,
                                gas,
                                gasPrice
                            }
                        );

                        const reason =
                            '0x08c379a0' +
                            removeHexPrefix(
                                web3.eth.abi.encodeParameter(
                                    'string',
                                    'always fail'
                                )
                            );

                        const receipt = await web3.eth.getTransactionReceipt(
                            tx
                        );
                        const logs = abiDecoder.decodeLogs(receipt.logs);
                        const transactionRelayedButRevertedByRecipientEvent =
                            logs.find(
                                (e: any) =>
                                    e != null &&
                                    e.name ===
                                        'TransactionRelayedButRevertedByRecipient'
                            );

                        assert.equal(
                            relayWorker.toLowerCase(),
                            transactionRelayedButRevertedByRecipientEvent.events[1].value.toLowerCase()
                        );
                        assert.equal(
                            reason,
                            transactionRelayedButRevertedByRecipientEvent
                                .events[3].value
                        );
                    });

                    it('should not accept relay requests if passed gas is too low for a relayed transaction', async function () {
                        await expectRevert(
                            relayHubInstance.relayCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: relayWorker,
                                    gasPrice,
                                    gas: '60000'
                                }
                            ),
                            'transaction reverted'
                        );
                    });

                    it('should not accept relay requests with gas price lower than user specified', async function () {
                        const relayRequestMisbehavingVerifier =
                            cloneRelayRequest(relayRequest);
                        relayRequestMisbehavingVerifier.relayData.callVerifier =
                            misbehavingVerifier.address;
                        relayRequestMisbehavingVerifier.relayData.gasPrice = (
                            BigInt(gasPrice) + BigInt(1)
                        ).toString();

                        const dataToSign = new TypedRequestData(
                            chainId,
                            forwarder,
                            relayRequestMisbehavingVerifier
                        );
                        const signatureWithMisbehavingVerifier =
                            getLocalEip712Signature(
                                dataToSign,
                                gaslessAccount.privateKey
                            );

                        await expectRevert(
                            relayHubInstance.relayCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: relayWorker,
                                    gas,
                                    gasPrice: gasPrice
                                }
                            ),
                            'Invalid gas price'
                        );
                    });

                    it('should not accept relay requests with incorrect relay worker', async function () {
                        await relayHubInstance.addRelayWorkers(
                            [incorrectWorker],
                            {
                                from: relayManager
                            }
                        );
                        await expectRevert(
                            relayHubInstance.relayCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: incorrectWorker,
                                    gasPrice,
                                    gas
                                }
                            ),
                            'Not a right worker'
                        );
                    });
                });
            });
        });

        describe('deployCall', function () {
            let min = 0;
            let max = 1000000000;
            min = Math.ceil(min);
            max = Math.floor(max);
            let nextWalletIndex = Math.floor(
                Math.random() * (max - min + 1) + min
            );

            beforeEach(async function () {
                env = await getTestingEnvironment();
                chainId = env.chainId;

                penalizer = await Penalizer.new();
                relayHubInstance = await deployHub(penalizer.address);
                verifierContract = await TestVerifierEverythingAccepted.new();
                deployVerifierContract =
                    await TestDeployVerifierEverythingAccepted.new();
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

                sharedDeployRequestData = {
                    request: {
                        relayHub: relayHub,
                        to: constants.ZERO_ADDRESS,
                        data: '0x',
                        from: gaslessAccount.address,
                        nonce: (
                            await factory.nonce(gaslessAccount.address)
                        ).toString(),
                        value: '0',
                        tokenContract: token.address,
                        tokenAmount: '1',
                        tokenGas: '50000',
                        recoverer: constants.ZERO_ADDRESS,
                        index: '0'
                    },
                    relayData: {
                        gasPrice,
                        relayWorker,
                        callForwarder: factory.address,
                        callVerifier: deployVerifierContract.address
                    }
                };
            });

            // TODO review gasPrice for RSK
            context('with unknown worker', function () {
                const gas = 4e6;
                let deployRequest: DeployRequest;
                let signature: string;

                beforeEach(async function () {
                    deployRequest = cloneDeployRequest(sharedDeployRequestData);
                    deployRequest.request.index = nextWalletIndex.toString();
                    deployRequest.relayData.relayWorker = unknownWorker;

                    const dataToSign = new TypedDeployRequestData(
                        chainId,
                        factory.address,
                        deployRequest
                    );
                    signature = getLocalEip712Signature(
                        dataToSign,
                        gaslessAccount.privateKey
                    );
                    nextWalletIndex++;
                });

                it('should not accept a deploy call - 2', async function () {
                    await expectRevert(
                        relayHubInstance.deployCall(deployRequest, signature, {
                            from: unknownWorker,
                            gas
                        }),
                        'Not an enabled worker'
                    );
                });
            });

            context('with manager stake unlocked', function () {
                const gas = 4e6;
                let signature: string;
                let deployRequest: DeployRequest;

                beforeEach(async function () {
                    deployRequest = cloneDeployRequest(sharedDeployRequestData);
                    deployRequest.request.index = nextWalletIndex.toString();

                    await relayHubInstance.stakeForAddress(relayManager, 1000, {
                        value: ether('1'),
                        from: relayOwner
                    });
                    await relayHubInstance.addRelayWorkers([relayWorker], {
                        from: relayManager
                    });

                    const dataToSign = new TypedDeployRequestData(
                        chainId,
                        factory.address,
                        deployRequest
                    );
                    signature = getLocalEip712Signature(
                        dataToSign,
                        gaslessAccount.privateKey
                    );
                    nextWalletIndex++;
                });

                it('should not accept a deploy call with an unstaked RelayManager', async function () {
                    await relayHubInstance.unlockStake(relayManager, {
                        from: relayOwner
                    });
                    await expectRevert(
                        relayHubInstance.deployCall(deployRequest, signature, {
                            from: relayWorker,
                            gas
                        }),
                        'RelayManager not staked'
                    );
                });
                it('should not accept a deploy call with a disabled relay worker', async function () {
                    await relayHubInstance.disableRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                    await expectRevert(
                        relayHubInstance.deployCall(deployRequest, signature, {
                            from: unknownWorker,
                            gas
                        }),
                        'Not an enabled worker'
                    );
                });
            });

            context('with staked and registered relay', function () {
                const url = 'http://relay.com';
                let deployRequest: DeployRequest;

                beforeEach(async function () {
                    await relayHubInstance.stakeForAddress(relayManager, 1000, {
                        value: ether('2'),
                        from: relayOwner
                    });
                    await relayHubInstance.addRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                    await relayHubInstance.registerRelayServer(url, {
                        from: relayManager
                    });

                    deployRequest = cloneDeployRequest(sharedDeployRequestData);
                    deployRequest.request.index = nextWalletIndex.toString();
                    nextWalletIndex++;
                });

                context(
                    'with relay worker that is not externally-owned account',
                    function () {
                        it('should not accept deploy requests', async function () {
                            const signature = '0xdeadbeef';
                            const gas = 4e6;
                            const TestRelayWorkerContract = artifacts.require(
                                'TestRelayWorkerContract'
                            );
                            const testRelayWorkerContract =
                                await TestRelayWorkerContract.new();
                            await relayHubInstance.addRelayWorkers(
                                [testRelayWorkerContract.address],
                                {
                                    from: relayManager
                                }
                            );
                            await expectRevert(
                                testRelayWorkerContract.deployCall(
                                    relayHubInstance.address,
                                    deployRequest,
                                    signature,
                                    {
                                        gas
                                    }
                                ),
                                'RelayWorker cannot be a contract'
                            );
                        });
                    }
                );

                context('with funded verifier', function () {
                    let misbehavingVerifier: TestDeployVerifierConfigurableMisbehaviorInstance;
                    let signatureWithMisbehavingVerifier: string;
                    let relayRequestMisbehavingVerifier: DeployRequest;
                    const gas = 4e6;

                    beforeEach(async function () {
                        misbehavingVerifier =
                            await TestDeployVerifierConfigurableMisbehavior.new();
                        deployRequest.request.index =
                            nextWalletIndex.toString();
                        nextWalletIndex++;

                        relayRequestMisbehavingVerifier =
                            cloneDeployRequest(deployRequest);
                        relayRequestMisbehavingVerifier.relayData.callVerifier =
                            misbehavingVerifier.address;
                        const dataToSign = new TypedDeployRequestData(
                            chainId,
                            factory.address,
                            relayRequestMisbehavingVerifier
                        );
                        signatureWithMisbehavingVerifier =
                            getLocalEip712Signature(
                                dataToSign,
                                gaslessAccount.privateKey
                            );
                    });

                    it('deployCall executes the transaction and increments sender nonce on factory', async function () {
                        const nonceBefore = await factory.nonce(
                            gaslessAccount.address
                        );
                        const calculatedAddr =
                            await factory.getSmartWalletAddress(
                                gaslessAccount.address,
                                constants.ZERO_ADDRESS,
                                relayRequestMisbehavingVerifier.request.index
                            );
                        await token.mint('1', calculatedAddr);

                        const { tx } = await relayHubInstance.deployCall(
                            relayRequestMisbehavingVerifier,
                            signatureWithMisbehavingVerifier,
                            {
                                from: relayWorker,
                                gas,
                                gasPrice
                            }
                        );

                        const trx = await web3.eth.getTransactionReceipt(tx);

                        const decodedLogs = abiDecoder.decodeLogs(trx.logs);

                        const deployedEvent = decodedLogs.find(
                            (e: any) => e != null && e.name === 'Deployed'
                        );
                        assert.isTrue(
                            deployedEvent !== undefined,
                            'No Deployed event found'
                        );
                        const event = deployedEvent?.events[0];
                        assert.equal(event.name, 'addr');
                        const generatedSWAddress = toChecksumAddress(
                            event.value,
                            env.chainId
                        );

                        assert.equal(calculatedAddr, generatedSWAddress);

                        const nonceAfter = await factory.nonce(
                            gaslessAccount.address
                        );
                        assert.equal(
                            nonceAfter.toNumber(),
                            nonceBefore.addn(1).toNumber()
                        );
                    });

                    it('should fail to deploy if the worker has been disabled', async function () {
                        let manager = await relayHubInstance.workerToManager(
                            relayWorker
                        );
                        // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
                        let expectedManager =
                            '0x00000000000000000000000'.concat(
                                stripHex(relayManager.concat('1'))
                            );

                        assert.equal(
                            manager.toLowerCase(),
                            expectedManager.toLowerCase(),
                            `Incorrect relay manager: ${manager}`
                        );

                        await relayHubInstance.disableRelayWorkers(
                            [relayWorker],
                            {
                                from: relayManager
                            }
                        );
                        manager = await relayHubInstance.workerToManager(
                            relayWorker
                        );
                        expectedManager = '0x00000000000000000000000'.concat(
                            stripHex(relayManager.concat('0'))
                        );
                        assert.equal(
                            manager.toLowerCase(),
                            expectedManager.toLowerCase(),
                            `Incorrect relay manager: ${manager}`
                        );

                        await expectRevert(
                            relayHubInstance.deployCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: relayWorker,
                                    gas,
                                    gasPrice
                                }
                            ),
                            'Not an enabled worker'
                        );
                    });

                    it('deployCall should refuse to re-send transaction with same nonce', async function () {
                        const calculatedAddr =
                            await factory.getSmartWalletAddress(
                                gaslessAccount.address,
                                constants.ZERO_ADDRESS,
                                relayRequestMisbehavingVerifier.request.index
                            );
                        await token.mint('2', calculatedAddr);

                        const { tx } = await relayHubInstance.deployCall(
                            relayRequestMisbehavingVerifier,
                            signatureWithMisbehavingVerifier,
                            {
                                from: relayWorker,
                                gas,
                                gasPrice
                            }
                        );

                        const trx = await web3.eth.getTransactionReceipt(tx);

                        const decodedLogs = abiDecoder.decodeLogs(trx.logs);

                        const deployedEvent = decodedLogs.find(
                            (e: any) => e != null && e.name === 'Deployed'
                        );
                        assert.isTrue(
                            deployedEvent !== undefined,
                            'No Deployed event found'
                        );
                        const event = deployedEvent?.events[0];
                        assert.equal(event.name, 'addr');
                        const generatedSWAddress = toChecksumAddress(
                            event.value,
                            env.chainId
                        );

                        assert.equal(calculatedAddr, generatedSWAddress);
                        assert.equal(calculatedAddr, generatedSWAddress);

                        await expectRevert(
                            relayHubInstance.deployCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: relayWorker,
                                    gas,
                                    gasPrice
                                }
                            ),
                            'nonce mismatch'
                        );
                    });

                    it('should not accept deploy requests if passed gas is too low for a relayed transaction', async function () {
                        await expectRevert(
                            relayHubInstance.deployCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: relayWorker,
                                    gasPrice,
                                    gas: '60000'
                                }
                            ),
                            'transaction reverted'
                        );
                    });

                    it('should not accept deploy requests with gas price lower than user specified', async function () {
                        const relayRequestMisbehavingVerifier =
                            cloneDeployRequest(deployRequest);
                        relayRequestMisbehavingVerifier.relayData.callVerifier =
                            misbehavingVerifier.address;
                        relayRequestMisbehavingVerifier.relayData.gasPrice = (
                            BigInt(gasPrice) + BigInt(1)
                        ).toString();

                        const dataToSign = new TypedDeployRequestData(
                            chainId,
                            factory.address,
                            relayRequestMisbehavingVerifier
                        );
                        const signatureWithMisbehavingVerifier =
                            getLocalEip712Signature(
                                dataToSign,
                                gaslessAccount.privateKey
                            );
                        await expectRevert(
                            relayHubInstance.deployCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: relayWorker,
                                    gas,
                                    gasPrice: gasPrice
                                }
                            ),
                            'Invalid gas price'
                        );
                    });

                    it('should not accept deploy requests with incorrect relay worker', async function () {
                        await relayHubInstance.addRelayWorkers(
                            [incorrectWorker],
                            {
                                from: relayManager
                            }
                        );
                        await expectRevert(
                            relayHubInstance.deployCall(
                                relayRequestMisbehavingVerifier,
                                signatureWithMisbehavingVerifier,
                                {
                                    from: incorrectWorker,
                                    gasPrice,
                                    gas
                                }
                            ),
                            'Not a right worker'
                        );
                    });
                });
            });
        });

        describe('penalize', function () {
            const gas = 4e6;

            beforeEach(async function () {
                relayHubInstance = await deployHub(penalizerMock);
            });

            context('with unknown worker', function () {
                beforeEach(async function () {
                    await relayHubInstance.stakeForAddress(relayManager, 1000, {
                        value: ether('1'),
                        from: relayOwner
                    });
                    await relayHubInstance.addRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                });

                it('should not penalize when an unknown worker is specified', async function () {
                    try {
                        await relayHubInstance.penalize(
                            unknownWorker,
                            beneficiary,
                            {
                                from: penalizerMock,
                                gas
                            }
                        );
                    } catch (error) {
                        const err: string =
                            error instanceof Error
                                ? error.message
                                : JSON.stringify(error);
                        assert.isTrue(err.includes('Unknown relay worker'));
                    }
                });
            });

            context('with manager stake unlocked', function () {
                beforeEach(async function () {
                    await relayHubInstance.stakeForAddress(relayManager, 1000, {
                        value: ether('1'),
                        from: relayOwner
                    });
                    await relayHubInstance.addRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                    await relayHubInstance.unlockStake(relayManager, {
                        from: relayOwner
                    });
                });

                it('should not penalize when an unknown penalizer is specified', async function () {
                    await expectRevert(
                        relayHubInstance.penalize(relayWorker, beneficiary, {
                            from: relayOwner,
                            gas
                        }),
                        'Not penalizer'
                    );
                });

                it('should penalize when the stake is unlocked', async function () {
                    let stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const isUnlocked = Number(stakeInfo.withdrawBlock) > 0;
                    assert.isTrue(isUnlocked, 'Stake is not unlocked');

                    const stakeBalanceBefore = toBN(stakeInfo.stake);
                    const beneficiaryBalanceBefore = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );
                    const toBurn = stakeBalanceBefore.div(toBN(2));
                    const reward = stakeBalanceBefore.sub(toBurn);

                    await relayHubInstance.penalize(relayWorker, beneficiary, {
                        from: penalizerMock,
                        gas
                    });

                    stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const stakeBalanceAfter = toBN(stakeInfo.stake);
                    const beneficiaryBalanceAfter = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );

                    assert.isTrue(
                        stakeBalanceAfter.eq(toBN(0)),
                        'Stake after penalization must be zero'
                    );
                    assert.isTrue(
                        beneficiaryBalanceAfter.eq(
                            beneficiaryBalanceBefore.add(reward)
                        ),
                        'Beneficiary did not receive half the stake'
                    );
                });

                it('should revert if stake is already zero', async function () {
                    let stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const isUnlocked = Number(stakeInfo.withdrawBlock) > 0;
                    assert.isTrue(isUnlocked, 'Stake is not unlocked');

                    await evmMineMany(Number(stakeInfo.unstakeDelay));

                    stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const stakeBalanceBefore = toBN(stakeInfo.stake);

                    const relayOwnerBalanceBefore = toBN(
                        await web3.eth.getBalance(relayOwner)
                    );
                    const gasPrice = toBN('60000000');
                    const txResponse = await relayHubInstance.withdrawStake(
                        relayManager,
                        { from: relayOwner, gasPrice }
                    );

                    const rbtcUsed = toBN(
                        (await web3.eth.getTransactionReceipt(txResponse.tx))
                            .cumulativeGasUsed
                    ).mul(gasPrice);

                    const relayOwnerBalanceAfter = toBN(
                        await web3.eth.getBalance(relayOwner)
                    );

                    assert.isTrue(
                        relayOwnerBalanceAfter.eq(
                            relayOwnerBalanceBefore
                                .sub(rbtcUsed)
                                .add(stakeBalanceBefore)
                        ),
                        'Withdraw process failed'
                    );

                    stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const stakeAfterWithdraw = toBN(stakeInfo.stake);

                    assert.isTrue(
                        stakeAfterWithdraw.isZero(),
                        'Stake must be zero'
                    );

                    const beneficiaryBalanceBefore = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );

                    try {
                        await relayHubInstance.penalize(
                            relayWorker,
                            beneficiary,
                            {
                                from: penalizerMock,
                                gas
                            }
                        );
                    } catch (error) {
                        const err: string =
                            error instanceof Error
                                ? error.message
                                : JSON.stringify(error);
                        assert.isTrue(err.includes('Unstaked relay manager'));
                    }

                    stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const stakeBalanceAfter = toBN(stakeInfo.stake);
                    const beneficiaryBalanceAfter = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );

                    assert.isTrue(
                        stakeBalanceAfter.isZero(),
                        'Stake after penalization must still be zero'
                    );
                    assert.isTrue(
                        beneficiaryBalanceAfter.eq(beneficiaryBalanceBefore),
                        'Beneficiary balance must remain unchanged'
                    );
                });
            });

            context('with staked and registered relay', function () {
                const url = 'http://relay.com';

                beforeEach(async function () {
                    await relayHubInstance.stakeForAddress(relayManager, 1000, {
                        value: ether('2'),
                        from: relayOwner
                    });
                    await relayHubInstance.addRelayWorkers([relayWorker], {
                        from: relayManager
                    });
                    await relayHubInstance.registerRelayServer(url, {
                        from: relayManager
                    });
                });

                it('should not penalize when an unknown penalizer is specified', async function () {
                    await expectRevert(
                        relayHubInstance.penalize(relayWorker, beneficiary, {
                            from: relayOwner,
                            gas
                        }),
                        'Not penalizer'
                    );
                });

                it('should penalize', async function () {
                    let stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );

                    const stakeBalanceBefore = toBN(stakeInfo.stake);
                    const beneficiaryBalanceBefore = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );
                    const toBurn = stakeBalanceBefore.div(toBN(2));
                    const reward = stakeBalanceBefore.sub(toBurn);

                    await relayHubInstance.penalize(relayWorker, beneficiary, {
                        from: penalizerMock,
                        gas
                    });

                    stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const stakeBalanceAfter = toBN(stakeInfo.stake);
                    const beneficiaryBalanceAfter = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );

                    assert.isTrue(
                        stakeBalanceAfter.eq(toBN(0)),
                        'Stake after penalization must be zero'
                    );
                    assert.isTrue(
                        beneficiaryBalanceAfter.eq(
                            beneficiaryBalanceBefore.add(reward)
                        ),
                        'Beneficiary did not receive half the stake'
                    );
                });

                it('should revert if trying to penalize twice', async function () {
                    let stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );

                    const stakeBalanceBefore = toBN(stakeInfo.stake);
                    const beneficiaryBalanceBefore = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );
                    const toBurn = stakeBalanceBefore.div(toBN(2));
                    const reward = stakeBalanceBefore.sub(toBurn);

                    await relayHubInstance.penalize(relayWorker, beneficiary, {
                        from: penalizerMock,
                        gas
                    });

                    stakeInfo = await relayHubInstance.getStakeInfo(
                        relayManager
                    );
                    const stakeBalanceAfter = toBN(stakeInfo.stake);
                    const beneficiaryBalanceAfter = toBN(
                        await web3.eth.getBalance(beneficiary)
                    );

                    assert.isTrue(
                        stakeBalanceAfter.eq(toBN(0)),
                        'Stake after penalization must be zero'
                    );
                    assert.isTrue(
                        beneficiaryBalanceAfter.eq(
                            beneficiaryBalanceBefore.add(reward)
                        ),
                        'Beneficiary did not receive half the stake'
                    );

                    await expectRevert(
                        relayHubInstance.penalize(relayWorker, beneficiary, {
                            from: penalizerMock,
                            gas
                        }),
                        'Unstaked relay manager'
                    );
                });
            });
        });
    }
);

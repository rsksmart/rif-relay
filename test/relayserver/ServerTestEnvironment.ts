// @ts-ignore
import abiDecoder from 'abi-decoder';
import Web3 from 'web3';
import crypto from 'crypto';
import { HttpProvider } from 'web3-core';
import { toHex, keccak256 } from 'web3-utils';
import * as ethUtils from 'ethereumjs-util';
import * as fs from 'fs';
import {
    IRelayVerifier,
    IDeployVerifier,
    IRelayHub
} from '@rsksmart/rif-relay-contracts';
import {
    IForwarderInstance,
    IRelayHubInstance,
    TestVerifierEverythingAcceptedInstance,
    TestRecipientInstance,
    SmartWalletInstance,
    TestDeployVerifierEverythingAcceptedInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import {
    assertRelayAdded,
    getTemporaryWorkdirs,
    ServerWorkdirs
} from './ServerTestUtils';
import {
    KeyManager,
    RelayServer,
    TxStoreManager,
    ServerConfigParams
} from '@rsksmart/rif-relay-server';
import { PrefixedHexString } from 'ethereumjs-tx';
import {
    configure,
    RelayClient,
    RelayInfo,
    RelayRegisteredEventInfo
} from '@rsksmart/rif-relay-client';
import {
    deployHub,
    getTestingEnvironment,
    createSmartWalletFactory,
    createSmartWallet,
    getGaslessAccount
} from '../TestUtils';
import {
    RelayHubConfiguration,
    RelayTransactionRequest,
    EnvelopingConfig,
    constants,
    ContractInteractor,
    EnvelopingTransactionDetails,
    PingResponse
} from '@rsksmart/rif-relay-common';
import { ether } from '@openzeppelin/test-helpers';
const TestRecipient = artifacts.require('TestRecipient');
const TestVerifierEverythingAccepted = artifacts.require(
    'TestVerifierEverythingAccepted'
);
const TestDeployVerifierEverythingAccepted = artifacts.require(
    'TestDeployVerifierEverythingAccepted'
);
const SmartWallet = artifacts.require('SmartWallet');

abiDecoder.addABI(IRelayHub.abi);
abiDecoder.addABI(IRelayVerifier.abi);
abiDecoder.addABI(IDeployVerifier.abi);

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi);
// @ts-ignore
abiDecoder.addABI(TestVerifierEverythingAccepted.abi);
// @ts-ignore
abiDecoder.addABI(TestDeployVerifierEverythingAccepted.abi);

export const LocalhostOne = 'http://localhost:8090';

export interface PrepareRelayRequestOption {
    to: string;
    from: string;
    verifier: string; // TODO Change to relay and deploy verifiers
}

export class ServerTestEnvironment {
    relayHub!: IRelayHubInstance;
    forwarder!: IForwarderInstance;
    relayVerifier!: TestVerifierEverythingAcceptedInstance;
    deployVerifier!: TestDeployVerifierEverythingAcceptedInstance;

    recipient!: TestRecipientInstance;

    relayOwner!: string;
    gasLess!: string;

    encodedFunction!: PrefixedHexString;

    clientId!: string;

    options?: PrepareRelayRequestOption;

    /**
     * Note: do not call methods of contract interactor inside Test Environment. It may affect Profiling Test.
     */
    contractInteractor!: ContractInteractor;

    relayClient!: RelayClient;
    provider: HttpProvider;
    web3: Web3;
    relayServer!: RelayServer;

    constructor(provider: HttpProvider, accounts: string[]) {
        this.provider = provider;
        this.web3 = new Web3(this.provider);
        this.relayOwner = accounts[4];
    }

    /**
     * @param clientConfig
     * @param contractFactory - added for Profiling test, as it requires Test Environment to be using
     * different provider from the contract interactor itself.
     */
    async init(
        clientConfig: Partial<EnvelopingConfig> = {},
        relayHubConfig: Partial<RelayHubConfiguration> = {},
        contractFactory?: (
            clientConfig: Partial<EnvelopingConfig>
        ) => Promise<ContractInteractor>
    ): Promise<void> {
        this.relayHub = await deployHub(undefined, relayHubConfig);
        this.recipient = await TestRecipient.new();
        this.relayVerifier = await TestVerifierEverythingAccepted.new();
        this.deployVerifier = await TestDeployVerifierEverythingAccepted.new();

        this.encodedFunction = this.recipient.contract.methods
            .emitMessage('hello world')
            .encodeABI();

        const gaslessAccount = await getGaslessAccount();
        this.gasLess = gaslessAccount.address;

        const sWalletTemplate = await SmartWallet.new();
        const factory = await createSmartWalletFactory(sWalletTemplate);
        const chainId =
            clientConfig.chainId ?? (await getTestingEnvironment()).chainId;

        const defaultAccount =
            web3.defaultAccount ?? (await web3.eth.getAccounts())[0];
        const smartWallet: SmartWalletInstance = await createSmartWallet(
            defaultAccount ?? constants.ZERO_ADDRESS,
            this.gasLess,
            factory,
            gaslessAccount.privateKey,
            chainId
        );
        this.forwarder = smartWallet;

        const shared: Partial<EnvelopingConfig> = {
            logLevel: 5,
            relayHubAddress: this.relayHub.address,
            relayVerifierAddress: this.relayVerifier.address,
            deployVerifierAddress: this.deployVerifier.address
        };
        if (contractFactory == null) {
            this.contractInteractor = new ContractInteractor(
                this.provider,
                configure(shared)
            );
            await this.contractInteractor.init();
        } else {
            this.contractInteractor = await contractFactory(shared);
        }
        const mergedConfig = Object.assign({}, shared, clientConfig);
        this.relayClient = new RelayClient(
            this.provider,
            configure(mergedConfig)
        );

        // Regisgter gasless account to avoid signing with RSKJ
        this.relayClient.accountManager.addAccount(gaslessAccount);
    }

    async newServerInstance(
        config: Partial<ServerConfigParams> = {},
        serverWorkdirs?: ServerWorkdirs
    ): Promise<void> {
        await this.newServerInstanceNoInit(config, serverWorkdirs, undefined);
        await this.relayServer.init();
        // initialize server - gas price, stake, owner, etc, whatever
        const latestBlock = await this.web3.eth.getBlock('latest');
        const receipts = await this.relayServer._worker(latestBlock.number);
        await assertRelayAdded(receipts, this.relayServer); // sanity check
        await this.relayServer._worker(latestBlock.number + 1);
    }

    _createKeyManager(workdir?: string): KeyManager {
        if (workdir != null) {
            return new KeyManager(1, workdir);
        } else {
            return new KeyManager(1, undefined, crypto.randomBytes(32));
        }
    }

    async newServerInstanceNoInit(
        config: Partial<ServerConfigParams> = {},
        serverWorkdirs?: ServerWorkdirs,
        unstakeDelay = constants.weekInSec
    ): Promise<void> {
        this.newServerInstanceNoFunding(config, serverWorkdirs);
        await web3.eth.sendTransaction({
            to: this.relayServer.managerAddress,
            from: this.relayOwner,
            value: web3.utils.toWei('2', 'ether')
        });

        await this.relayHub.stakeForAddress(
            this.relayServer.managerAddress,
            unstakeDelay,
            {
                from: this.relayOwner,
                value: ether('1')
            }
        );
    }

    newServerInstanceNoFunding(
        config: Partial<ServerConfigParams> = {},
        serverWorkdirs?: ServerWorkdirs
    ): void {
        const managerKeyManager = this._createKeyManager(
            serverWorkdirs?.managerWorkdir
        );
        const workersKeyManager = this._createKeyManager(
            serverWorkdirs?.workersWorkdir
        );
        const workdir =
            serverWorkdirs?.workdir ?? getTemporaryWorkdirs().workdir;
        fs.mkdirSync(workdir, { recursive: true });
        fs.writeFileSync(workdir + '/txstore.db', '');
        const txStoreManager = new TxStoreManager({ workdir });
        const serverDependencies = {
            contractInteractor: this.contractInteractor,
            txStoreManager,
            managerKeyManager,
            workersKeyManager
        };
        const shared: Partial<ServerConfigParams> = {
            relayHubAddress: this.relayHub.address,
            checkInterval: 10,
            logLevel: 5,
            relayVerifierAddress: this.relayVerifier.address,
            deployVerifierAddress: this.deployVerifier.address
        };
        const mergedConfig: Partial<ServerConfigParams> = Object.assign(
            {},
            shared,
            config
        );

        this.relayServer = new RelayServer(mergedConfig, serverDependencies);

        this.relayServer.on('error', (e) => {
            console.log('newServer event', e.message);
        });
        this.relayServer.config.trustedVerifiers.push(
            this.relayVerifier.address
        );
        this.relayServer.config.trustedVerifiers.push(
            this.deployVerifier.address
        );
    }

    async createRelayHttpRequest(
        overrideDetails: Partial<EnvelopingTransactionDetails> = {}
    ): Promise<RelayTransactionRequest> {
        const pingResponse = {
            relayHubAddress: this.relayHub.address,
            relayWorkerAddress: this.relayServer.workerAddress
        };
        const eventInfo: RelayRegisteredEventInfo = {
            relayManager: '',
            relayUrl: ''
        };
        const relayInfo: RelayInfo = {
            pingResponse: pingResponse as PingResponse,
            relayInfo: eventInfo
        };

        let transactionDetails: EnvelopingTransactionDetails = {
            from: this.gasLess,
            to: this.recipient.address,
            data: this.encodedFunction,
            relayHub: this.relayHub.address,
            callVerifier: this.relayVerifier.address,
            callForwarder: this.forwarder.address,
            gasPrice: toHex(60000000),
            tokenAmount: toHex(0),
            tokenGas: toHex(0),
            tokenContract: constants.ZERO_ADDRESS,
            isSmartWalletDeploy: false
        };

        transactionDetails = Object.assign(
            {},
            transactionDetails,
            overrideDetails
        );

        const destinationGas =
            await this.contractInteractor.estimateDestinationContractCallGas(
                this.relayClient.getEstimateGasParams(transactionDetails)
            );
        transactionDetails.gas = toHex(destinationGas);

        return await this.relayClient._prepareRelayHttpRequest(
            relayInfo,
            transactionDetails
        );
    }

    async relayTransaction(
        assertRelayed = true,
        overrideDetails: Partial<EnvelopingTransactionDetails> = {}
    ): Promise<{
        signedTx: PrefixedHexString;
        txHash: PrefixedHexString;
        reqSigHash: PrefixedHexString;
    }> {
        const req = await this.createRelayHttpRequest(overrideDetails);
        const txDetails = await this.relayServer.createRelayTransaction(req);
        const reqSigHash = ethUtils.bufferToHex(
            ethUtils.keccak256(req.metadata.signature)
        );
        if (assertRelayed) {
            await this.assertTransactionRelayed(
                txDetails.transactionHash,
                keccak256(req.metadata.signature)
            );
        }
        return {
            txHash: txDetails.transactionHash,
            signedTx: txDetails.signedTx,
            reqSigHash
        };
    }

    async clearServerStorage(): Promise<void> {
        await this.relayServer.transactionManager.txStoreManager.clearAll();
        assert.deepEqual(
            [],
            await this.relayServer.transactionManager.txStoreManager.getAll()
        );
    }

    async assertTransactionRelayed(
        txHash: string,
        reqSignatureHash: string,
        overrideDetails: Partial<EnvelopingTransactionDetails> = {}
    ): Promise<void> {
        console.debug('overrideDetails', overrideDetails);

        const receipt = await web3.eth.getTransactionReceipt(txHash);
        if (receipt == null) {
            throw new Error('Transaction Receipt not found');
        }
        const decodedLogs = abiDecoder
            .decodeLogs(receipt.logs)
            .map(this.relayServer.registrationManager._parseEvent);
        const event1 = decodedLogs.find(
            (e: { name: string }) => e.name === 'SampleRecipientEmitted'
        );
        assert.exists(
            event1,
            'SampleRecipientEmitted not found, maybe transaction was not relayed successfully'
        );
        assert.equal(event1.args.message, 'hello world');
        const event2 = decodedLogs.find(
            (e: { name: string }) => e.name === 'TransactionRelayed'
        );
        assert.exists(
            event2,
            'TransactionRelayed not found, maybe transaction was not relayed successfully'
        );
        assert.equal(event2.name, 'TransactionRelayed');
        /**
     * event TransactionRelayed(
        address indexed relayManager,
        address relayWorker,
        bytes32 relayRequestSigHash);
    */
        assert.equal(
            event2.args.relayWorker.toLowerCase(),
            this.relayServer.workerAddress.toLowerCase()
        );
        assert.equal(
            event2.args.relayManager.toLowerCase(),
            this.relayServer.managerAddress.toLowerCase()
        );
        assert.equal(event2.args.relayRequestSigHash, reqSignatureHash);
    }
}

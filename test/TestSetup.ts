// @ts-ignore
import io from 'console-read-write';
import BN from 'bn.js';
import HDWalletProvider from '@truffle/hdwallet-provider';
import Web3 from 'web3';
import { Contract, SendOptions } from 'web3-eth-contract';
import { HttpProvider, TransactionReceipt } from 'web3-core';
import { fromWei, toBN } from 'web3-utils';
import { merge } from 'lodash';

// compiled folder populated by "prepublish"
import {
    RelayHub,
    Penalizer,
    DeployVerifier,
    RelayVerifier,
    CustomSmartWalletDeployVerifier,
    SmartWallet,
    SmartWalletFactory,
    CustomSmartWallet,
    CustomSmartWalletFactory,
    VersionRegistry
} from '@rsksmart/rif-relay-contracts';

import {
    ContractInteractor,
    EnvelopingConfig,
    isSameAddress,
    sleep,
    string32,
    constants
} from '@rsksmart/rif-relay-common';
import { RelayHubConfiguration } from '@rsksmart/rif-relay-contracts';
import { HttpClient, HttpWrapper } from '@rsksmart/rif-relay-client';
import { ether } from '@openzeppelin/test-helpers';

interface RegisterOptions {
    from: string;
    gasPrice: string | BN;
    stake: string | BN;
    funds: string | BN;
    relayUrl: string;
    unstakeDelay: string;
}

interface DeployOptions {
    from: string;
    gasPrice: string;
    deployVerifierAddress?: string;
    relayVerifierAddress?: string;
    smartWalletFactoryAddress?: string;
    smartWalletTemplateAddress?: string;
    relayHubAddress?: string;
    penalizerAddress?: string;
    registryAddress?: string;
    customSmartWalletFactoryAddress?: string;
    customSmartWalletTemplateAddress?: string;
    customSmartWalletDeployVerifierAddress?: string;
    customSmartWalletRelayVerifierAddress?: string;
    registryHubId?: string;
    verbose?: boolean;
    skipConfirmation?: boolean;
    relayHubConfiguration: RelayHubConfiguration;
}

export interface DeploymentResult {
    relayHubAddress: string;
    penalizerAddress: string;
    smartWalletTemplateAddress: string;
    smartWalletFactoryAddress: string;
    versionRegistryAddress: string;
    relayVerifierAddress: string;
    deployVerifierAddress: string;
    customSmartWalletTemplateAddress: string;
    customSmartWalletFactoryAddress: string;
    customSmartWalletDeployVerifierAddress: string;
    customSmartWalletRelayVerifierAddress: string;
}

interface RegistrationResult {
    success: boolean;
    transactions?: string[];
    error?: string;
}

export default class TestSetup {
    private readonly contractInteractor: ContractInteractor;
    private readonly httpClient: HttpClient;
    private readonly config: EnvelopingConfig;
    private readonly web3: Web3;

    constructor(host: string, config: EnvelopingConfig, mnemonic?: string) {
        let provider: HttpProvider | HDWalletProvider =
            new Web3.providers.HttpProvider(host);
        if (mnemonic != null) {
            // web3 defines provider type quite narrowly
            provider = new HDWalletProvider(
                mnemonic,
                provider
            ) as unknown as HttpProvider;
        }
        this.httpClient = new HttpClient(new HttpWrapper(), config);
        this.contractInteractor = new ContractInteractor(provider, config);
        this.config = config;
        this.web3 = new Web3(provider);
    }

    async findWealthyAccount(requiredBalance = ether('2')): Promise<string> {
        let accounts: string[] = [];
        try {
            accounts = await this.web3.eth.getAccounts();
            for (const account of accounts) {
                const balance = new BN(await this.web3.eth.getBalance(account));
                if (balance.gte(requiredBalance)) {
                    console.log(`Found funded account ${account}`);
                    return account;
                }
            }
        } catch (error) {
            console.error('Failed to retrieve accounts and balances:', error);
        }
        throw new Error(
            `could not find unlocked account with sufficient balance; all accounts:\n - ${accounts.join(
                '\n - '
            )}`
        );
    }

    async isRelayReady(relayUrl: string): Promise<boolean> {
        const response = await this.httpClient.getPingResponse(relayUrl);
        return response.ready;
    }

    async waitForRelay(relayUrl: string, timeout = 60): Promise<void> {
        console.error(`Will wait up to ${timeout}s for the relay to be ready`);

        const endTime = Date.now() + timeout * 1000;
        while (Date.now() < endTime) {
            let isReady = false;
            try {
                isReady = await this.isRelayReady(relayUrl);
            } catch (e) {
                console.log(e.message);
            }
            if (isReady) {
                return;
            }
            await sleep(3000);
        }
        throw Error(`Relay not ready after ${timeout}s`);
    }

    async registerRelay(options: RegisterOptions): Promise<RegistrationResult> {
        const transactions: string[] = [];
        try {
            console.log(
                `Registering Enveloping relayer at ${options.relayUrl}`
            );

            const response = await this.httpClient
                .getPingResponse(options.relayUrl)
                .catch(() => {
                    throw new Error(
                        'could contact not relayer, is it running?'
                    );
                });
            if (response.ready) {
                return {
                    success: false,
                    error: 'Already registered'
                };
            }

            if (!this.contractInteractor.isInitialized()) {
                await this.contractInteractor.init();
            }

            const chainId = this.contractInteractor.chainId;
            if (response.chainId !== chainId.toString()) {
                throw new Error(
                    `wrong chain-id: Relayer on (${response.chainId}) but our provider is on (${chainId})`
                );
            }

            const relayAddress = response.relayManagerAddress;
            const relayHubAddress =
                this.config.relayHubAddress ?? response.relayHubAddress;
            const relayHub = await this.contractInteractor._createRelayHub(
                relayHubAddress
            );
            const { stake, unstakeDelay, owner } = await relayHub.getStakeInfo(
                relayAddress
            );

            console.log('Current stake info:');
            console.log('Relayer owner: ' + owner);
            console.log('Current unstake delay: ' + unstakeDelay);
            console.log('current stake=', fromWei(stake, 'ether'));

            if (
                owner !== constants.ZERO_ADDRESS &&
                !isSameAddress(owner, options.from)
            ) {
                throw new Error(
                    `Already owned by ${owner}, our account=${options.from}`
                );
            }

            if (
                toBN(unstakeDelay).gte(toBN(options.unstakeDelay)) &&
                toBN(stake).gte(toBN(options.stake.toString()))
            ) {
                console.log('Relayer already staked');
            } else {
                const stakeValue = toBN(options.stake.toString()).sub(
                    toBN(stake)
                );
                console.log(
                    `Staking relayer ${fromWei(stakeValue, 'ether')} RBTC`,
                    stake === '0'
                        ? ''
                        : ` (already has ${fromWei(stake, 'ether')} RBTC)`
                );

                const stakeTx = await relayHub.stakeForAddress(
                    relayAddress,
                    options.unstakeDelay.toString(),
                    {
                        value: stakeValue,
                        from: options.from,
                        gas: 1e6,
                        gasPrice: options.gasPrice
                    }
                );
                transactions.push(stakeTx.tx);
            }

            if (isSameAddress(owner, options.from)) {
                console.log('Relayer already authorized');
            }

            const bal = await this.contractInteractor.getBalance(relayAddress);
            if (toBN(bal).gt(toBN(options.funds.toString()))) {
                console.log('Relayer already funded');
            } else {
                console.log('Funding relayer');

                const _fundTx = await this.web3.eth.sendTransaction({
                    from: options.from,
                    to: relayAddress,
                    value: options.funds,
                    gas: 1e6,
                    gasPrice: options.gasPrice
                });
                const fundTx = _fundTx as TransactionReceipt;
                if (fundTx.transactionHash == null) {
                    return {
                        success: false,
                        error: `Fund transaction reverted: ${JSON.stringify(
                            _fundTx
                        )}`
                    };
                }
                transactions.push(fundTx.transactionHash);
            }

            await this.waitForRelay(options.relayUrl);
            return {
                success: true,
                transactions
            };
        } catch (error) {
            return {
                success: false,
                transactions,
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                error: `Failed to fund relay: '${error}'`
            };
        }
    }

    contract(file: any, address?: string): Contract {
        return new this.web3.eth.Contract(file.abi, address, {
            data: file.bytecode
        });
    }

    async deployContracts(
        deployOptions: DeployOptions
    ): Promise<DeploymentResult> {
        const options: Required<SendOptions> = {
            from: deployOptions.from,
            gas: 0, // gas limit will be filled in at deployment
            value: 0,
            gasPrice: deployOptions.gasPrice ?? (1e9).toString()
        };

        const penalizer = await this.getContract(
            Penalizer,
            {},
            deployOptions.penalizerAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        const smartWallet = await this.getContract(
            SmartWallet,
            {},
            deployOptions.smartWalletTemplateAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );
        const smartWalletFactory = await this.getContract(
            SmartWalletFactory,
            {
                arguments: [smartWallet.options.address]
            },
            deployOptions.smartWalletFactoryAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        const customSmartWallet = await this.getContract(
            CustomSmartWallet,
            {},
            deployOptions.customSmartWalletTemplateAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );
        const customSmartWalletFactory = await this.getContract(
            CustomSmartWalletFactory,
            {
                arguments: [customSmartWallet.options.address]
            },
            deployOptions.customSmartWalletFactoryAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        const rInstance = await this.getContract(
            RelayHub,
            {
                arguments: [
                    penalizer.options.address,
                    deployOptions.relayHubConfiguration.maxWorkerCount,
                    deployOptions.relayHubConfiguration
                        .minimumEntryDepositValue,
                    deployOptions.relayHubConfiguration.minimumUnstakeDelay,
                    deployOptions.relayHubConfiguration.minimumStake
                ]
            },
            deployOptions.relayHubAddress,
            merge({}, options, { gas: 5e6 }),
            deployOptions.skipConfirmation
        );

        const regInstance = await this.getContract(
            VersionRegistry,
            {},
            deployOptions.registryAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );
        if (deployOptions.registryHubId != null) {
            await regInstance.methods
                .addVersion(
                    string32(deployOptions.registryHubId),
                    string32('1'),
                    rInstance.options.address
                )
                .send({ from: deployOptions.from });
            console.log(
                `== Saved RelayHub address at HubId:"${deployOptions.registryHubId}" to VersionRegistry`
            );
        }

        const deployVerifierInstance = await this.getContract(
            DeployVerifier,
            {
                arguments: [smartWalletFactory.options.address]
            },
            deployOptions.deployVerifierAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        const customSmartWalletDeployVerifierInstance = await this.getContract(
            CustomSmartWalletDeployVerifier,
            {
                arguments: [customSmartWalletFactory.options.address]
            },
            deployOptions.customSmartWalletDeployVerifierAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        const relayVerifierInstance = await this.getContract(
            RelayVerifier,
            {
                arguments: [smartWalletFactory.options.address]
            },
            deployOptions.relayVerifierAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        const customSmartWalletRelayVerifierInstance = await this.getContract(
            RelayVerifier,
            {
                arguments: [customSmartWalletFactory.options.address]
            },
            deployOptions.customSmartWalletRelayVerifierAddress,
            Object.assign({}, options),
            deployOptions.skipConfirmation
        );

        // Overriding saved configuration with newly deployed instances
        this.config.relayHubAddress = rInstance.options.address;
        this.config.deployVerifierAddress =
            deployVerifierInstance.options.address;
        this.config.relayVerifierAddress =
            relayVerifierInstance.options.address;
        // this.config.customSmartWalletDeployVerifierAddress = customSmartWalletDeployVerifierInstance.options.address
        // this.config.customSmartWalletRelayVerifierAddress = customSmartWalletRelayVerifierInstance.options.address

        return {
            relayHubAddress: rInstance.options.address,
            penalizerAddress: penalizer.options.address,
            smartWalletTemplateAddress: smartWallet.options.address,
            smartWalletFactoryAddress: smartWalletFactory.options.address,
            versionRegistryAddress: regInstance.options.address,
            relayVerifierAddress: relayVerifierInstance.options.address,
            deployVerifierAddress: deployVerifierInstance.options.address,
            customSmartWalletTemplateAddress: customSmartWallet.options.address,
            customSmartWalletFactoryAddress:
                customSmartWalletFactory.options.address,
            customSmartWalletDeployVerifierAddress:
                customSmartWalletDeployVerifierInstance.options.address,
            customSmartWalletRelayVerifierAddress:
                customSmartWalletRelayVerifierInstance.options.address
        };
    }

    private async getContract(
        json: any,
        constructorArgs: any,
        address: string | undefined,
        options: Required<SendOptions>,
        skipConfirmation = false
    ): Promise<Contract> {
        const contractName: string = json.contractName;
        let contract;
        if (address == null) {
            const sendMethod = this.contract(json).deploy(constructorArgs);
            options.gas = await sendMethod.estimateGas();
            const maxCost = new BN(options.gasPrice).muln(options.gas);
            const oneRBTC = ether('1');
            console.log(
                `Deploying ${contractName} contract with gas limit of ${options.gas.toLocaleString()} and maximum cost of ~ ${
                    maxCost.toNumber() / parseFloat(oneRBTC.toString())
                } RBTC`
            );
            if (!skipConfirmation) {
                await this.confirm();
            }
            const deployPromise = sendMethod.send(merge(options, { gas: 5e6 }));
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            deployPromise.on('transactionHash', function (hash) {
                console.log(`Transaction broadcast: ${hash}`);
            });
            contract = await deployPromise;
            console.log(
                `Deployed ${contractName} at address ${contract.options.address}\n\n`
            );
        } else {
            console.log(
                `Using ${contractName} at given address ${address}\n\n`
            );
            contract = this.contract(json, address);
        }
        return contract;
    }

    async deployVerifier(
        options: Required<SendOptions>,
        skipConfirmation: boolean | undefined
    ): Promise<Contract> {
        const verifier = await this.getContract(
            DeployVerifier,
            {},
            undefined,
            Object.assign({}, options),
            skipConfirmation
        );
        return verifier;
    }

    async confirm(): Promise<void> {
        let input;
        const running = true;
        while (running) {
            console.log('Confirm (yes/no)?');
            input = await io.read();
            if (input === 'yes') {
                return;
            } else if (input === 'no') {
                throw new Error('User rejected');
            }
        }
    }
}

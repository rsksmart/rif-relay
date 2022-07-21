import Web3 from 'web3';
import { HttpProvider } from 'web3-core';
import { toBN } from 'web3-utils';
import { ContractInteractor, constants } from '@rsksmart/rif-relay-common';
import { RelayHubConfiguration } from '@rsksmart/rif-relay-contracts';
import {
    KeyManager,
    TxStoreManager,
    RegistrationManager,
    RelayServer,
    ServerAction,
    ServerConfigParams,
    ServerDependencies
} from '@rsksmart/rif-relay-server';
import { configure } from '@rsksmart/rif-relay-client';
import { evmMine, evmMineMany, revert, snapshot } from '../TestUtils';
import { LocalhostOne, ServerTestEnvironment } from './ServerTestEnvironment';
import {
    assertRelayAdded,
    getTemporaryWorkdirs,
    getTotalTxCosts,
    ServerWorkdirs
} from './ServerTestUtils';
import { ether } from '@openzeppelin/test-helpers';

const { oneEther } = constants;

const workerIndex = 0;

const unstakeDelay = 50;

const maxWorkerCount = 1;
const minimumEntryDepositValue = ether('1').toString();
const minimumStake = ether('1').toString();
const minimumUnstakeDelay = 50;

const hubConfig: Partial<RelayHubConfiguration> = {
    maxWorkerCount,
    minimumEntryDepositValue,
    minimumStake,
    minimumUnstakeDelay
};

contract('RegistrationManager', function (accounts) {
    const relayOwner = accounts[4];

    let env: ServerTestEnvironment;
    let relayServer: RelayServer;
    let id: string;
    let serverWorkdirs: ServerWorkdirs;

    before(async function () {
        serverWorkdirs = getTemporaryWorkdirs();
        env = new ServerTestEnvironment(
            web3.currentProvider as HttpProvider,
            accounts
        );

        await env.init({}, hubConfig);
        env.newServerInstanceNoFunding({}, serverWorkdirs);
        await env.clearServerStorage();
        relayServer = env.relayServer;
    });

    // When running server before staking/funding it, or when balance gets too low
    describe('multi-step server initialization', function () {
        // TODO: It does not make sense for the '_worker' method to expose the reason it does not register
        //       This means these 2 tests cannot check what they used to and require refactoring.
        it('should wait for balance', async function () {
            let latestBlock = await env.web3.eth.getBlock('latest');
            let transactionHashes = await relayServer._worker(
                latestBlock.number
            );
            assert.equal(transactionHashes.length, 0);
            const expectedBalance = env.web3.utils.toWei('2', 'ether');
            assert.notEqual(
                (await relayServer.getManagerBalance()).cmp(
                    toBN(expectedBalance)
                ),
                0
            );
            await env.web3.eth.sendTransaction({
                to: relayServer.managerAddress,
                from: relayOwner,
                value: expectedBalance
            });
            latestBlock = await env.web3.eth.getBlock('latest');
            transactionHashes = await relayServer._worker(latestBlock.number);
            assert.equal(transactionHashes.length, 0);
            assert.equal(
                relayServer.isReady(),
                false,
                'relay should not be ready yet'
            );
            assert.equal(
                (await relayServer.getManagerBalance()).cmp(
                    toBN(expectedBalance)
                ),
                0
            );
            await evmMine();
        });

        it('should wait for stake and fund workers', async function () {
            let latestBlock = await env.web3.eth.getBlock('latest');
            const transactionHashes = await relayServer._worker(
                latestBlock.number
            );
            assert.equal(transactionHashes.length, 0);
            assert.equal(
                relayServer.isReady(),
                false,
                'relay should not be ready yet'
            );
            const res = await env.relayHub.stakeForAddress(
                relayServer.managerAddress,
                unstakeDelay,
                {
                    from: relayOwner,
                    value: oneEther
                }
            );
            assert.ok(res.receipt.status, 'stake failed');
            const workerBalanceBefore = await relayServer.getWorkerBalance(
                workerIndex
            );
            assert.equal(workerBalanceBefore.toString(), '0');
            latestBlock = await env.web3.eth.getBlock('latest');
            const receipts = await relayServer._worker(latestBlock.number);
            await relayServer._worker(latestBlock.number + 1);
            const workerBalanceAfter = await relayServer.getWorkerBalance(
                workerIndex
            );
            assert.equal(relayServer.lastScannedBlock, latestBlock.number + 1);
            assert.isTrue(
                relayServer.registrationManager.stakeRequired.currentValue.eq(
                    oneEther
                )
            );
            assert.equal(
                relayServer.registrationManager.ownerAddress,
                relayOwner
            );
            assert.equal(
                workerBalanceAfter.toString(),
                relayServer.config.workerTargetBalance.toString()
            );
            assert.equal(relayServer.isReady(), true, 'relay not ready?');
            await assertRelayAdded(receipts, relayServer);
        });

        it('should start again after restarting process', async () => {
            const managerKeyManager = new KeyManager(
                1,
                serverWorkdirs.managerWorkdir
            );
            const workersKeyManager = new KeyManager(
                1,
                serverWorkdirs.workersWorkdir
            );
            const txStoreManager = new TxStoreManager({
                workdir: serverWorkdirs.workdir
            });
            const serverWeb3provider = new Web3.providers.HttpProvider(
                (web3.currentProvider as HttpProvider).host
            );
            const contractInteractor = new ContractInteractor(
                serverWeb3provider,
                configure({
                    relayHubAddress: env.relayHub.address
                })
            );
            await contractInteractor.init();
            const serverDependencies: ServerDependencies = {
                txStoreManager,
                managerKeyManager,
                workersKeyManager,
                contractInteractor
            };
            const params: Partial<ServerConfigParams> = {
                relayHubAddress: env.relayHub.address,
                url: LocalhostOne,
                logLevel: 5,
                gasPriceFactor: 1,
                checkInterval: 10
            };
            const newRelayServer = new RelayServer(params, serverDependencies);
            await newRelayServer.init();
            const latestBlock = await env.web3.eth.getBlock('latest');
            await newRelayServer._worker(latestBlock.number);
            assert.equal(relayServer.isReady(), true, 'relay not ready?');
        });
    });

    // When running server after both staking & funding it
    describe('single step server initialization', function () {
        beforeEach(async function () {
            id = (await snapshot()).result;
        });

        afterEach(async function () {
            await revert(id);
        });

        let newServer: RelayServer;
        it('should initialize relay after staking and funding it', async function () {
            await env.newServerInstanceNoInit({}, undefined, unstakeDelay);
            newServer = env.relayServer;
            await newServer.init();
            assert.equal(newServer.registrationManager.ownerAddress, undefined);
            await newServer.registrationManager.refreshStake();
            assert.isTrue(
                newServer.registrationManager.stakeRequired.currentValue.eq(
                    oneEther
                )
            );
            assert.equal(
                newServer.registrationManager.ownerAddress,
                relayOwner,
                'owner should be set after refreshing stake'
            );

            const expectedGasPrice =
                parseInt(await env.web3.eth.getGasPrice()) *
                newServer.config.gasPriceFactor;
            assert.equal(newServer.isReady(), false);
            assert.equal(newServer.lastScannedBlock, 0);
            const workerBalanceBefore = await newServer.getWorkerBalance(
                workerIndex
            );
            assert.equal(workerBalanceBefore.toString(), '0');
            const latestBlock = await env.web3.eth.getBlock('latest');
            const receipts = await newServer._worker(latestBlock.number);
            await newServer._worker(latestBlock.number + 1);
            assert.equal(newServer.lastScannedBlock, latestBlock.number + 1);
            assert.equal(newServer.gasPrice, expectedGasPrice);
            assert.equal(newServer.isReady(), true, 'relay no ready?');
            const workerBalanceAfter = await newServer.getWorkerBalance(
                workerIndex
            );
            assert.isTrue(
                newServer.registrationManager.stakeRequired.currentValue.eq(
                    oneEther
                )
            );
            assert.equal(
                newServer.registrationManager.ownerAddress,
                relayOwner
            );
            assert.equal(
                workerBalanceAfter.toString(),
                newServer.config.workerTargetBalance.toString()
            );
            await assertRelayAdded(receipts, newServer);
        });

        after('txstore cleanup', async function () {
            await newServer.transactionManager.txStoreManager.clearAll();
            assert.deepEqual(
                [],
                await newServer.transactionManager.txStoreManager.getAll()
            );
        });
    });

    describe('configuration change', function () {
        let relayServer: RelayServer;

        before(async function () {
            await env.newServerInstanceNoInit(
                { refreshStateTimeoutBlocks: 1 },
                undefined,
                unstakeDelay
            );
            relayServer = env.relayServer;
        });

        // TODO: separate this into 2 unit tests for 'isRegistrationValid' and 1 test for 'handlePastEvents'
        it('should re-register server with new configuration', async function () {
            let latestBlock = await env.web3.eth.getBlock('latest');
            const receipts = await relayServer._worker(latestBlock.number);
            await assertRelayAdded(receipts, relayServer);
            await relayServer._worker(latestBlock.number + 1);

            let transactionHashes =
                await relayServer.registrationManager.handlePastEvents(
                    [],
                    latestBlock.number,
                    0,
                    false
                );
            assert.equal(
                transactionHashes.length,
                0,
                'should not re-register if already registered'
            );

            latestBlock = await env.web3.eth.getBlock('latest');
            await relayServer._worker(latestBlock.number);

            relayServer.config.url = 'fakeUrl';
            transactionHashes =
                await relayServer.registrationManager.handlePastEvents(
                    [],
                    latestBlock.number,
                    0,
                    false
                );
            await assertRelayAdded(transactionHashes, relayServer, false);
        });
    });

    describe('event handlers', function () {
        describe('Withdrawn event', function () {
            async function assertSendBalancesToOwner(
                server: RelayServer,
                managerBalanceBefore: BN,
                workerBalanceBefore: BN
            ): Promise<void> {
                const gasPrice = await env.web3.eth.getGasPrice();
                const ownerBalanceBefore = toBN(
                    await env.web3.eth.getBalance(
                        newServer.registrationManager.ownerAddress
                    )
                );
                assert.equal(
                    newServer.registrationManager.stakeRequired.currentValue.toString(),
                    oneEther.toString()
                );
                // TODO: assert on withdrawal block?
                // assert.equal(newServer.config.withdrawBlock?.toString(), '0')
                const latestBlock = await env.web3.eth.getBlock('latest');
                const receipts = await newServer._worker(latestBlock.number);
                const totalTxCosts = await getTotalTxCosts(receipts, gasPrice);
                const ownerBalanceAfter = toBN(
                    await env.web3.eth.getBalance(
                        newServer.registrationManager.ownerAddress
                    )
                );
                assert.equal(
                    ownerBalanceAfter.sub(ownerBalanceBefore).toString(),
                    managerBalanceBefore
                        .add(workerBalanceBefore)
                        .sub(totalTxCosts)
                        .toString(),
                    `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) !=
          + managerBalanceBefore(${managerBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
         - totalTxCosts(${totalTxCosts.toString()})`
                );
                const managerBalanceAfter = await newServer.getManagerBalance();
                const workerBalanceAfter = await newServer.getWorkerBalance(
                    workerIndex
                );
                assert.isTrue(managerBalanceAfter.eqn(0));
                assert.isTrue(workerBalanceAfter.eqn(0));
                // TODO
                // assert.isTrue(newServer.withdrawBlock?.gtn(0))
            }

            let newServer: RelayServer;
            beforeEach(async function () {
                id = (await snapshot()).result;
                await env.newServerInstanceNoInit(
                    { refreshStateTimeoutBlocks: 1 },
                    undefined,
                    unstakeDelay
                );
                newServer = env.relayServer;
                const latestBlock = await env.web3.eth.getBlock('latest');
                await newServer._worker(latestBlock.number);
                await newServer._worker(latestBlock.number + 1);
                await env.relayHub.unlockStake(newServer.managerAddress, {
                    from: relayOwner
                });
                await evmMineMany(unstakeDelay);
                await env.relayHub.withdrawStake(newServer.managerAddress, {
                    from: relayOwner
                });
            });

            afterEach(async function () {
                await revert(id);
            });

            it('send balances to owner when all balances > tx costs', async function () {
                const managerBalanceBefore =
                    await newServer.getManagerBalance();
                const workerBalanceBefore = await newServer.getWorkerBalance(
                    workerIndex
                );
                assert.isTrue(managerBalanceBefore.gtn(0));
                assert.isTrue(workerBalanceBefore.gtn(0));
                await assertSendBalancesToOwner(
                    newServer,
                    managerBalanceBefore,
                    workerBalanceBefore
                );
            });
        });

        describe('HubUnauthorized event', function () {
            let newServer: RelayServer;
            beforeEach(async function () {
                id = (await snapshot()).result;
                await env.newServerInstanceNoInit(
                    { refreshStateTimeoutBlocks: 1 },
                    undefined,
                    unstakeDelay
                );
                newServer = env.relayServer;
                const latestBlock = await env.web3.eth.getBlock('latest');
                await newServer._worker(latestBlock.number);
                await newServer._worker(latestBlock.number + 1);
            });

            afterEach(async function () {
                await revert(id);
            });

            it('should not send balance immediately after unauthorize (before unstake delay)', async function () {
                const workerBalanceBefore = await newServer.getWorkerBalance(
                    workerIndex
                );

                await evmMineMany(unstakeDelay - 3);
                const latestBlock = await env.web3.eth.getBlock('latest');

                const receipt = await newServer._worker(latestBlock.number);
                const receipt2 = await newServer._worker(
                    latestBlock.number + 1
                );

                assert.equal(receipt.length, 0);
                assert.equal(receipt2.length, 0);
                assert.equal(
                    workerBalanceBefore.toString(),
                    await newServer
                        .getWorkerBalance(workerIndex)
                        .then((b) => b.toString())
                );
            });

            it("send only workers' balances to owner (not manager hub, rbtc balance) - after unstake delay", async function () {
                await env.relayHub.unlockStake(newServer.managerAddress, {
                    from: relayOwner
                });

                const managerBalanceBefore =
                    await newServer.getManagerBalance();
                const workerBalanceBefore = await newServer.getWorkerBalance(
                    workerIndex
                );
                assert.isTrue(managerBalanceBefore.gtn(0));
                assert.isTrue(workerBalanceBefore.gtn(0));

                const ownerBalanceBefore = toBN(
                    await env.web3.eth.getBalance(relayOwner)
                );

                await evmMineMany(unstakeDelay);

                const latestBlock = await env.web3.eth.getBlock('latest');

                const receipts = await newServer._worker(latestBlock.number);

                const gasPrice = await env.web3.eth.getGasPrice();

                // TODO: these two hard-coded indexes are dependent on the order of operations in 'withdrawAllFunds'
                const workerEthTxCost = await getTotalTxCosts(
                    [receipts[0]],
                    gasPrice
                );

                const ownerBalanceAfter = toBN(
                    await env.web3.eth.getBalance(relayOwner)
                );

                const managerBalanceAfter = await newServer.getManagerBalance();

                const workerBalanceAfter = await newServer.getWorkerBalance(
                    workerIndex
                );

                assert.isTrue(workerBalanceAfter.eqn(0));
                assert.equal(
                    managerBalanceAfter.toString(),
                    managerBalanceBefore.toString()
                );
                assert.equal(
                    ownerBalanceAfter.sub(ownerBalanceBefore).toString(),
                    workerBalanceBefore.sub(workerEthTxCost).toString(),
                    `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) != 
          + workerBalanceBefore(${workerBalanceBefore.toString()})
         - workerEthTxCost(${workerEthTxCost.toString()})`
                );
            });
        });

        it('_handleStakedEvent');
    });

    describe('#_extractDuePendingEvents', () => {
        let rm: RegistrationManager;
        let extracted: any[];

        before(async () => {
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (!relayServer.initialized) {
                await relayServer.init();
            }

            rm = relayServer.registrationManager;

            (rm as any).delayedEvents = [
                { block: 1, eventData: 'event1' },
                { block: 2, eventData: 'event2' },
                { block: 3, eventData: 'event3' }
            ];
            extracted = rm._extractDuePendingEvents(2) as any;
        });
        it('should extract events which are due (lower or equal block number)', function () {
            assert.deepEqual(extracted, ['event1', 'event2']);
        });

        it('should leave future events in the delayedEvents list', function () {
            assert.deepEqual((rm as any).delayedEvents, [
                { block: 3, eventData: 'event3' }
            ]);
        });
    });

    describe('#attemptRegistration()', function () {
        let newServer: RelayServer;

        describe('without re-registration', function () {
            beforeEach(async function () {
                id = (await snapshot()).result;
                await env.newServerInstanceNoInit({}, undefined, unstakeDelay);
                await env.relayServer.init();
                newServer = env.relayServer;
                // TODO: this is horrible!!!
                newServer.registrationManager.isStakeLocked = true;
                newServer.registrationManager.stakeRequired.requiredValue =
                    toBN(0);
                newServer.registrationManager.balanceRequired.requiredValue =
                    toBN(0);
                await newServer.registrationManager.refreshStake();
                assert.isTrue(
                    newServer.registrationManager.stakeRequired.currentValue.eq(
                        oneEther
                    )
                );
                assert.equal(
                    newServer.registrationManager.ownerAddress,
                    relayOwner,
                    'owner should be set after refreshing stake'
                );
                assert.equal(newServer.config.registrationBlockRate, 0);
            });

            afterEach(async function () {
                await revert(id);
            });

            it('should register server and add workers', async function () {
                assert.equal(
                    (await newServer.txStoreManager.getAll()).length,
                    0
                );
                const receipts =
                    await newServer.registrationManager.attemptRegistration(0);
                await assertRelayAdded(receipts, newServer);
                const pendingTransactions =
                    await newServer.txStoreManager.getAll();
                assert.equal(pendingTransactions.length, 2);
                assert.equal(
                    pendingTransactions[0].serverAction,
                    ServerAction.ADD_WORKER
                );
                assert.equal(
                    pendingTransactions[1].serverAction,
                    ServerAction.REGISTER_SERVER
                );
            });
        });
    });

    // note: relies on first 'before' to initialize server
    describe('#assertRegistered()', function () {
        before(function () {
            relayServer.registrationManager.stakeRequired._requiredValue =
                toBN(1e20);
        });

        it('should return false if the stake requirement is not satisfied', async function () {
            const isRegistered =
                await relayServer.registrationManager.isRegistered();
            assert.isFalse(isRegistered);
        });
    });
});

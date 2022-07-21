import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
import { RelayHubConfiguration } from '@rsksmart/rif-relay-contracts';

import {
    PenalizerInstance,
    RelayHubInstance
} from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import { deployHub } from './TestUtils';

const Penalizer = artifacts.require('Penalizer');

contract(
    'RelayHub Relay Management',
    function ([
        _,
        relayOwner,
        relayManager,
        relayWorker1,
        relayWorker2,
        relayWorker3
    ]) {
        const relayUrl = 'http://new-relay.com';

        console.debug('Unknown', _);

        let relayHub: RelayHubInstance;
        let penalizer: PenalizerInstance;

        const maxWorkerCount = 3;
        const minimumEntryDepositValue = ether('1').toString();
        const minimumStake = ether('1').toString();
        const minimumUnstakeDelay = 50;

        const hubConfig: Partial<RelayHubConfiguration> = {
            maxWorkerCount,
            minimumEntryDepositValue,
            minimumStake,
            minimumUnstakeDelay
        };

        beforeEach(async function () {
            penalizer = await Penalizer.new();
            relayHub = await deployHub(penalizer.address, hubConfig);
        });

        context('without stake for relayManager', function () {
            it('should not allow relayManager to add relay workers', async function () {
                await expectRevert(
                    relayHub.addRelayWorkers([relayWorker1], {
                        from: relayManager
                    }),
                    'RelayManager not staked'
                );
            });
            context('after stake unlocked for relayManager', function () {
                beforeEach(async function () {
                    await relayHub.stakeForAddress(relayManager, 2000, {
                        value: ether('2'),
                        from: relayOwner
                    });
                    await relayHub.addRelayWorkers([relayWorker1], {
                        from: relayManager
                    });
                    await relayHub.unlockStake(relayManager, {
                        from: relayOwner
                    });
                });

                it('should not allow relayManager to register a relay server', async function () {
                    await expectRevert(
                        relayHub.registerRelayServer(relayUrl, {
                            from: relayManager
                        }),
                        'RelayManager not staked'
                    );
                });
            });
        });

        context(
            'with stake for relayManager and no active workers added',
            function () {
                beforeEach(async function () {
                    await relayHub.stakeForAddress(relayManager, 2000, {
                        value: ether('2'),
                        from: relayOwner
                    });
                });

                it('should not allow relayManager to register a relay server', async function () {
                    await expectRevert(
                        relayHub.registerRelayServer(relayUrl, {
                            from: relayManager
                        }),
                        'no relay workers'
                    );
                });

                it('should allow relayManager to add multiple workers', async function () {
                    const newRelayWorkers = [
                        relayWorker1,
                        relayWorker2,
                        relayWorker3
                    ];
                    const { logs } = await relayHub.addRelayWorkers(
                        newRelayWorkers,
                        {
                            from: relayManager
                        }
                    );
                    expectEvent.inLogs(logs, 'RelayWorkersAdded', {
                        relayManager,
                        newRelayWorkers,
                        workersCount: '3'
                    });
                });

                it('should not allow relayManager to register already registered workers', async function () {
                    await relayHub.addRelayWorkers([relayWorker1], {
                        from: relayManager
                    });
                    await expectRevert(
                        relayHub.addRelayWorkers([relayWorker1], {
                            from: relayManager
                        }),
                        'this worker has a manager'
                    );
                });
            }
        );

        context(
            'with stake for relay manager and active relay workers',
            function () {
                beforeEach(async function () {
                    await relayHub.stakeForAddress(relayManager, 2000, {
                        value: ether('2'),
                        from: relayOwner
                    });
                    await relayHub.addRelayWorkers([relayWorker1], {
                        from: relayManager
                    });
                });

                it('should not allow relayManager to exceed allowed number of workers', async function () {
                    const newRelayWorkers = [];
                    for (let i = 0; i < 11; i++) {
                        newRelayWorkers.push(relayWorker1);
                    }
                    await expectRevert(
                        relayHub.addRelayWorkers(newRelayWorkers, {
                            from: relayManager
                        }),
                        'too many workers'
                    );
                });

                it('should allow relayManager to update transaction fee and url', async function () {
                    const { logs } = await relayHub.registerRelayServer(
                        relayUrl,
                        {
                            from: relayManager
                        }
                    );
                    expectEvent.inLogs(logs, 'RelayServerRegistered', {
                        relayManager,
                        relayUrl
                    });
                });
            }
        );
    }
);

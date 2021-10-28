import chaiAsPromised from 'chai-as-promised';
import sinon, { SinonStub } from 'sinon';
import { HttpProvider } from 'web3-core';
import {
    configure,
    EnvelopingDependencies,
    GasPricePingFilter,
    getDependencies,
    PartialRelayInfo,
    PingFilter,
    RelaySelectionManager
} from '@rsksmart/rif-relay-client';
import { register, stake } from './KnownRelaysManager.test';
import {
    constants,
    EnvelopingTransactionDetails,
    PingResponse,
    RelayManagerData
} from '@rsksmart/rif-relay-common';
import { deployHub, getTestingEnvironment } from '../TestUtils';

import * as chai from 'chai';

const { expect, assert } = chai.use(chaiAsPromised);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
contract('RelaySelectionManager', async function (accounts) {
    const sliceSize = 3;
    const dependencyTree = getDependencies(
        configure({}),
        web3.currentProvider as HttpProvider
    );
    const stubGetRelaysSorted = sinon.stub(
        dependencyTree.knownRelaysManager,
        'getRelaysSortedForTransaction'
    );
    const stubGetActiveRelays = sinon.stub(
        dependencyTree.contractInteractor,
        'getActiveRelayInfo'
    );
    const stubGetRelayData = sinon.stub(
        dependencyTree.contractInteractor,
        'getRelayInfo'
    );
    const errors = new Map<string, Error>();
    const config = configure({
        sliceSize,
        chainId: (await getTestingEnvironment()).chainId
    });
    const relayInfo = {
        manager: '',
        url: '',
        currentlyStaked: true,
        registered: false
    };
    const pingResponse = {
        relayWorkerAddress: '',
        relayManagerAddress: '',
        relayHubAddress: '',
        minGasPrice: '1',
        ready: true,
        version: '1'
    };
    const winner = {
        pingResponse,
        relayInfo
    };
    const transactionDetails: EnvelopingTransactionDetails = {
        from: '',
        data: '',
        to: '',
        callForwarder: '',
        callVerifier: '',
        tokenAmount: '',
        tokenGas: '',
        tokenContract: '',
        isSmartWalletDeploy: false
    };

    let stubPingResponse: SinonStub;
    describe('#selectNextRelay()', function () {
        let relaySelectionManager: RelaySelectionManager;
        let stubRaceToSuccess: SinonStub;
        let stubGetNextSlice: SinonStub;

        before(async function () {
            stubGetActiveRelays.returns(Promise.resolve([relayInfo]));
            stubGetRelayData.returns(Promise.resolve([relayInfo]));
            stubGetRelaysSorted.returns(Promise.resolve([[relayInfo]]));
            relaySelectionManager = await new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                GasPricePingFilter,
                config
            ).init();
            stubRaceToSuccess = sinon.stub(
                relaySelectionManager,
                '_raceToSuccess'
            );
            stubGetNextSlice = sinon.stub(
                relaySelectionManager,
                '_getNextSlice'
            );
            // unless this is stubbed, promises will not be handled and exception will be thrown somewhere
            // @ts-ignore
            sinon
                .stub(relaySelectionManager, '_getRelayAddressPing')
                .returns(Promise.resolve(winner));
        });

        afterEach(function () {
            stubGetNextSlice.reset();
            stubRaceToSuccess.reset();
        });

        it('should return the first relay to ping', async function () {
            stubGetNextSlice.returns([relayInfo]);
            stubRaceToSuccess
                .onFirstCall()
                .returns(Promise.resolve({ errors }))
                .onSecondCall()
                .returns(
                    Promise.resolve({
                        winner,
                        errors
                    })
                );
            const nextRelay = await relaySelectionManager.selectNextRelay();
            assert.deepStrictEqual(nextRelay, winner);
        });

        describe('with preferred relay URL', function () {
            const preferredRelayUrl = 'preferredRelayUrl';
            const relayManager = accounts[1];
            let relaySelectionManager: RelaySelectionManager;
            let stubRaceToSuccess: SinonStub;
            let stubGetNextSlice: SinonStub;
            let relayHub: any;
            let dependencyTree: EnvelopingDependencies;
            let chainId: number;

            before(async function () {
                chainId = (await getTestingEnvironment()).chainId;
                relayHub = await deployHub(constants.ZERO_ADDRESS);
                await stake(relayHub, relayManager, accounts[0]);
                await register(
                    relayHub,
                    relayManager,
                    accounts[2],
                    preferredRelayUrl
                );

                const config = configure({
                    relayHubAddress: relayHub.address,
                    chainId
                });
                dependencyTree = getDependencies(
                    config,
                    web3.currentProvider as HttpProvider
                );
                await dependencyTree.contractInteractor.init();

                relaySelectionManager = await new RelaySelectionManager(
                    transactionDetails,
                    dependencyTree.knownRelaysManager,
                    dependencyTree.httpClient,
                    GasPricePingFilter,
                    config
                ).init();
                stubRaceToSuccess = sinon.stub(
                    relaySelectionManager,
                    '_raceToSuccess'
                );
                stubGetNextSlice = sinon.stub(
                    relaySelectionManager,
                    '_getNextSlice'
                );
            });

            it('should fill in the details if the relay was known only by URL', async function () {
                const relayInfo: RelayManagerData = Object.assign({} as any, {
                    url: preferredRelayUrl
                });
                const pingResponse: PingResponse = {
                    relayWorkerAddress: relayManager,
                    relayManagerAddress: relayManager,
                    relayHubAddress: relayManager,
                    minGasPrice: '1',
                    ready: true,
                    version: ''
                };
                const winner: PartialRelayInfo = {
                    pingResponse,
                    relayInfo
                };

                stubGetNextSlice.returns([relayInfo]);
                stubRaceToSuccess.returns(
                    Promise.resolve({
                        winner,
                        errors
                    })
                );
                stubGetRelaysSorted.returns(Promise.resolve([[relayInfo]]));
                const nextRelay = await relaySelectionManager.selectNextRelay();
                assert.equal(nextRelay.relayInfo.url, preferredRelayUrl);
                assert.equal(nextRelay.relayInfo.manager, relayManager);
            });
        });

        it('should return null if no relay could ping', async function () {
            stubGetNextSlice
                .onFirstCall()
                .returns([relayInfo])
                .onSecondCall()
                .returns([]);
            stubRaceToSuccess.returns(Promise.resolve({ errors }));
            const nextRelay = await relaySelectionManager.selectNextRelay();
            assert.isUndefined(nextRelay);
        });
    });

    describe('#_getNextSlice()', function () {
        it("should return 'relaySliceSize' relays if available on the highest priority level", async function () {
            stubGetRelaysSorted.returns(
                Promise.resolve([
                    [
                        winner.relayInfo,
                        winner.relayInfo,
                        winner.relayInfo,
                        winner.relayInfo,
                        winner.relayInfo
                    ]
                ])
            );
            for (let i = 1; i < 5; i++) {
                const rsm = await new RelaySelectionManager(
                    transactionDetails,
                    dependencyTree.knownRelaysManager,
                    dependencyTree.httpClient,
                    GasPricePingFilter,
                    configure({
                        sliceSize: i,
                        chainId: (await getTestingEnvironment()).chainId
                    })
                ).init();
                const returned = await rsm._getNextSlice();
                assert.equal(returned.length, i);
            }
        });

        it("should return all remaining relays if less then 'relaySliceSize' remains on current priority level", async function () {
            const relaysLeft = [[winner.relayInfo, winner.relayInfo]];
            stubGetRelaysSorted.returns(Promise.resolve(relaysLeft));
            const rsm = await new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                GasPricePingFilter,
                configure({
                    sliceSize: 7,
                    chainId: (await getTestingEnvironment()).chainId
                })
            ).init();
            const returned = await rsm._getNextSlice();
            assert.deepEqual(returned, relaysLeft[0]);
        });

        it('should start returning relays from lower priority level if higher level is empty', async function () {
            // Create stub array of distinct relay URLs (URL is used as mapping key)
            const relayInfoGenerator = (
                e: RelayManagerData,
                i: number,
                a: RelayManagerData[]
            ): RelayManagerData => {
                return {
                    ...e,
                    url: `relay ${i} of ${a.length}`
                };
            };

            const relaysLeft = [
                Array(2).fill(winner).map(relayInfoGenerator),
                Array(3).fill(winner).map(relayInfoGenerator)
            ];
            stubGetRelaysSorted.returns(Promise.resolve(relaysLeft));
            const rsm = await new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                GasPricePingFilter,
                configure({
                    sliceSize: 7,
                    chainId: (await getTestingEnvironment()).chainId
                })
            ).init();
            // Initial request only returns the top preference relays
            const returned1 = await rsm._getNextSlice();
            assert.equal(returned1.length, 2);
            // Pretend all relays failed to ping
            let errors = new Map(
                returned1.map((info) => [info.url, new Error('fake error')])
            );
            rsm._handleRaceResults({ errors });
            const returned2 = await rsm._getNextSlice();
            assert.equal(returned2.length, 3);
            errors = new Map(
                returned2.map((info) => [info.url, new Error('fake error')])
            );
            rsm._handleRaceResults({ errors });
            const returned3 = await rsm._getNextSlice();
            assert.equal(returned3.length, 0);
        });
    });

    describe('#_getRelayAddressPing()', function () {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const emptyFilter: PingFilter = (): void => {};

        before(function () {
            stubPingResponse = sinon.stub(
                dependencyTree.httpClient,
                'getPingResponse'
            );
        });

        it('should throw if the relay is not ready', async function () {
            stubPingResponse.returns(
                Promise.resolve(
                    Object.assign({}, pingResponse, { ready: false })
                )
            );
            const rsm = new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                emptyFilter,
                config
            );
            const promise = rsm._getRelayAddressPing(relayInfo);
            await expect(promise).to.be.eventually.rejectedWith(
                'Relay not ready'
            );
        });

        // TODO: change the way filtering is implemented
        it('should call filter and not catch exceptions in it', async function () {
            const message = 'Filter Error Message';
            const filter: PingFilter = (): void => {
                throw new Error(message);
            };
            stubPingResponse.returns(Promise.resolve(pingResponse));
            const rsm = new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                filter,
                config
            );
            const promise = rsm._getRelayAddressPing(relayInfo);
            await expect(promise).to.be.eventually.rejectedWith(message);
        });

        it('should return the relay info if it pinged as ready and passed filter successfully', async function () {
            stubPingResponse.returns(Promise.resolve(pingResponse));
            const rsm = new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                emptyFilter,
                config
            );
            const info = await rsm._getRelayAddressPing(relayInfo);
            assert.deepEqual(info, winner);
        });
    });

    describe('#_raceToSuccess()', function () {
        // Note that promises must be created and passed to the 'raceToSuccess' in the same, synchronous block.
        // Otherwise, rejections will not be handled and mocha will crash.
        it('only first to resolve and all that rejected by that time', async function () {
            const slowRelay = {
                pingResponse,
                relayData: Object.assign({}, relayInfo, { url: 'slowRelay' })
            };
            const fastRelay = {
                pingResponse,
                relayData: Object.assign({}, relayInfo, { url: 'fastRelay' })
            };
            const fastFailRelay = {
                pingResponse,
                relayData: Object.assign({}, relayInfo, {
                    url: 'fastFailRelay'
                })
            };
            const slowFailRelay = {
                pingResponse,
                relayData: Object.assign({}, relayInfo, {
                    url: 'slowFailRelay'
                })
            };
            const slowPromise = new Promise<PingResponse>((resolve) => {
                setTimeout(() => {
                    resolve(pingResponse);
                }, 1500);
            });
            const fastPromise = new Promise<PingResponse>((resolve) => {
                setTimeout(() => {
                    resolve(pingResponse);
                }, 300);
            });
            const fastFailPromise = new Promise<PingResponse>(
                (resolve, reject) => {
                    setTimeout(() => {
                        reject(new Error(fastFailedMessage));
                    }, 180);
                }
            );
            const slowFailPromise = new Promise<PingResponse>(
                (resolve, reject) => {
                    setTimeout(() => {
                        reject(new Error(slowFailedMessage));
                    }, 1800);
                }
            );
            const fastFailedMessage = 'Fast Failed Promise';
            const slowFailedMessage = 'Slow Failed Promise';
            const relays = [
                slowRelay.relayData,
                fastRelay.relayData,
                slowFailRelay.relayData,
                fastFailRelay.relayData
            ];
            stubPingResponse.callsFake(
                async (relayUrl: string): Promise<PingResponse> => {
                    switch (relayUrl) {
                        case slowRelay.relayData.url:
                            return await slowPromise;
                        case fastRelay.relayData.url:
                            return await fastPromise;
                        case slowFailRelay.relayData.url:
                            return await slowFailPromise;
                        case fastFailRelay.relayData.url:
                            return await fastFailPromise;
                    }
                    throw new Error('Non test relay pinged');
                }
            );
            const rsm = new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                GasPricePingFilter,
                config
            );
            const raceResults = await rsm._raceToSuccess(relays);
            assert.equal(raceResults.winner?.relayInfo.url, 'fastRelay');
            assert.equal(raceResults.errors.size, 1);
            assert.equal(
                raceResults.errors.get('fastFailRelay')?.message,
                fastFailedMessage
            );
        });
    });

    describe('#_handleRaceResults()', function () {
        const winnerRelayUrl = 'winnerRelayUrl';
        const failureRelayUrl = 'failureRelayUrl';
        const otherRelayUrl = 'otherRelayUrl';
        const winner = {
            pingResponse,
            relayInfo: Object.assign({}, relayInfo, { url: winnerRelayUrl })
        };
        const message = 'some failure message';
        const failureRelayEventInfo = Object.assign({}, relayInfo, {
            url: failureRelayUrl
        });
        const otherRelayEventInfo = Object.assign({}, relayInfo, {
            url: otherRelayUrl
        });
        it('should remove all relays featured in race results', async function () {
            sinon.stub(dependencyTree.knownRelaysManager, 'refresh');
            stubGetRelaysSorted.returns(
                Promise.resolve([
                    [
                        winner.relayInfo,
                        failureRelayEventInfo,
                        otherRelayEventInfo
                    ]
                ])
            );
            const rsm = await new RelaySelectionManager(
                transactionDetails,
                dependencyTree.knownRelaysManager,
                dependencyTree.httpClient,
                GasPricePingFilter,
                config
            ).init();
            // initialize 'remainingRelays' field by calling '_getNextSlice'
            await rsm._getNextSlice();
            const errors = new Map<string, Error>();
            errors.set(failureRelayUrl, new Error(message));
            const raceResults = {
                winner,
                errors
            };
            // @ts-ignore
            let remainingRelays = rsm.remainingRelays;
            assert.equal(remainingRelays?.length, 1);
            assert.equal(remainingRelays[0].length, 3);
            assert.equal(remainingRelays[0][0].url, winnerRelayUrl);
            assert.equal(remainingRelays[0][1].url, failureRelayUrl);
            assert.equal(remainingRelays[0][2].url, otherRelayUrl);
            rsm._handleRaceResults(raceResults);
            // @ts-ignore
            remainingRelays = rsm.remainingRelays;
            assert.equal(remainingRelays?.length, 1);
            assert.equal(remainingRelays[0][0].url, otherRelayUrl);
        });
    });
});

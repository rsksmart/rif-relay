import { VersionRegistryInstance } from '@rsksmart/rif-relay-contracts/types/truffle-contracts';
import { expectRevert } from '@openzeppelin/test-helpers';
import { increaseTime, getTestingEnvironment } from './TestUtils';
import {
    VersionRegistry,
    string32,
    isRsk,
    Environment
} from '@rsksmart/rif-relay-common';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, assert } = chai.use(chaiAsPromised);

//@ts-ignore
import sourceMapSupport from 'source-map-support';
//@ts-ignore
sourceMapSupport.install({ errorFormatterForce: true });

const VersionRegistryContract = artifacts.require('VersionRegistry');

contract('VersionRegistry', ([account]) => {
    let now: number;
    let registryContract: VersionRegistryInstance;
    let jsRegistry: VersionRegistry;
    let env: Environment;

    before('create registry', async () => {
        registryContract = await VersionRegistryContract.new();
        jsRegistry = new VersionRegistry(
            web3.currentProvider,
            registryContract.address,
            { from: account }
        );
        await jsRegistry.addVersion('id', 'ver', 'value');
        await jsRegistry.addVersion('another', 'ver', 'anothervalue');
    });
    context('contract param validations', () => {
        it('should fail to add without id', async () => {
            await expectRevert(
                registryContract.addVersion(
                    string32(''),
                    string32(''),
                    'value'
                ),
                'missing id'
            );
        });
        it('should fail to add without version', async () => {
            await expectRevert(
                registryContract.addVersion(
                    string32('id'),
                    string32(''),
                    'value'
                ),
                'missing version'
            );
        });
    });
    context('javascript param validations', () => {
        it('should reject adding the same version again', async () => {
            await expect(
                jsRegistry.addVersion('id', 'ver', 'changevalue')
            ).to.eventually.be.rejectedWith('version already exists');
        });
        it('should rejecting canceling non-existent version', async () => {
            await expect(
                jsRegistry.cancelVersion('nosuchid', 'ver', 'changevalue')
            ).to.eventually.be.rejectedWith('version does not exist');
        });
    });

    context('basic getAllVersions', () => {
        it('should return nothing for unknown id', async () => {
            assert.deepEqual(await jsRegistry.getAllVersions('nosuchid'), []);
        });
        it('should get version of specific id', async () => {
            const versions = await jsRegistry.getAllVersions('id');
            assert.deepInclude(versions[0], {
                version: 'ver',
                value: 'value',
                canceled: false
            });
        });
    });

    context('with more versions', () => {
        before(async () => {
            env = await getTestingEnvironment();

            await increaseTime(100);
            await jsRegistry.addVersion('id', 'ver2', 'value2');
            // evm_increaseTime with Automine enabled RSKJ works a bit different in RSKJ
            await increaseTime(isRsk(env) ? 200 : 100);
            await jsRegistry.addVersion('id', 'ver3', 'value3');
            // evm_increaseTime with Automine enabled RSKJ works a bit different in RSKJ
            await increaseTime(isRsk(env) ? 300 : 100);

            // at this point:
            // ver1 - 300 sec old
            // ver2 - 200 sec old
            // ver3 - 100 sec old

            now = parseInt(
                (await web3.eth.getBlock('latest')).timestamp.toString()
            );
        });
        context('#getAllVersions', () => {
            it('should return all versions', async () => {
                const versions = await jsRegistry.getAllVersions('id');

                assert.equal(versions.length, 3);
                assert.deepInclude(versions[0], {
                    version: 'ver3',
                    value: 'value3',
                    canceled: false
                });
                assert.deepInclude(versions[1], {
                    version: 'ver2',
                    value: 'value2',
                    canceled: false
                });
                assert.deepInclude(versions[2], {
                    version: 'ver',
                    value: 'value',
                    canceled: false
                });

                assert.closeTo(
                    now - versions[0].time,
                    100,
                    isRsk(env) ? 10 : 2
                );
                assert.closeTo(
                    now - versions[1].time,
                    200,
                    isRsk(env) ? 10 : 2
                );
                assert.closeTo(
                    now - versions[2].time,
                    300,
                    isRsk(env) ? 10 : 2
                );
            });

            it("should ignore repeated added version (can't modify history: only adding to it)", async () => {
                // note that the javascript class reject such double-adding. we add directly through the contract API:
                await registryContract.addVersion(
                    string32('id'),
                    string32('ver2'),
                    'new-value2'
                );
                const versions = await jsRegistry.getAllVersions('id');

                assert.equal(versions.length, 3);
                assert.deepInclude(versions[0], {
                    version: 'ver3',
                    value: 'value3',
                    canceled: false
                });
                assert.deepInclude(versions[1], {
                    version: 'ver2',
                    value: 'value2',
                    canceled: false
                });
                assert.deepInclude(versions[2], {
                    version: 'ver',
                    value: 'value',
                    canceled: false
                });
            });
        });

        describe('#getVersion', () => {
            it('should revert if has no version', async () => {
                await expect(
                    jsRegistry.getVersion('nosuchid', 1)
                ).to.eventually.rejectedWith('no version found');
            });

            it('should revert if no version is mature', async () => {
                try {
                    await jsRegistry.getVersion('id', 10000);
                } catch (e) {
                    assert.include(e.toString(), 'no version found');
                    return;
                }
                assert.fail('should revert');
            });

            it('should return latest version', async () => {
                const { version, value, time } = await jsRegistry.getVersion(
                    'id',
                    1
                );
                assert.deepEqual(
                    { version, value },
                    { version: 'ver3', value: 'value3' }
                );
                assert.closeTo(time, now - 100, 2);
            });

            it('should return latest "mature" version', async () => {
                // ignore entries in the past 150 seconds
                const { version, value } = await jsRegistry.getVersion(
                    'id',
                    150
                );

                assert.deepEqual(
                    { version, value },
                    { version: 'ver2', value: 'value2' }
                );
            });

            it('should return "young" version if opted-in', async () => {
                // ignore entries in the past 150 seconds (unless explicitly opted-in)
                const { version, value } = await jsRegistry.getVersion(
                    'id',
                    150,
                    'ver3'
                );

                assert.deepEqual(
                    { version, value },
                    { version: 'ver3', value: 'value3' }
                );
            });

            it('should ignore opt-in if later version exists', async () => {
                // ignore entries in the past 150 seconds
                const { version, value } = await jsRegistry.getVersion(
                    'id',
                    150,
                    'ver1'
                );

                assert.deepEqual(
                    { version, value },
                    { version: 'ver2', value: 'value2' }
                );
            });
        });

        describe('with canceled version', () => {
            before(async () => {
                await registryContract.cancelVersion(
                    string32('id'),
                    string32('ver2'),
                    'reason'
                );
                // at this point:
                // ver1 - 300 sec old
                // ver2 - 200 sec old - canceled
                // ver3 - 100 sec old
            });

            it('getVersion should ignore canceled version', async () => {
                // ignore entries in the past 150 seconds
                const { version, value } = await jsRegistry.getVersion(
                    'id',
                    150
                );
                assert.deepEqual(
                    { version, value },
                    { version: 'ver', value: 'value' }
                );
            });
            it('getAllVersions should return also canceled versions', async () => {
                const versions = await jsRegistry.getAllVersions('id');

                assert.equal(versions.length, 3);
                assert.deepInclude(versions[0], {
                    version: 'ver3',
                    value: 'value3',
                    canceled: false,
                    cancelReason: undefined
                });
                assert.deepInclude(versions[1], {
                    version: 'ver2',
                    value: 'value2',
                    canceled: true,
                    cancelReason: 'reason'
                });
                assert.deepInclude(versions[2], {
                    version: 'ver',
                    value: 'value',
                    canceled: false,
                    cancelReason: undefined
                });
            });
        });
    });
});

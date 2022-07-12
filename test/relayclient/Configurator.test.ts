// test possible client errors

import { TestEnvironment } from '../TestEnvironment';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { resolveConfiguration } from '@rsksmart/rif-relay-client';
import { HttpProvider } from 'web3-core';

const { assert, expect } = chai.use(chaiAsPromised);

contract('client-configuration', () => {
    before(async () => {
        const host = (web3.currentProvider as HttpProvider).host;
        await TestEnvironment.start(host, 0.6e18);
    });
    describe('#resolveConfiguration', () => {
        describe('failures', () => {
            it('should fail with no params', async () => {
                // @ts-ignore
                await expect(resolveConfiguration()).to.eventually.rejectedWith(
                    /Cannot read properties/
                );
            });

            it('should throw if the first arg not provider', async () => {
                await expect(
                    resolveConfiguration({} as any, {})
                ).to.eventually.rejectedWith(
                    /First param is not a web3 provider/
                );
            });
        });

        describe('with successful resolveConfiguration', () => {
            it('should set metamask defaults', async () => {
                const metamaskProvider = {
                    isMetaMask: true,
                    send: (options: any, cb: any) => {
                        (web3.currentProvider as any).send(options, cb);
                    }
                } as any;
                const config = await resolveConfiguration(metamaskProvider, {});
                assert.equal(config.methodSuffix, '_v4');
                assert.equal(config.jsonStringifyRequest, true);
            });

            it('should allow to override metamask defaults', async () => {
                const metamaskProvider = {
                    isMetaMask: true,
                    send: (options: any, cb: any) => {
                        (web3.currentProvider as any).send(options, cb);
                    }
                } as any;

                // note: to check boolean override, we explicitly set it to something that
                // is not in the defaults..
                const config = await resolveConfiguration(metamaskProvider, {
                    methodSuffix: 'suffix',
                    jsonStringifyRequest: 5 as unknown as boolean
                });
                assert.equal(config.methodSuffix, 'suffix');
                assert.equal(config.jsonStringifyRequest as any, 5);
            });
        });
    });
});

// test possible client errors

import { TestEnvironment, TestEnvironmentInfo } from '../../src/relayclient/TestEnvironment'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { resolveConfiguration } from '../../src/relayclient/Configurator'
import { DeploymentResult } from '../../src/cli/CommandsLogic'
import { PrefixedHexString } from 'ethereumjs-tx'
import ContractInteractor, { Web3Provider } from '../../src/common/ContractInteractor'
import { HttpProvider } from 'web3-core'

const { assert, expect } = chai.use(chaiAsPromised)

contract('client-configuration', () => {
  let env: TestEnvironmentInfo
  let deploymentResult: DeploymentResult
  let relayVerifierAddress: PrefixedHexString
  let deployVerifierAddress: PrefixedHexString
  before(async () => {
    const host = (web3.currentProvider as HttpProvider).host
    env = await TestEnvironment.start(host, 0.6e18)
    deploymentResult = env.deploymentResult
    // deploymentResult = loadDeployment('./build/enveloping')
    relayVerifierAddress = deploymentResult.relayVerifierAddress
    deployVerifierAddress = deploymentResult.deployVerifierAddress
  })
  describe('#resolveConfiguration', () => {
    describe('failures', () => {
      it('should fail with no params', async () => {
        // @ts-ignore
        await expect(resolveConfiguration()).to.eventually.rejectedWith(/Cannot read property/)
      })

      it('should throw if the first arg not provider', async () => {
        // @ts-ignore
        await expect(resolveConfiguration({})).to.eventually.rejectedWith(/First param is not a web3 provider/)
      })

      it.skip('should throw if wrong contract verifier version', async () => {
        // instead of deploying a new verifier with a different version, we make our client version older
        // since resolveConfiguration creates its own ContractInteractor, we have to hook the class to modify the version
        // after it is created...

        const saveCPM = ContractInteractor.prototype._createBaseVerifier
        try {
          ContractInteractor.prototype._createBaseVerifier = async function (addr) {
            (this as any).versionManager.componentVersion = '1.0.0-old-client'
            console.log('hooked _createVerifier with version')
            return await saveCPM.call(this, addr)
          }

          await expect(resolveConfiguration(web3.currentProvider as Web3Provider, { relayVerifierAddress, deployVerifierAddress }))
            .to.eventually.rejectedWith(/Provided.*version.*is not supported/)
        } finally {
          ContractInteractor.prototype._createBaseVerifier = saveCPM
        }
      })
    })

    describe('with successful resolveConfiguration', () => {
      it('should set metamask defaults', async () => {
        const metamaskProvider = {
          isMetaMask: true,
          send: (options: any, cb: any) => {
            (web3.currentProvider as any).send(options, cb)
          }
        } as any
        const config = await resolveConfiguration(metamaskProvider, {})
        assert.equal(config.methodSuffix, '_v4')
        assert.equal(config.jsonStringifyRequest, true)
      })

      it('should allow to override metamask defaults', async () => {
        const metamaskProvider = {
          isMetaMask: true,
          send: (options: any, cb: any) => {
            (web3.currentProvider as any).send(options, cb)
          }
        } as any

        // note: to check boolean override, we explicitly set it to something that
        // is not in the defaults..
        const config = await resolveConfiguration(metamaskProvider, { methodSuffix: 'suffix', jsonStringifyRequest: 5 as unknown as boolean })
        assert.equal(config.methodSuffix, 'suffix')
        assert.equal(config.jsonStringifyRequest as any, 5)
      })
    })
  })
})

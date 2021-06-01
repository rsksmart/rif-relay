import { increaseTime, getTestingEnvironment } from './TestUtils'
import { VersionRegistryInteractor, string32 } from '../src/common/VersionRegistry'
import { isRsk, Environment } from '../src/common/Environments'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { VersionRegistry__factory, VersionRegistry } from '../typechain'
import { expect } from 'chai'
import { fail } from 'assert'

require('source-map-support').install({ errorFormatterForce: true })

describe('VersionRegistry', () => {
  let accountSigner: SignerWithAddress
  let account: string
  let now: number
  let registryContract: VersionRegistry
  let jsRegistry: VersionRegistryInteractor
  let env: Environment

  before('create registry', async () => {
    const VersionRegistryContract = await ethers.getContractFactory('VersionRegistry') as VersionRegistry__factory
    accountSigner = (await ethers.getSigners())[0]
    account = await accountSigner.getAddress()
    registryContract = await VersionRegistryContract.deploy()
    await registryContract.deployed()
    jsRegistry = new VersionRegistryInteractor(ethers.provider, registryContract.address)
    await jsRegistry.addVersion('id', 'ver', 'value', {}, account)
    await jsRegistry.addVersion('another', 'ver', 'anothervalue', {}, account)
  })
  context('contract param validations', () => {
    it('should fail to add without id', async () => {
      await expect(registryContract.addVersion(string32(''), string32(''), 'value')).to.revertedWith('missing id')
    })
    it('should fail to add without version', async () => {
      await expect(registryContract.addVersion(string32('id'), string32(''), 'value')).to.revertedWith('missing version')
    })
  })
  context('javascript param validations', () => {
    it('should reject adding the same version again', async () => {
      try {
        await jsRegistry.addVersion('id', 'ver', 'changevalue', {}, account)
        fail()
      } catch (e: any) {
        expect(e.message).to.be.equal('version already exists: id @ ver')
      }
    })
    it('should rejecting canceling non-existent version', async () => {
      try {
        await jsRegistry.cancelVersion('nosuchid', 'ver', 'changevalue', {}, account)
        fail()
      } catch (e: any) {
        expect(e.message).to.be.equal('version does not exist: nosuchid @ ver')
      }
    })
  })
  
  context('basic getAllVersions', () => {
    it('should return nothing for unknown id', async () => {
      expect(await jsRegistry.getAllVersions('nosuchid')).to.be.deep.equal([])
    })
    it('should get version of specific id', async () => {
      const versions = await jsRegistry.getAllVersions('id')
      expect(versions[0]).to.deep.include({ version: 'ver', value: 'value', canceled: false })
    })
  })

  context('with more versions', () => {
    before(async () => {
      env = await getTestingEnvironment()
      now = parseInt((await ethers.provider.getBlock('latest')).timestamp.toString())
      await increaseTime(100)

      await jsRegistry.addVersion('id', 'ver2', 'value2', {}, account)
      // evm_increaseTime with Automine enabled RSKJ works a bit different in RSKJ
      await increaseTime(isRsk(env) ? 200 : 100)
      await jsRegistry.addVersion('id', 'ver3', 'value3', {}, account)
      // evm_increaseTime with Automine enabled RSKJ works a bit different in RSKJ
        await increaseTime(isRsk(env) ? 300 : 100)

      // at this point:
      // ver1 - 300 sec old
      // ver2 - 200 sec old
      // ver3 - 100 sec old

      now = parseInt((await ethers.provider.getBlock('latest')).timestamp.toString())
    })
    context('#getAllVersions', () => {
      it('should return all versions', async () => {
        const versions = await jsRegistry.getAllVersions('id')

        expect(versions.length).to.be.equal(3)
        expect(versions[0]).to.deep.include({ version: 'ver3', value: 'value3', canceled: false })
        expect(versions[1]).to.deep.include({ version: 'ver2', value: 'value2', canceled: false })
        expect(versions[2]).to.deep.include({ version: 'ver', value: 'value', canceled: false })

        expect(now - versions[0].time).closeTo(100, isRsk(env) ? 10 : 2)
        expect(now - versions[1].time).closeTo(200, isRsk(env) ? 10 : 2)
        expect(now - versions[2].time).closeTo(300, isRsk(env) ? 10 : 2)
      })

      it('should ignore repeated added version (can\'t modify history: only adding to it)', async () => {
        // note that the javascript class reject such double-adding. we add directly through the contract API:
        await registryContract.addVersion(string32('id'), string32('ver2'), 'new-value2')
        const versions = await jsRegistry.getAllVersions('id')

        expect(versions.length).to.be.equal(3)
        expect(versions[0]).to.deep.include({ version: 'ver3', value: 'value3', canceled: false })
        expect(versions[1]).to.deep.include({ version: 'ver2', value: 'value2', canceled: false })
        expect(versions[2]).to.deep.include({ version: 'ver', value: 'value', canceled: false })
      })
    })

    describe('#getVersion', () => {
      it('should revert if has no version', async () => {
        try {
          await jsRegistry.getVersion('nosuchid', 1)
          fail()
        } catch (e) {
          expect(e.toString()).to.include('no version found')
        }
      })

      it('should revert if no version is mature', async () => {
        try {
          await jsRegistry.getVersion('id', 10000)
          fail()
        } catch (e) {
          expect(e.toString()).to.include('no version found')
          return
        }
      })

      it('should return latest version', async () => {
        const { version, value, time } = await jsRegistry.getVersion('id', 1)
        expect({ version, value }).to.deep.equal({ version: 'ver3', value: 'value3' })
        expect(time).closeTo(now - 100, 2)
      })

      it('should return latest "mature" version', async () => {
        // ignore entries in the past 150 seconds
        const { version, value } = await jsRegistry.getVersion('id', 150)
        expect({ version, value }).to.deep.equal({ version: 'ver2', value: 'value2' })
      })

      it('should return "young" version if opted-in', async () => {
        // ignore entries in the past 150 seconds (unless explicitly opted-in)
        const { version, value } = await jsRegistry.getVersion('id', 150, 'ver3')
        expect({ version, value }).to.deep.equal({ version: 'ver3', value: 'value3' })
      })

      it('should ignore opt-in if later version exists', async () => {
        // ignore entries in the past 150 seconds
        const { version, value } = await jsRegistry.getVersion('id', 150, 'ver1')

        expect({ version, value }).to.deep.equal({ version: 'ver2', value: 'value2' })
      })
    })

    describe('with canceled version', () => {
      before(async () => {
        await registryContract.cancelVersion(string32('id'), string32('ver2'), 'reason')
        // at this point:
        // ver1 - 300 sec old
        // ver2 - 200 sec old - canceled
        // ver3 - 100 sec old
      })

      it('getVersion should ignore canceled version', async () => {
        // ignore entries in the past 150 seconds
        const { version, value } = await jsRegistry.getVersion('id', 150)
        expect({ version, value }).to.deep.equal({ version: 'ver', value: 'value' })
      })
      it('getAllVersions should return also canceled versions', async () => {
        const versions = await jsRegistry.getAllVersions('id')

        expect(versions.length).to.be.equal(3)
        expect(versions[0]).to.deep.include({ version: 'ver3', value: 'value3', canceled: false, cancelReason: undefined })
        expect(versions[1]).to.deep.include({ version: 'ver2', value: 'value2', canceled: true, cancelReason: 'reason' })
        expect(versions[2]).to.deep.include({ version: 'ver', value: 'value', canceled: false, cancelReason: undefined })
      })
    })
  })
})
  
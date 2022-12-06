import AccountManager, { AccountKeypair } from '../../src/relayclient/AccountManager'
import { defaultEnvironment } from '../../src/common/Environments'
import { HttpProvider } from 'web3-core'
import { RelayRequest } from '../../src/common/EIP712/RelayRequest'
import sinon from 'sinon'
import sigUtil from 'eth-sig-util'
import { isSameAddress } from '../../src/common/Utils'
import chai from 'chai'
import sinonChai from 'sinon-chai'
import { configure } from '../../src/relayclient/Configurator'
import TypedRequestData from '../../src/common/EIP712/TypedRequestData'
import chaiAsPromised from 'chai-as-promised'
import { constants } from '../../src/common/Constants'
import { getGaslessAccount } from '../TestUtils'

const { expect, assert } = chai.use(chaiAsPromised)

chai.use(sinonChai)

contract('AccountManager', function (accounts) {
  const address: string = '0x982a8CbE734cb8c29A6a7E02a3B0e4512148F6F9'
  const keypair = {
    privateKey: Buffer.from('d353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c', 'hex'),
    address
  }
  const config = configure({
    methodSuffix: '',
    jsonStringifyRequest: false
  })

  let shouldThrow: boolean = false

  describe('#addAccount()', function () {
    it('should save the provided keypair internally', async function () {
      const account = await getGaslessAccount()
      const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config,
        async (signedData: any): Promise<string> => {
          if (shouldThrow) {
            throw new Error('Fail of testing')
          }
          // @ts-ignore
          return sigUtil.signTypedData_v4(account.privateKey, { data: signedData })
        }
      )
      // @ts-ignore
      sinon.spy(accountManager)

      accountManager.addAccount(keypair)
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), keypair.privateKey.toString())
      // @ts-ignore
      assert.equal(accountManager.accounts[0].address, keypair.address)
    })

    it('should throw if the provided keypair is not valid', async function () {
      const account = await getGaslessAccount()
      const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config,
        async (signedData: any): Promise<string> => {
          if (shouldThrow) {
            throw new Error('Fail of testing')
          }
          // @ts-ignore
          return sigUtil.signTypedData_v4(account.privateKey, { data: signedData })
        }
      )
      // @ts-ignore
      sinon.spy(accountManager)

      const keypair = {
        privateKey: Buffer.from('AAAAAAAAAAAAA6a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d', 'hex'),
        address
      }

      expect(() => {
        accountManager.addAccount(keypair)
      }).to.throw('invalid keypair')
    })
  })
  describe('#newAccount()', function () {
    it('should create a new keypair, return it and save it internally', async function () {
      const account = await getGaslessAccount()
      const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config,
        async (signedData: any): Promise<string> => {
          if (shouldThrow) {
            throw new Error('Fail of testing')
          }
          // @ts-ignore
          return sigUtil.signTypedData_v4(account.privateKey, { data: signedData })
        }
      )
      // @ts-ignore
      sinon.spy(accountManager)
      const keypair = accountManager.newAccount()
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), keypair.privateKey.toString())
      assert.equal(accountManager.getAccounts()[0], keypair.address)
    })
  })

  describe('#sign()', function () {
    let account: AccountKeypair
    let accountManager: AccountManager
    shouldThrow = false

    const relayRequest: RelayRequest = {
      request: {
        relayHub: constants.ZERO_ADDRESS,
        to: constants.ZERO_ADDRESS,
        data: '0x123',
        from: '',
        nonce: '1',
        value: '0',
        gas: '1',
        tokenContract: constants.ZERO_ADDRESS,
        tokenAmount: '0',
        tokenGas: '0',
        validUntilTime: '0'
      },
      relayData: {
        gasPrice: '1',
        relayWorker: constants.ZERO_ADDRESS,
        callForwarder: constants.ZERO_ADDRESS,
        callVerifier: constants.ZERO_ADDRESS,
        domainSeparator: '0x'
      }
    }
    beforeEach(async function () {
      account = await getGaslessAccount()
      accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config,
        async (signedData: any): Promise<string> => {
          if (shouldThrow) {
            throw new Error('Fail of testing')
          }
          // @ts-ignore
          return sigUtil.signTypedData_v4(account.privateKey, { data: signedData })
        }
      )
      // @ts-ignore
      sinon.spy(accountManager)
      accountManager.addAccount(keypair)
      sinon.resetHistory()
    })

    function relayRequestWithoutExtraData (relayRequest: RelayRequest): RelayRequest {
      const cloneRequest = { ...relayRequest }
      return cloneRequest
    }

    it('should use internally controlled keypair for signing if available', async function () {
      relayRequest.request.from = address
      const signedData = new TypedRequestData(
        defaultEnvironment.chainId,
        constants.ZERO_ADDRESS,
        relayRequestWithoutExtraData(relayRequest)
      )
      const signature = await accountManager.sign(relayRequest)
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
      assert.ok(isSameAddress(relayRequest.request.from.toLowerCase(), rec))
      expect(accountManager._signWithControlledKey).to.have.been.calledWith(keypair, signedData)
      expect(accountManager._signWithProvider).to.have.not.been.called
    })
    it('should ask provider to sign if key is not controlled', async function () {
      relayRequest.request.from = account.address

      const signedData = new TypedRequestData(
        defaultEnvironment.chainId,
        constants.ZERO_ADDRESS,
        relayRequestWithoutExtraData(relayRequest)
      )

      const signature = await accountManager.sign(relayRequest)
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
      assert.ok(isSameAddress(relayRequest.request.from.toLowerCase(), rec))
      expect(accountManager._signWithProvider).to.have.been.calledWith(signedData)
      expect(accountManager._signWithControlledKey).to.have.not.been.called
    })
    it('should throw if web3 fails to sign with requested address', async function () {
      shouldThrow = true
      relayRequest.request.from = '0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee'
      const promise = accountManager.sign(relayRequest)
      await expect(promise).to.be.eventually.rejectedWith('Failed to sign relayed transaction for 0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee')
    })
  })
})

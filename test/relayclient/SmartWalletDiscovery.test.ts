import Web3 from 'web3'
import { hdkey as EthereumHDKey } from 'ethereumjs-wallet'
import { ethers } from 'ethers'

import {
  SmartWalletInstance, SmartWalletFactoryInstance, TestTokenInstance, CustomSmartWalletFactoryInstance, CustomSmartWalletInstance
} from '../../types/truffle-contracts'

import { DiscoveryConfig, SmartWalletDiscovery } from '../../src/relayclient/SmartWalletDiscovery'

import { toChecksumAddress } from 'web3-utils'
import { constants } from '../../src/common/Constants'
import { Address } from '../../src/relayclient/types/Aliases'
import { WebsocketProvider } from 'web3-core'

const CustomSmartWallet = artifacts.require('CustomSmartWallet')
const SmartWallet = artifacts.require('SmartWallet')
const TestToken = artifacts.require('TestToken')
const CustomSmartWalletFactory = artifacts.require('CustomSmartWalletFactory')
const SmartWalletFactory = artifacts.require('SmartWalletFactory')

const options = [
  {
    title: 'SmartWallet',
    isCustom: false
  },
  {
    title: 'CustomSmartWallet',
    isCustom: true
  }
]

contract('SmartWalletDiscovery', function (accounts) {
  let chainId: number
  let token: TestTokenInstance
  let factory: SmartWalletFactoryInstance | CustomSmartWalletFactoryInstance
  let byteCodeHash: string
  let socketProvider: WebsocketProvider
  let sWalletTemplate: SmartWalletInstance | CustomSmartWalletInstance
  const mnemonic = 'figure arrow make ginger educate drip thing theory champion faint vendor push'
  let currentWeb3: Web3

  for (let optionIdx = 0; optionIdx < options.length; optionIdx++) {
    const params = options[optionIdx]

    describe(`${params.title} - #smartWalletDiscovery`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        swd = new SmartWalletDiscovery(socketProvider)
        discoverableAccounts = new Set<Address>()

        const rootKey: EthereumHDKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_0`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")

        // Fill 20 accounts with balance and for each one 20 swallets with balance
        for (let i = 0; i < 20; i++) {
          const account = firstAccountRoot.deriveChild(i).getWallet().getAddressString()
          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await currentWeb3.eth.sendTransaction({ from: accounts[0], to: swAddress, value: 1 })
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using only native crypto balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromMnemonic(config, mnemonic, `${params.title}_0`)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery 1`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])

        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_1`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await token.mint('1', swAddress)
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })
      it('should discover all the user accounts - using only token balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromMnemonic(config, mnemonic, `${params.title}_1`)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }
        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery 2`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])
        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_2`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const account = firstAccountRoot.deriveChild(i).getWallet().getAddressString()
          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await token.mint('1', swAddress)
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using balance and token balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromMnemonic(config, mnemonic, `${params.title}_2`)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery 3`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()

        swd = new SmartWalletDiscovery(socketProvider, [token.address])
        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_3`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")

        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()

          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)

            discoverableAccounts.add(swAddress)

            const toSign: string = params.isCustom ? currentWeb3.utils.soliditySha3(
              { t: 'bytes2', v: '0x1910' },
              { t: 'address', v: account },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'uint256', v: j },
              { t: 'bytes', v: '0x' }
            ) ?? ''
              : currentWeb3.utils.soliditySha3(
                { t: 'bytes2', v: '0x1910' },
                { t: 'address', v: account },
                { t: 'address', v: constants.ZERO_ADDRESS },
                { t: 'uint256', v: j }
              ) ?? ''

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
            const signingKey = new ethers.utils.SigningKey(accountWallet.getPrivateKey())
            const signature = signingKey.signDigest(toSignAsBinaryArray)
            const signatureCollapsed = ethers.utils.joinSignature(signature)

            params.isCustom ? await (factory as CustomSmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, '0x', signatureCollapsed)
              : await (factory as SmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, j, signatureCollapsed)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using deploy and native crypto balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromMnemonic(config, mnemonic, `${params.title}_3`)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery 4`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])

        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_4`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            discoverableAccounts.add(swAddress)

            const toSign: string = params.isCustom ? currentWeb3.utils.soliditySha3(
              { t: 'bytes2', v: '0x1910' },
              { t: 'address', v: account },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'uint256', v: j },
              { t: 'bytes', v: '0x' }
            ) ?? ''
              : currentWeb3.utils.soliditySha3(
                { t: 'bytes2', v: '0x1910' },
                { t: 'address', v: account },
                { t: 'address', v: constants.ZERO_ADDRESS },
                { t: 'uint256', v: j }
              ) ?? ''

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
            const signingKey = new ethers.utils.SigningKey(accountWallet.getPrivateKey())
            const signature = signingKey.signDigest(toSignAsBinaryArray)
            const signatureCollapsed = ethers.utils.joinSignature(signature)

            params.isCustom ? await (factory as CustomSmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, '0x', signatureCollapsed)
              : await (factory as SmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, j, signatureCollapsed)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using wallet Deploy only', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromMnemonic(config, mnemonic, `${params.title}_4`)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery From External Keys`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>
      const usedPublicKeys: string[] = []

      before(async function () {
        await init(params.isCustom)
        swd = new SmartWalletDiscovery(socketProvider)
        discoverableAccounts = new Set<Address>()

        const rootKey: EthereumHDKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Ext_0`)

        for (let accIdx = 0; accIdx < 2; accIdx++) {
          const firstAccountRoot = rootKey.derivePath(`m/44'/37310'/${accIdx}'/0`)

          usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

          // Fill 20 accounts with balance and for each one 20 swallets with balance
          for (let i = 0; i < 20; i++) {
            const account = firstAccountRoot.deriveChild(i).getWallet().getAddressString()
            await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
            discoverableAccounts.add(account)

            for (let j = 0; j < 20; j++) {
              const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
                : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
              await currentWeb3.eth.sendTransaction({ from: accounts[0], to: swAddress, value: 1 })
              discoverableAccounts.add(swAddress)
            }
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using only native crypto balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromExtendedPublicKeys(config, usedPublicKeys)

        assert.equal(swd.accounts.length, 40, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery From External Keys 1`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>
      const usedPublicKeys: string[] = []

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])

        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Ext_1`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await token.mint('1', swAddress)
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using only token balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromExtendedPublicKeys(config, usedPublicKeys)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery From External Keys 2`, function () {
      let swd: SmartWalletDiscovery
      const usedPublicKeys: string[] = []
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])
        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Ext_2`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const account = firstAccountRoot.deriveChild(i).getWallet().getAddressString()
          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await token.mint('1', swAddress)
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using balance and token balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromExtendedPublicKeys(config, usedPublicKeys)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery From External Keys 3`, function () {
      let swd: SmartWalletDiscovery
      const usedPublicKeys: string[] = []
      let discoverableAccounts: Set<Address>

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()

        swd = new SmartWalletDiscovery(socketProvider, [token.address])
        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Ext_3`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()

          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)

            discoverableAccounts.add(swAddress)

            const toSign: string = params.isCustom ? currentWeb3.utils.soliditySha3(
              { t: 'bytes2', v: '0x1910' },
              { t: 'address', v: account },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'uint256', v: j },
              { t: 'bytes', v: '0x' }
            ) ?? ''
              : currentWeb3.utils.soliditySha3(
                { t: 'bytes2', v: '0x1910' },
                { t: 'address', v: account },
                { t: 'address', v: constants.ZERO_ADDRESS },
                { t: 'uint256', v: j }
              ) ?? ''

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
            const signingKey = new ethers.utils.SigningKey(accountWallet.getPrivateKey())
            const signature = signingKey.signDigest(toSignAsBinaryArray)
            const signatureCollapsed = ethers.utils.joinSignature(signature)

            params.isCustom ? await (factory as CustomSmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, '0x', signatureCollapsed)
              : await (factory as SmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, j, signatureCollapsed)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using deploy and native crypto balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromExtendedPublicKeys(config, usedPublicKeys)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery From External Keys 4`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>
      const usedPublicKeys: string[] = []

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])

        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Ext_4`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            discoverableAccounts.add(swAddress)

            const toSign: string = params.isCustom ? currentWeb3.utils.soliditySha3(
              { t: 'bytes2', v: '0x1910' },
              { t: 'address', v: account },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'uint256', v: j },
              { t: 'bytes', v: '0x' }
            ) ?? ''
              : currentWeb3.utils.soliditySha3(
                { t: 'bytes2', v: '0x1910' },
                { t: 'address', v: account },
                { t: 'address', v: constants.ZERO_ADDRESS },
                { t: 'uint256', v: j }
              ) ?? ''

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
            const signingKey = new ethers.utils.SigningKey(accountWallet.getPrivateKey())
            const signature = signingKey.signDigest(toSignAsBinaryArray)
            const signatureCollapsed = ethers.utils.joinSignature(signature)

            params.isCustom ? await (factory as CustomSmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, '0x', signatureCollapsed)
              : await (factory as SmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, j, signatureCollapsed)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using wallet Deploy only', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccountsFromExtendedPublicKeys(config, usedPublicKeys)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery from Template method `, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>
      const usedPublicKeys: string[] = []

      async function getUsedPubKey (accountIdx: number): Promise<string | undefined> {
        return accountIdx < usedPublicKeys.length ? usedPublicKeys[accountIdx] : undefined
      }

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider)

        const rootKey: EthereumHDKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Template_0`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one 20 swallets with balance
        for (let i = 0; i < 20; i++) {
          const account = firstAccountRoot.deriveChild(i).getWallet().getAddressString()
          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await currentWeb3.eth.sendTransaction({ from: accounts[0], to: swAddress, value: 1 })
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using only native crypto balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccounts(config, getUsedPubKey)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery from Template method 1`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>
      const usedPublicKeys: string[] = []

      async function getUsedPubKey (accountIdx: number): Promise<string | undefined> {
        return usedPublicKeys[accountIdx]
      }

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])

        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Template_1`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await token.mint('1', swAddress)
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using only token balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccounts(config, getUsedPubKey)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery from Template method 2`, function () {
      let swd: SmartWalletDiscovery
      const usedPublicKeys: string[] = []
      let discoverableAccounts: Set<Address>

      async function getUsedPubKey (accountIdx: number): Promise<string | undefined> {
        return usedPublicKeys[accountIdx]
      }

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])
        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Template_2`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const account = firstAccountRoot.deriveChild(i).getWallet().getAddressString()
          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            await token.mint('1', swAddress)
            discoverableAccounts.add(swAddress)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using balance and token balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccounts(config, getUsedPubKey)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery from Template method 3`, function () {
      let swd: SmartWalletDiscovery
      const usedPublicKeys: string[] = []
      let discoverableAccounts: Set<Address>

      async function getUsedPubKey (accountIdx: number): Promise<string | undefined> {
        return usedPublicKeys[accountIdx]
      }

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])
        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Template_3`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()

          await currentWeb3.eth.sendTransaction({ from: accounts[0], to: account, value: 1 })
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)

            discoverableAccounts.add(swAddress)

            const toSign: string = params.isCustom ? currentWeb3.utils.soliditySha3(
              { t: 'bytes2', v: '0x1910' },
              { t: 'address', v: account },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'uint256', v: j },
              { t: 'bytes', v: '0x' }
            ) ?? ''
              : currentWeb3.utils.soliditySha3(
                { t: 'bytes2', v: '0x1910' },
                { t: 'address', v: account },
                { t: 'address', v: constants.ZERO_ADDRESS },
                { t: 'uint256', v: j }
              ) ?? ''

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
            const signingKey = new ethers.utils.SigningKey(accountWallet.getPrivateKey())
            const signature = signingKey.signDigest(toSignAsBinaryArray)
            const signatureCollapsed = ethers.utils.joinSignature(signature)

            params.isCustom ? await (factory as CustomSmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, '0x', signatureCollapsed)
              : await (factory as SmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, j, signatureCollapsed)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using deploy and native crypto balance', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccounts(config, getUsedPubKey)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })

    describe(`${params.title} - #smartWalletDiscovery from Template method 4`, function () {
      let swd: SmartWalletDiscovery
      let discoverableAccounts: Set<Address>
      const usedPublicKeys: string[] = []

      async function getUsedPubKey (accountIdx: number): Promise<string | undefined> {
        return usedPublicKeys[accountIdx]
      }

      before(async function () {
        await init(params.isCustom)
        discoverableAccounts = new Set<Address>()
        swd = new SmartWalletDiscovery(socketProvider, [token.address])

        // new rootkey
        const rootKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, `${params.title}_Template_4`)
        const firstAccountRoot = rootKey.derivePath("m/44'/37310'/0'/0")
        usedPublicKeys.push(firstAccountRoot.publicExtendedKey().toString())

        // Fill 20 accounts with balance and for each one fill a token to 20 smart wallets
        for (let i = 0; i < 20; i++) {
          const accountWallet = firstAccountRoot.deriveChild(i).getWallet()
          const account = accountWallet.getAddressString()
          discoverableAccounts.add(account)

          for (let j = 0; j < 20; j++) {
            const swAddress = params.isCustom ? calculateCustomSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, byteCodeHash, constants.SHA3_NULL_S)
              : calculateSmartWalletAddress(factory.address, account, constants.ZERO_ADDRESS, j, byteCodeHash)
            discoverableAccounts.add(swAddress)

            const toSign: string = params.isCustom ? currentWeb3.utils.soliditySha3(
              { t: 'bytes2', v: '0x1910' },
              { t: 'address', v: account },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'address', v: constants.ZERO_ADDRESS },
              { t: 'uint256', v: j },
              { t: 'bytes', v: '0x' }
            ) ?? ''
              : currentWeb3.utils.soliditySha3(
                { t: 'bytes2', v: '0x1910' },
                { t: 'address', v: account },
                { t: 'address', v: constants.ZERO_ADDRESS },
                { t: 'uint256', v: j }
              ) ?? ''

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign)
            const signingKey = new ethers.utils.SigningKey(accountWallet.getPrivateKey())
            const signature = signingKey.signDigest(toSignAsBinaryArray)
            const signatureCollapsed = ethers.utils.joinSignature(signature)

            params.isCustom ? await (factory as CustomSmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, j, '0x', signatureCollapsed)
              : await (factory as SmartWalletFactoryInstance).createUserSmartWallet(account, constants.ZERO_ADDRESS, j, signatureCollapsed)
          }
        }
      })

      after(function () {
        closeSocket()
      })

      it('should discover all the user accounts - using wallet Deploy only', async function () {
        const config = new DiscoveryConfig({
          isTestNet: true,
          factory: factory.address,
          isCustomWallet: params.isCustom
        })

        await swd.discoverAccounts(config, getUsedPubKey)

        assert.equal(swd.accounts.length, 20, 'incorrect eoa accounts discovered')

        for (let i = 0; i < swd.accounts.length; i++) {
          assert.equal(swd.accounts[i].swAccounts.length, 20, `incorrect sw accounts discovered for address ${swd.accounts[i].eoaAccount}`)
          const account = swd.accounts[i].eoaAccount
          assert.isTrue(discoverableAccounts.has(account), 'Discovered Account not part of Discoverable Set')
          discoverableAccounts.delete(account)

          for (let j = 0; j < 20; j++) {
            const swAccount = swd.accounts[i].swAccounts[j]
            assert.isTrue(discoverableAccounts.has(swAccount), 'Discovered SWAccount not part of Discoverable Set')
            discoverableAccounts.delete(swAccount)
          }
        }

        assert.isTrue(discoverableAccounts.size === 0, 'Some Discoverable Accounts were not found')
      })
    })
  }

  function calculateSmartWalletAddress (factory: Address, ownerEOA: Address, recoverer: Address, walletIndex: number, bytecodeHash: string): Address {
    const salt: string = web3.utils.soliditySha3(
      { t: 'address', v: ownerEOA },
      { t: 'address', v: recoverer },
      { t: 'uint256', v: walletIndex }
    ) ?? ''

    const _data: string = web3.utils.soliditySha3(
      { t: 'bytes1', v: '0xff' },
      { t: 'address', v: factory },
      { t: 'bytes32', v: salt },
      { t: 'bytes32', v: bytecodeHash }
    ) ?? ''

    return toChecksumAddress('0x' + _data.slice(26, _data.length), chainId)
  }

  async function init (isCustom: boolean): Promise<void> {
    socketProvider = new Web3.providers.WebsocketProvider('ws://127.0.0.1:4445/websocket')

    CustomSmartWalletFactory.setProvider(socketProvider, undefined)
    SmartWalletFactory.setProvider(socketProvider, undefined)
    CustomSmartWallet.setProvider(socketProvider, undefined)
    SmartWallet.setProvider(socketProvider, undefined)
    TestToken.setProvider(socketProvider, undefined)

    currentWeb3 = new Web3(socketProvider)
    chainId = await currentWeb3.eth.getChainId()
    sWalletTemplate = isCustom ? await CustomSmartWallet.new() : await SmartWallet.new()
    factory = isCustom ? await CustomSmartWalletFactory.new(sWalletTemplate.address) : await SmartWalletFactory.new(sWalletTemplate.address)
    byteCodeHash = currentWeb3.utils.keccak256(await factory.getCreationBytecode())
    token = await TestToken.new()
  }

  function closeSocket (): void {
    const socketProvider = currentWeb3.currentProvider as WebsocketProvider
    socketProvider.disconnect(0, '')
    assert.isFalse(socketProvider.connected, 'Socket connection did not end')
  }

  function calculateCustomSmartWalletAddress (factory: Address, ownerEOA: Address, recoverer: Address, customLogic: Address, walletIndex: number, bytecodeHash: string, logicInitParamsHash?: string): Address {
    const salt: string = web3.utils.soliditySha3(
      { t: 'address', v: ownerEOA },
      { t: 'address', v: recoverer },
      { t: 'address', v: customLogic },
      { t: 'bytes32', v: logicInitParamsHash ?? constants.SHA3_NULL_S },
      { t: 'uint256', v: walletIndex }
    ) ?? ''

    const _data: string = web3.utils.soliditySha3(
      { t: 'bytes1', v: '0xff' },
      { t: 'address', v: factory },
      { t: 'bytes32', v: salt },
      { t: 'bytes32', v: bytecodeHash }
    ) ?? ''

    return toChecksumAddress('0x' + _data.slice(26, _data.length), chainId)
  }
})


import { hdkey as EthereumHDKey } from 'ethereumjs-wallet'

import Web3 from 'web3'

import ethUtils, { BN } from 'ethereumjs-util'

import { constants } from '../common/Constants'
import { toChecksumAddress } from 'web3-utils'

import proxyFactoryAbi from '../common/interfaces/ISmartWalletFactory.json'
import {
  HttpProvider,
  IpcProvider,
  WebsocketProvider
} from 'web3-core'

import * as bip39 from 'ethereum-cryptography/bip39'
import { wordlist as wordlistCzech } from 'ethereum-cryptography/bip39/wordlists/czech'
import { wordlist as wordlistEnglish } from 'ethereum-cryptography/bip39/wordlists/english'
import { wordlist as wordlistFrench } from 'ethereum-cryptography/bip39/wordlists/french'
import { wordlist as wordlistItalian } from 'ethereum-cryptography/bip39/wordlists/italian'
import { wordlist as wordlistJapanese } from 'ethereum-cryptography/bip39/wordlists/japanese'
import { wordlist as wordlistKorean } from 'ethereum-cryptography/bip39/wordlists/korean'
import { wordlist as wordlistSChinese } from 'ethereum-cryptography/bip39/wordlists/simplified-chinese'
import { wordlist as wordlistSpanish } from 'ethereum-cryptography/bip39/wordlists/spanish'
import { wordlist as wordlistTChinese } from 'ethereum-cryptography/bip39/wordlists/traditional-chinese'
import { Contract } from 'web3-eth-contract'

export type AccountReaderFunction = (accountIdx: number) => Promise<string | undefined>

export interface DiscoveredAccount {
  eoaAccount: string
  swAccounts: string[]
}

export type Web3Provider =
  | HttpProvider
  | IpcProvider
  | WebsocketProvider

export enum TMnemonicLanguage {
  CZECH = 1,
  ENGLISH,
  FRENCH,
  ITALIAN,
  JAPANESE,
  KOREAN,
  SIMPLIFIED_CHINESE,
  SPANISH,
  TRADITIONAL_CHINESE
}

export interface IDiscoveryConfig {
  eoaGap?: number
  sWalletGap?: number
  searchBalance?: boolean
  searchNonce?: boolean
  searchTokenBalance?: boolean
  searchDeployEvents?: boolean
  isTestNet?: boolean
  factory: string
  isCustomWallet: boolean
  mnemonicLanguage?: TMnemonicLanguage
  recoverer?: string
  logic?: string
  logicParamsHash?: string
  reconnectionAttempts?: number
}

export class DiscoveryConfig implements IDiscoveryConfig {
  readonly eoaGap: number
  readonly sWalletGap: number
  readonly searchBalance: boolean
  readonly searchNonce: boolean
  readonly searchTokenBalance: boolean
  readonly searchDeployEvents: boolean
  readonly isTestNet: boolean
  readonly factory: string
  readonly mnemonicLanguage: TMnemonicLanguage
  readonly recoverer: string
  readonly logic?: string
  readonly logicParamsHash?: string
  readonly isCustomWallet: boolean

  constructor (config: IDiscoveryConfig) {
    this.eoaGap = config.eoaGap ?? 20
    this.sWalletGap = config.sWalletGap ?? 20
    this.searchBalance = config.searchBalance ?? true
    this.searchNonce = config.searchNonce ?? true
    this.searchTokenBalance = config.searchTokenBalance ?? true
    this.searchDeployEvents = config.searchDeployEvents ?? true
    this.isTestNet = config.isTestNet ?? false
    this.factory = config.factory
    this.mnemonicLanguage = config.mnemonicLanguage ?? TMnemonicLanguage.ENGLISH
    this.recoverer = config.recoverer ?? constants.ZERO_ADDRESS
    this.logic = config.logic
    this.logicParamsHash = config.logicParamsHash
    this.isCustomWallet = config.isCustomWallet
  }
}

export class SmartWalletDiscovery {
  private web3: Web3
  private readonly provider: Web3Provider

  public accounts: DiscoveredAccount[]
  private readonly tokens: string[]
  private readonly reconnectionAttempts: number

  constructor (provider: Web3Provider, tokens?: string[], reconnectionAttempts: number = 4) {
    this.web3 = new Web3(provider)
    this.provider = provider
    this.accounts = []
    this.tokens = tokens ?? []
    this.reconnectionAttempts = reconnectionAttempts
  }

  /**
 * Discover accounts given a mnemonic and password
 * @param config
 * @param mnemonic
 * @param password
 */
  public async discoverAccountsFromMnemonic (config: DiscoveryConfig, mnemonic: string, password?: string): Promise<void> {
    const hdRootKey: EthereumHDKey = SmartWalletDiscovery.getRootExtKeyFromMnemonic(mnemonic, password, config.mnemonicLanguage)

    let ended: boolean = false
    let currentAccount: number = 0
    const smartWalletFactory = new this.web3.eth.Contract(proxyFactoryAbi as any, config.factory)
    const creationByteCode = await smartWalletFactory.methods.getCreationBytecode().call()
    const bytecodeHash = this.web3.utils.keccak256(creationByteCode)
    const chainId = await this.web3.eth.getChainId()
    const logicAddress = config.logic ?? constants.ZERO_ADDRESS
    const initParamsHash = config.logicParamsHash ?? constants.SHA3_NULL_S

    while (!ended) {
      const rskIndex = config.isTestNet ? '37310' : '137'
      const address = `m/44'/${rskIndex}'`
      const gapLimit = config.eoaGap
      let totalTrxCount = 0
      let totalSWTrxCount = 0
      let currentGap = 0
      let index = 0

      while (currentGap <= gapLimit) {
        const walletKey = hdRootKey.derivePath(`${address}/${currentAccount}'/0/${index}`)
        const currentAddress = walletKey.getWallet().getAddressString()

        const activityFound = await this.searchTrx(currentAddress, smartWalletFactory)
        const discoveredAccount: DiscoveredAccount = { eoaAccount: constants.ZERO_ADDRESS, swAccounts: [] }

        if (activityFound) {
          discoveredAccount.eoaAccount = currentAddress
          totalTrxCount++
          currentGap = 0 // reset the gap between accounts
          // console.log(`EOA Account discovered at ${currentAddress}`)
        } else {
          currentGap++
        }

        index++

        let currentSWGap = 0
        let walletIndex = 0

        while (currentSWGap <= config.sWalletGap) { // originally <=gapLimit, but rskj rpc crashes
          const currentSWAddress = config.isCustomWallet ? this.calculateCustomSmartWalletAddress(currentAddress, config.recoverer,
            logicAddress, initParamsHash, walletIndex, config.factory, bytecodeHash, chainId)
            : this.calculateSmartWalletAddress(currentAddress, config.recoverer, walletIndex, config.factory, bytecodeHash, chainId)

          const swAtivityFound = await this.searchTrx(currentSWAddress, smartWalletFactory)

          if (swAtivityFound) {
            discoveredAccount.swAccounts.push(currentSWAddress)
            totalSWTrxCount++
            currentSWGap = 0
            currentGap = 0
            // console.log(`EOA SW Account discovered at ${currentSWAddress}`)
          } else {
            currentSWGap++
          }

          walletIndex++
        }

        if (discoveredAccount.swAccounts.length > 0 && discoveredAccount.eoaAccount === constants.ZERO_ADDRESS) {
          discoveredAccount.eoaAccount = currentAddress
        }

        if (discoveredAccount.eoaAccount !== constants.ZERO_ADDRESS || discoveredAccount.swAccounts.length > 0) {
          this.accounts.push(discoveredAccount)
        }
      }

      if (totalTrxCount === 0 && totalSWTrxCount === 0) {
        ended = true // Stop looking for accounts
      } else {
        currentAccount++ // Move to next hardened account key
      }
    }
  }

  /**
   * Discover accounts given an array of Extended Public Keys
   * @param config
   * @param extendedPublicKeys
   */
  public async discoverAccountsFromExtendedPublicKeys (config: DiscoveryConfig, extendedPublicKeys: string[]): Promise<void> {
    const smartWalletFactory = new this.web3.eth.Contract(proxyFactoryAbi as any, config.factory)
    const creationByteCode = await smartWalletFactory.methods.getCreationBytecode().call()
    const bytecodeHash = this.web3.utils.keccak256(creationByteCode)
    const chainId = await this.web3.eth.getChainId()
    const logicAddress = config.logic ?? constants.ZERO_ADDRESS
    const initParamsHash = config.logicParamsHash ?? constants.SHA3_NULL_S

    for (let i = 0; i < extendedPublicKeys.length; i++) {
      const extPubKey = extendedPublicKeys[i]
      const hdAcckey: EthereumHDKey = EthereumHDKey.fromExtendedKey(extPubKey) // Account key (last hardened key)

      const gapLimit = config.eoaGap
      let currentGap = 0
      let index = 0

      while (currentGap <= gapLimit) {
        // The account is m/44'/137'/accountIdx/0
        // Derive child gets m/44'/137'/accountIdx/0/index
        const currentPubKey: EthereumHDKey = hdAcckey.deriveChild(index)
        const currentAddress = currentPubKey.getWallet().getAddressString()

        const activityFound = await this.searchTrx(currentAddress, smartWalletFactory)
        const discoveredAccount: DiscoveredAccount = { eoaAccount: constants.ZERO_ADDRESS, swAccounts: [] }

        if (activityFound) {
          discoveredAccount.eoaAccount = currentAddress
          currentGap = 0 // reset the gap between accounts
        } else {
          currentGap++
        }

        index++

        let currentSWGap = 0
        let walletIndex = 0

        while (currentSWGap <= config.sWalletGap) {
          const currentSWAddress = config.isCustomWallet ? this.calculateCustomSmartWalletAddress(currentAddress, config.recoverer,
            logicAddress, initParamsHash, walletIndex, config.factory, bytecodeHash, chainId)
            : this.calculateSmartWalletAddress(currentAddress, config.recoverer, walletIndex, config.factory, bytecodeHash, chainId)

          const swActivityFound = await this.searchTrx(currentSWAddress, smartWalletFactory)

          if (swActivityFound) {
            discoveredAccount.swAccounts.push(currentSWAddress)
            currentSWGap = 0
            currentGap = 0
          } else {
            currentSWGap++
          }

          walletIndex++
        }

        if (discoveredAccount.swAccounts.length > 0 && discoveredAccount.eoaAccount === constants.ZERO_ADDRESS) {
          discoveredAccount.eoaAccount = currentAddress
        }

        if (discoveredAccount.eoaAccount !== constants.ZERO_ADDRESS || discoveredAccount.swAccounts.length > 0) {
          this.accounts.push(discoveredAccount)
        }
      }
    }
  }

  /**
   * Discover accounts using a template method
   * The integrator must define getAccountExtendedPublicKey(accountIndex:number):string
   * which should return the base58, BIP32 extended public key for that accountIndex(private keys would work as well but it is not recommended as
   * it is unnecessary)
   * This account key is the last hardened key from the path, from wich the algorithm can derive the corresponding addresses
   * @param config
   */
  async discoverAccounts (config: DiscoveryConfig, accountReader?: AccountReaderFunction): Promise<void> {
    let ended: boolean = false
    let currentAccount: number = 0
    const smartWalletFactory = new this.web3.eth.Contract(proxyFactoryAbi as any, config.factory)
    const creationByteCode = await smartWalletFactory.methods.getCreationBytecode().call()
    const bytecodeHash = this.web3.utils.keccak256(creationByteCode)
    const chainId = await this.web3.eth.getChainId()
    const logicAddress = config.logic ?? constants.ZERO_ADDRESS
    const initParamsHash = config.logicParamsHash ?? constants.SHA3_NULL_S

    while (!ended) {
      const gapLimit = config.eoaGap
      let totalTrxCount = 0
      let totalSWTrxCount = 0
      let currentGap = 0
      let index = 0

      const accountReaderFunc = accountReader ?? this.getAccountExtendedPublicKey

      const currentAccountPubK = await accountReaderFunc(currentAccount)

      if (currentAccountPubK === undefined || currentAccountPubK === null) {
        ended = true
        break
      }

      const hdAcckey: EthereumHDKey = EthereumHDKey.fromExtendedKey(currentAccountPubK) // Account key (last hardened key)

      while (currentGap <= gapLimit) {
        const currentPubKey: EthereumHDKey = hdAcckey.deriveChild(index)
        const currentAddress = currentPubKey.getWallet().getAddressString()

        const activityFound = await this.searchTrx(currentAddress, smartWalletFactory)
        const discoveredAccount: DiscoveredAccount = { eoaAccount: constants.ZERO_ADDRESS, swAccounts: [] }

        if (activityFound) {
          discoveredAccount.eoaAccount = currentAddress
          totalTrxCount++
          currentGap = 0 // reset the gap between accounts
        } else {
          currentGap++
        }

        index++

        let currentSWGap = 0
        let walletIndex = 0

        while (currentSWGap <= config.sWalletGap) {
          const currentSWAddress = config.isCustomWallet ? this.calculateCustomSmartWalletAddress(currentAddress, config.recoverer,
            logicAddress, initParamsHash, walletIndex, config.factory, bytecodeHash, chainId)
            : this.calculateSmartWalletAddress(currentAddress, config.recoverer, walletIndex, config.factory, bytecodeHash, chainId)

          const swActivityFound = await this.searchTrx(currentSWAddress, smartWalletFactory)

          if (swActivityFound) {
            discoveredAccount.swAccounts.push(currentSWAddress)
            totalSWTrxCount++
            currentSWGap = 0
            currentGap = 0
          } else {
            currentSWGap++
          }

          walletIndex++
        }

        if (discoveredAccount.swAccounts.length > 0 && discoveredAccount.eoaAccount === constants.ZERO_ADDRESS) {
          discoveredAccount.eoaAccount = currentAddress
        }

        if (discoveredAccount.eoaAccount !== constants.ZERO_ADDRESS || discoveredAccount.swAccounts.length > 0) {
          this.accounts.push(discoveredAccount)
        }
      }

      if (totalTrxCount === 0 && totalSWTrxCount === 0) {
        ended = true // Stop looking for accounts
      } else {
        currentAccount++ // Move to next hardened account key
      }
    }
  }

  public static getRootExtKeyFromMnemonic (mnemonic: string, password?: string, language?: TMnemonicLanguage): EthereumHDKey {
    let wordlist: string[]

    switch (language) {
      case TMnemonicLanguage.CZECH:
        wordlist = wordlistCzech
        break
      case TMnemonicLanguage.ENGLISH:
        wordlist = wordlistEnglish
        break
      case TMnemonicLanguage.FRENCH:
        wordlist = wordlistFrench
        break
      case TMnemonicLanguage.ITALIAN:
        wordlist = wordlistItalian
        break
      case TMnemonicLanguage.JAPANESE:
        wordlist = wordlistJapanese
        break
      case TMnemonicLanguage.KOREAN:
        wordlist = wordlistKorean
        break
      case TMnemonicLanguage.SIMPLIFIED_CHINESE:
        wordlist = wordlistSChinese
        break
      case TMnemonicLanguage.SPANISH:
        wordlist = wordlistSpanish
        break
      case TMnemonicLanguage.TRADITIONAL_CHINESE:
        wordlist = wordlistTChinese
        break
      default:
        wordlist = wordlistEnglish
        break
    }

    if (!bip39.validateMnemonic(mnemonic, wordlist)) {
      throw new Error('Mnemonic invalid or undefined')
    }

    return EthereumHDKey.fromMasterSeed(
      bip39.mnemonicToSeedSync(mnemonic, password))
  }

  async getAccountExtendedPublicKey (accountIdx: number): Promise<string | undefined> {
    // TODO implement by integrator
    return undefined
  }

  pubKeyToAddress (pubKey: Buffer): string {
    return ethUtils.bufferToHex(ethUtils.pubToAddress(pubKey))
  }

  private async sleep (ms: number): Promise<void> {
    return await new Promise(resolve => setTimeout(resolve, ms))
  }

  private async reconnect (): Promise<void> {
    let reconnected: boolean = false
    let attempts: number = 0

    while (!reconnected && attempts <= this.reconnectionAttempts) {
      await this.sleep(5000)

      try {
        this.web3 = new Web3(this.provider)
        reconnected = true
      } catch (error) {
        attempts++
      }

      if (!reconnected) {
        throw new Error('Unable to reconnect to RSKJ Node')
      }
    }
  }

  private async searchTrx (currentAddress: string, factory?: Contract): Promise<boolean> {
    let activityFound: boolean = false
    try {
      // Check if the account has native cryptocurrency balance
      activityFound = (new BN(await this.web3.eth.getBalance(currentAddress))).gtn(0)
    } catch (error) {
      await this.reconnect()
      activityFound = (new BN(await this.web3.eth.getBalance(currentAddress))).gtn(0)
    }

    if (activityFound) {
      // console.log("FOUND BY NATIVE BALANCE")
    }

    if (!activityFound) {
      try {
      // Check if the account has submitted transactions
        activityFound = await this.web3.eth.getTransactionCount(currentAddress) > 0
      } catch (error) {
        await this.reconnect()
        activityFound = await this.web3.eth.getTransactionCount(currentAddress) > 0
      }

      if (activityFound) {
        // console.log("FOUND BY NONCE" )
      }

      if (!activityFound) {
        // Check if the account has balance in any of the expected tokens
        const balanceFunction = this.web3.eth.abi.encodeFunctionCall({
          name: 'balanceOf',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: '_owner'
            }
          ]
        }, [currentAddress])

        let i = 0
        let errorCount = 0 // consecutive disconnections when trying to do an eth call

        while (!activityFound && i < this.tokens.length && errorCount < this.reconnectionAttempts) {
          try {
            const tokenBalance = await this.web3.eth.call({ to: this.tokens[i], data: balanceFunction })

            if (tokenBalance !== undefined && tokenBalance !== null && typeof tokenBalance === 'string') {
              activityFound = Number(tokenBalance) > 0
            }

            i++
            errorCount = 0
          } catch (error) {
            errorCount++
            await this.reconnect()
          }
        }

        if (activityFound) {
          // console.log("FOUND BY TOKEN BALANCE")
        }

        // It would never arrive to this point, but it is a good example to
        // find smart wallets that for some reason didn't show up with getTransactionCount
        // Any properly initialized SmartWallet would be found in that step

        /* if(!activityFound){

         //Deployed SmartWallets will have nonce > 0. This section

         const events = await factory.getPastEvents('Deployed', {
           filter:{
            addr:currentAddress
           },
           fromBlock:"earliest",
           toBlock:"latest"
         })

         if(events.length>0){
            activityFound = true
          }

          if(activityFound){
            console.log("FOUND BY DEPLOY EVENT")
          }
        } */
      }
    }

    return activityFound
  }

  public calculateSmartWalletAddress (ownerEOA: string, recoverer: string, walletIndex: number, factory: string, bytecodeHash: string, chainId: number): string {
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

  public calculateCustomSmartWalletAddress (ownerEOA: string, recoverer: string, logicAddress: string, initParamsHash: string, walletIndex: number, factory: string, bytecodeHash: string, chainId: number): string {
    const salt: string = web3.utils.soliditySha3(
      { t: 'address', v: ownerEOA },
      { t: 'address', v: recoverer },
      { t: 'address', v: logicAddress },
      { t: 'bytes32', v: initParamsHash ?? constants.SHA3_NULL_S },
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
}

import HttpClient from './HttpClient'
import {
  DeployRequest,
  RelayRequest,
  DeployTransactionRequest,
  RelayMetadata,
  RelayTransactionRequest,
  constants,
  EnvelopingConfig,
  getDomainSeparatorHash,
  TypedDeployRequestData,
  TypedRequestData
} from '@rsksmart/rif-relay-common'

import HttpWrapper from './HttpWrapper'
import { HttpProvider } from 'web3-core'
import { RelayingAttempt } from './RelayClient'
import { getDependencies, EnvelopingDependencies } from './Configurator'
import { Address, IntString } from './types/Aliases'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { DiscoveryConfig, SmartWalletDiscovery, Web3Provider, AccountReaderFunction, DiscoveredAccount } from './SmartWalletDiscovery'
import Web3 from 'web3'
import { toHex } from 'web3-utils'

const zeroAddr = constants.ZERO_ADDRESS

export interface SignatureProvider {
  sign: (dataToSign: TypedRequestData) => PrefixedHexString
  verifySign: (signature: PrefixedHexString, dataToSign: TypedRequestData, request: RelayRequest|DeployRequest) => boolean
}

export class Enveloping {
  config: EnvelopingConfig
  relayWorkerAddress: Address
  dependencies: EnvelopingDependencies
  private initialized: boolean

  constructor (_config: EnvelopingConfig, _web3: Web3, _relayWorkerAddress: Address) {
    this.config = _config
    this.initialized = false
    this.dependencies = getDependencies(this.config, _web3.currentProvider as HttpProvider)
    this.relayWorkerAddress = _relayWorkerAddress
  }

  async _init (): Promise<void> {
    if (!this.initialized) {
      await this.dependencies.contractInteractor.init()
      this.initialized = true
    } else {
      throw new Error('_init was already called')
    }
  }

  /**
    * creates a deploy request
    * @param from - sender's wallet address (EOA)
    * @param tokenContract - the token the user will use to pay to the Worker for deploying the SmartWallet
    * @param tokenAmount - the token amount the user will pay for the deployment, zero if the deploy is subsidized
    * @param tokenGas - gas limit of the token payment
    * @param  gasPrice - optional: if not set the gasPrice is calculated internally
    * @param  index - optional: allows the user to create multiple SmartWallets
    * @param  recoverer optional: This SmartWallet instance won't have recovery support
    * @return a deploy request structure.
    */
  async createDeployRequest (from: Address, tokenContract: Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString, index? : IntString, recoverer? : IntString): Promise<DeployRequest> {
    const deployRequest: DeployRequest = {
      request: {
        relayHub: this.config.relayHubAddress,
        from: from,
        to: zeroAddr,
        value: '0',
        nonce: (await this.getFactoryNonce(this.config.smartWalletFactoryAddress, from)).toString(),
        data: '0x',
        tokenContract: tokenContract,
        tokenAmount: tokenAmount,
        tokenGas: tokenGas,
        recoverer: recoverer ?? constants.ZERO_ADDRESS,
        index: index ?? '0'
      },
      relayData: {
        gasPrice: gasPrice ?? await web3.eth.getGasPrice(),
        relayWorker: this.relayWorkerAddress,
        callForwarder: this.config.smartWalletFactoryAddress,
        callVerifier: this.config.deployVerifierAddress,
        domainSeparator: getDomainSeparatorHash(this.config.smartWalletFactoryAddress, this.config.chainId)
      }
    }

    return deployRequest
  }

  /**
 * Estimates the gas that needs to be put in the RelayRequest's gas field
 * @param forwarder the smart wallet address
 * @param to the destination contract address
 * @param gasPrice the gasPrice to use in the transaction
 * @param data the ABI-encoded method to call in the destination contract
 * @param addCushion if true, it adds a cushion factor (if configured in the environment)
 * @returns The estimated value in gas units
 */
  async estimateDestinationContractInternalCallGas (forwarder: Address, to: Address, data: PrefixedHexString, gasPrice?: IntString, addCushion: boolean = true): Promise<number> {
    // For relay calls, transactionDetails.gas is only the portion of gas sent to the destination contract, the tokenPayment
    // Part is done before, by the SmartWallet

    return await this.dependencies.contractInteractor.estimateDestinationContractCallGas({
      from: forwarder,
      to,
      gasPrice: gasPrice ?? await web3.eth.getGasPrice(),
      data
    }, addCushion)
  }

  /**
    * creates a relay request
    * @param from - sender's wallet address (EOA)
    * @param to - recipient contract
    * @param forwarder - smart wallet address forwarding the relay request
    * @param data - payload for the execution (e.g. encoded call when invoking an smart contract)
    * @param gasLimit - gas limit of the relayed transaction
    * @param tokenContract - the token the user will use to pay to the Worker for relaying
    * @param tokenAmount - the token amount the user will pay for relaying, zero if the call is subsidized
    * @param tokenGas - gas limit of the token payment
    * @param  gasPrice - optional: if not set, the gasPrice is calculated internally
    * @return a relay request structure.
    */
  async createRelayRequest (from: Address, to: Address, forwarder: Address, data: PrefixedHexString, tokenContract: Address, tokenAmount: IntString, tokenGas: IntString, gasLimit?: IntString, gasPrice?: IntString): Promise<RelayRequest> {
    let gasToSend = gasLimit
    const gasPriceToSend = gasPrice ?? await web3.eth.getGasPrice()

    if (gasToSend === undefined || gasToSend == null) {
      const internalCallCost = await this.estimateDestinationContractInternalCallGas(forwarder, to, data, gasPriceToSend)
      gasToSend = toHex(internalCallCost)
    }

    const relayRequest: RelayRequest = {
      request: {
        relayHub: this.config.relayHubAddress,
        from: from,
        to: to,
        data: data,
        value: '0',
        gas: gasToSend,
        nonce: (await this.getSenderNonce(forwarder)).toString(),
        tokenContract: tokenContract,
        tokenAmount: tokenAmount,
        tokenGas: tokenGas
      },
      relayData: {
        gasPrice: gasPriceToSend,
        relayWorker: this.relayWorkerAddress,
        callForwarder: forwarder,
        callVerifier: this.config.relayVerifierAddress,
        domainSeparator: getDomainSeparatorHash(forwarder, this.config.chainId)
      }
    }

    return relayRequest
  }

  /**
    * signs a deploy request and verifies if it's correct.
    * @param signatureProvider - provider provided by the developer
    * @param request - A deploy request
    * @return signature of a deploy request
    */
  signDeployRequest (signatureProvider: SignatureProvider, request: DeployRequest): PrefixedHexString {
    const cloneRequest = { ...request }
    const dataToSign = new TypedDeployRequestData(
      this.config.chainId,
      this.config.smartWalletFactoryAddress,
      cloneRequest
    )
    return this.signAndVerify(signatureProvider, dataToSign, request)
  }

  /**
    * signs a relay request and verifies if it's correct.
    * @param signatureProvider - provider provided by the developer
    * @param request - A relay request
    * @return signature of a relay request
    */
  signRelayRequest (signatureProvider: SignatureProvider, request: RelayRequest): PrefixedHexString {
    const cloneRequest = { ...request }
    const dataToSign = new TypedRequestData(
      this.config.chainId,
      request.relayData.callForwarder,
      cloneRequest
    )

    return this.signAndVerify(signatureProvider, dataToSign, request)
  }

  signAndVerify (signatureProvider: SignatureProvider, dataToSign: TypedRequestData, request: RelayRequest|DeployRequest): PrefixedHexString {
    const signature = signatureProvider.sign(dataToSign)
    if (!signatureProvider.verifySign(signature, dataToSign, request)) {
      throw new Error('Internal exception: signature is not correct')
    }
    return signature
  }

  /**
    * creates a deploy transaction request ready for sending through http
    * @param signature - the signature of a deploy request
    * @param deployRequest - the signed deploy request
    * @return a deploy transaction request
    */
  async generateDeployTransactionRequest (signature: PrefixedHexString, deployRequest: DeployRequest): Promise<DeployTransactionRequest> {
    const request: DeployTransactionRequest = {
      relayRequest: deployRequest,
      metadata: await this.generateMetadata(signature)
    }

    return request
  }

  /**
    * creates a realy transaction request ready for sending through http
    * @param signature - the signature of a relay request
    * @param relayRequest - the signed relay request
    * @return a relay transaction request
    */
  async generateRelayTransactionRequest (signature: PrefixedHexString, relayRequest: RelayRequest): Promise<RelayTransactionRequest> {
    const request: RelayTransactionRequest = {
      relayRequest,
      metadata: await this.generateMetadata(signature)
    }

    return request
  }

  async generateMetadata (signature: PrefixedHexString): Promise<RelayMetadata> {
    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature: signature,
      relayMaxNonce: await this.dependencies.contractInteractor.getTransactionCount(this.relayWorkerAddress) + this.config.maxRelayNonceGap
    }

    return metadata
  }

  async getSenderNonce (sWallet: Address): Promise<IntString> {
    return await this.dependencies.contractInteractor.getSenderNonce(sWallet)
  }

  async getFactoryNonce (factoryAddr: Address, from: Address): Promise<IntString> {
    return await this.dependencies.contractInteractor.getFactoryNonce(factoryAddr, from)
  }

  /**
    * sends the request to the relay server.
    * @param relayUrl - the relay server's url e.g. http:localhost:8090
    * @param request - the request ready to send through http
    * @return transaction hash if the sending process was correct, otherwise the error
    */
  async sendTransaction (relayUrl: string, request: DeployTransactionRequest|RelayTransactionRequest): Promise<RelayingAttempt> {
    const httpClient = new HttpClient(new HttpWrapper(), {})
    try {
      const hexTransaction = await httpClient.relayTransaction(relayUrl, request)
      console.log(`hexTrx is ${hexTransaction}`)
      const transaction = new Transaction(hexTransaction, this.dependencies.contractInteractor.getRawTxOptions())
      const txHash: string = transaction.hash(true).toString('hex')
      const hash = `0x${txHash}`
      console.log('tx hash: ' + hash)
      return { transaction }
    } catch (error) {
      const reasonStr = error instanceof Error ? error.message : JSON.stringify(error)
      console.log(`GOT ERROR - Reason: ${reasonStr}`)
      return { error }
    }
  }

  /**
   * Discovers all EOA accounts and their associated Smart Wallet accounts
   * @param config - Configuration for running the Discovery Algorithm
   * @param provider - Web3 Provider to use when connecting to the node via RPC
   * @param mnemonic - Mnemonic phrase from where to recover the account addresses
   * @param password - If the Mnemonic is password protected, it must be passed
   * @param supportedTokens - List of tokens to use when searching for accounts' token activity
   * @returns - List of discovered accounts, discoveredAccount.eoaAccount contains the discovered EOA and discoveredAccount.swAccounts all the discovered Smart Wallets for that EOA
   */
  public static async discoverAccountsUsingMnemonic (config: DiscoveryConfig, provider: provider, mnemonic: string, password?: string, supportedTokens?: Address[], providerOverride?: provider):
  Promise<DiscoveredAccount[]> {
    const swd = new SmartWalletDiscovery(provider as Web3Provider, supportedTokens)
    await swd.discoverAccountsFromMnemonic(config, mnemonic, password)

    return swd.accounts
  }

  /**
  * Discovers all EOA accounts and their associated Smart Wallet accounts given a predefined list of extended public keys
  * @param config - Configuration for running the Discovery Algorithm
  * @param extendedPublicKeys - List of extended public keys representing the Accounts (last hardened key from the path) from which to derive the account addresses.
  * e.g, for RSK Mainnet it would be the list of keys of the path m/44'/137'/accountIdx'/0 where accountIdx is a numeric value indicating the index of the account key, if the array would
  * contain Accounts 0 and 1, it must have an array with the extended public keys of  m/44'/137'/0'/0 and  m/44'/137'/1'/0
  * @param provider - Web3 Provider to use when connecting to the node via RPC
  * @param supportedTokens - List of tokens to use when searching for accounts' token activity
  * @returns - List of discovered accounts, discoveredAccount.eoaAccount contains the discovered EOA and discoveredAccount.swAccounts all the discovered Smart Wallets for that EOA
  */
  public static async discoverAccountsFromExtendedPublicKeys (config: DiscoveryConfig, provider: provider, extendedPublicKeys: string[], supportedTokens?: Address[]):
  Promise<DiscoveredAccount[]> {
    const swd = new SmartWalletDiscovery(provider as Web3Provider, supportedTokens)
    await swd.discoverAccountsFromExtendedPublicKeys(config, extendedPublicKeys)

    return swd.accounts
  }

  /**
* Discovers all EOA accounts and their associated Smart Wallet accounts given a reader function that will fetch the next extended public key to use
* @param config - Configuration for running the Discovery Algorithm
* @param accountReader - The reader function. Given an accountIdx:number it should return the next extended public key to use. If the function is
* left undefined, then it is expected from the library integrator to implement SmartWalletDiscovery::getAccountExtendedPublicKey; otherwise the
* discovery algorithm won't find any accounts
* @param provider - Web3 Provider to use when connecting to the node via RPC
* @param supportedTokens - List of tokens to use when searching for accounts' token activity
* @returns - List of discovered accounts, discoveredAccount.eoaAccount contains the discovered EOA and discoveredAccount.swAccounts all the discovered Smart Wallets for that EOA
*/
  public static async discoverAccounts (config: DiscoveryConfig, provider: provider, accountReader?: AccountReaderFunction, supportedTokens?: Address[]):
  Promise<DiscoveredAccount[]> {
    const swd = new SmartWalletDiscovery(provider as Web3Provider, supportedTokens)
    await swd.discoverAccounts(config, accountReader)

    return swd.accounts
  }
}

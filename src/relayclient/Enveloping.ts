import HttpClient from './HttpClient'
import { DeployRequest, RelayRequest } from '../common/EIP712/RelayRequest'

import { DeployTransactionRequest, RelayMetadata, RelayTransactionRequest } from './types/RelayTransactionRequest'
import HttpWrapper from './HttpWrapper'
import { constants } from '../common/Constants'
import { HttpProvider } from 'web3-core'
import { RelayingAttempt } from './RelayClient'

import { getDependencies, EnvelopingConfig, EnvelopingDependencies } from './Configurator'
import { Address, IntString } from './types/Aliases'

import { PrefixedHexString, Transaction } from 'ethereumjs-tx'

import TypedRequestData, { getDomainSeparatorHash, TypedDeployRequestData } from '../common/EIP712/TypedRequestData'

const zeroAddr = '0x0000000000000000000000000000000000000000'

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
    * @param gasLimit - gas limit of the relayed transaction
    * @param tokenContract - the token the user will use to pay to the Worker for deploying the SmartWallet
    * @param tokenAmount - the token amount the user will pay for the deployment, zero if the deploy is subsidized
    * @param tokenGas - gas limit of the token payment
    * @param  gasPrice - optional: if not set the gasPrice is calculated internally through a call to estimateGas
    * @param  index - optional: allows the user to create multiple SmartWallets
    * @param  recoverer optional: This SmartWallet instance won't have recovery support
    * @return a deploy request structure.
    */
  async createDeployRequest (from: Address, gasLimit: IntString, tokenContract: Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString, index? : IntString, recoverer? : IntString): Promise<DeployRequest> {
    const deployRequest: DeployRequest = {
      request: {
        relayHub: this.config.relayHubAddress,
        from: from,
        to: zeroAddr,
        value: '0',
        gas: gasLimit, // overhead (cte) + fee + (estimateDeploy * 1.1)
        nonce: (await this.getFactoryNonce(this.config.smartWalletFactoryAddress, from)).toString(),
        data: '0x',
        tokenContract: tokenContract,
        tokenAmount: tokenAmount,
        tokenGas: tokenGas,
        recoverer: recoverer ?? constants.ZERO_ADDRESS,
        index: index ?? '0'
      },
      relayData: {
        gasPrice: gasPrice ?? '0',
        relayWorker: this.relayWorkerAddress,
        callForwarder: this.config.smartWalletFactoryAddress,
        callVerifier: this.config.deployVerifierAddress,
        domainSeparator: getDomainSeparatorHash(this.config.smartWalletFactoryAddress, this.config.chainId)
      }
    }

    return deployRequest
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
    * @param  gasPrice - optional: if not set the gasPrice is calculated internally through a call to estimateGas
    * @return a relay request structure.
    */
  async createRelayRequest (from: Address, to: Address, forwarder: Address, data: PrefixedHexString, gasLimit: IntString, tokenContract: Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString): Promise<RelayRequest> {
    const relayRequest: RelayRequest = {
      request: {
        relayHub: this.config.relayHubAddress,
        from: from,
        to: to,
        data: data,
        value: '0',
        gas: gasLimit,
        nonce: (await this.getSenderNonce(forwarder)).toString(),
        tokenContract: tokenContract,
        tokenAmount: tokenAmount,
        tokenGas: tokenGas
      },
      relayData: {
        gasPrice: gasPrice ?? '0',
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
}

// @ts-ignore
import abiDecoder from 'abi-decoder'
import log from 'loglevel'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { HttpProvider } from 'web3-core'

import relayHubAbi from '../common/interfaces/IRelayHub.json'
import { _dumpRelayingResult, RelayClient } from './RelayClient'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { configureGSN, GSNConfig, GSNDependencies } from './GSNConfigurator'
import { Transaction } from 'ethereumjs-tx'
import { AccountKeypair } from './AccountManager'
import { GsnEvent } from './GsnEvents'
import { constants } from '../common/Constants'
import { Address } from './types/Aliases'
import { toChecksumAddress } from 'web3-utils'

abiDecoder.addABI(relayHubAbi)

export interface BaseTransactionReceipt {
  logs: any[]
  status: string | boolean
}

export type JsonRpcCallback = (error: Error | null, result?: JsonRpcResponse) => void

interface ISendAsync {
  sendAsync?: any
}

export class RelayProvider implements HttpProvider {
  protected readonly origProvider: HttpProvider & ISendAsync
  private readonly origProviderSend: any
  protected readonly config: GSNConfig

  readonly relayClient: RelayClient

  /**
   * create a proxy provider, to relay transaction
   * @param overrideDependencies
   * @param relayClient
   * @param origProvider - the underlying web3 provider
   * @param gsnConfig
   */
  constructor (origProvider: HttpProvider, gsnConfig: Partial<GSNConfig>, overrideDependencies?: Partial<GSNDependencies>, relayClient?: RelayClient) {
    const config = configureGSN(gsnConfig)
    this.host = origProvider.host
    this.connected = origProvider.connected

    this.origProvider = origProvider
    this.config = config
    if (typeof this.origProvider.sendAsync === 'function') {
      this.origProviderSend = this.origProvider.sendAsync.bind(this.origProvider)
    } else {
      this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    }
    this.relayClient = relayClient ?? new RelayClient(origProvider, gsnConfig, overrideDependencies)

    this._delegateEventsApi(origProvider)
  }

  registerEventListener (handler: (event: GsnEvent) => void): void {
    this.relayClient.registerEventListener(handler)
  }

  unregisterEventListener (handler: (event: GsnEvent) => void): void {
    this.relayClient.unregisterEventListener(handler)
  }

  _delegateEventsApi (origProvider: HttpProvider): void {
    // If the subprovider is a ws or ipc provider, then register all its methods on this provider
    // and delegate calls to the subprovider. This allows subscriptions to work.
    ['on', 'removeListener', 'removeAllListeners', 'reset', 'disconnect', 'addDefaultEvents', 'once', 'reconnect'].forEach(func => {
      // @ts-ignore
      if (origProvider[func] !== undefined) {
        // @ts-ignore
        this[func] = origProvider[func].bind(origProvider)
      }
    })
  }

  send (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    if (this._useGSN(payload)) {
      if (payload.method === 'eth_sendTransaction') {
        if (payload.params[0].to === undefined) {
          throw new Error('GSN cannot relay contract deployment transactions. Add {from: accountWithEther, useGSN: false}.')
        }
        this._ethSendTransaction(payload, callback)
        return
      }
      if (payload.method === 'eth_getTransactionReceipt') {
        this._ethGetTransactionReceipt(payload, callback)
        return
      }
      if (payload.method === 'eth_accounts') {
        this._getAccounts(payload, callback)
        return
      }
    }

    this.origProviderSend(this._getPayloadForRSKProvider(payload), (error: Error | null, result?: JsonRpcResponse) => {
      callback(error, result)
    })
  }

  /**
   * Generates a Enveloping deploy transaction, to deploy the Smart Wallet of the requester
   * @param gsnTransactionDetails All the necessary information for creating the deploy request
   * from:address => EOA of the Smart Wallet owner
   * to:address => Optional custom logic address
   * data:bytes => init params for the optional custom logic
   * tokenContract:address => Token used to pay for the deployment, can be address(0) if the deploy is subsidized
   * tokenAmount:IntString => Amount of tokens paid for the deployment, can be 0 if the deploy is subsidized
   * factory:address => Address of the factory used to deploy the Smart Wallet
   * recoverer:address => Optional recoverer account/contract, can be address(0)
   * index:IntString => Numeric value used to generate several SW instances using the same paramaters defined above
   *
   * value: Not used here, only used in other scenarios where the worker account of the relay server needs to replenish balance.
   * Any value put here wont be sent to the "to" property, it won't be moved at all.
   *
   * @returns The transaction hash
   */
  async deploySmartWallet (gsnTransactionDetails: GsnTransactionDetails): Promise<string> {
    if (gsnTransactionDetails.isSmartWalletDeploy === undefined || !gsnTransactionDetails.isSmartWalletDeploy) {
      throw new Error('Request is not for SmartWallet deploy')
    }

    try {
      const relayingResult = await this.relayClient.relayTransaction(gsnTransactionDetails)
      if (relayingResult.transaction != null) {
        const txHash: string = relayingResult.transaction.hash(true).toString('hex')
        const hash = `0x${txHash}`
        return hash
      } else {
        const message = `Failed to relay call. Results:\n${_dumpRelayingResult(relayingResult)}`
        log.error(message)
        throw new Error(message)
      }
    } catch (error) {
      const reasonStr = error instanceof Error ? error.message : JSON.stringify(error)
      log.info('Rejected deploy wallet call', error)
      throw new Error(`Rejected deploy wallet call - Reason: ${reasonStr}`)
    }
  }

  /**
   * @param ownerEOA EOA of the Smart Wallet onwer
   * @param recoverer Address of a recoverer account, can be smart contract. It's used in gasless tokens, can be address(0) if desired
   * @param customLogic An optional custom logic code that the wallet will proxy to as fallback, optional, can be address(0)
   * @param walletIndex Numeric value used to generate different wallet instances for the owner using the same parameters and factory
   * @param logicInitParamsHash If customLogic was defined and it needs initialization params, they are passed as abi-encoded here, do not include the function selector
   * If there are no initParams, logicInitParamsHash must not be passed, or, since (hash of empty byte array = null) must be passed as null or as zero
   */
  calculateSmartWalletAddress (factory: Address, ownerEOA: Address, recoverer: Address, customLogic: Address, walletIndex: number, bytecodeHash: string, logicInitParamsHash?: string): Address {
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

    return toChecksumAddress('0x' + _data.slice(26, _data.length), this.config.chainId)
  }

  calculateSimpleSmartWalletAddress (factory: Address, ownerEOA: Address, recoverer: Address, walletIndex: number, bytecodeHash: string): Address {
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

    return toChecksumAddress('0x' + _data.slice(26, _data.length), this.config.chainId)
  }

  _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    log.info('calling sendAsync' + JSON.stringify(payload))
    this.origProviderSend(payload, (error: Error | null, rpcResponse?: JsonRpcResponse): void => {
      // Sometimes, ganache seems to return 'false' for 'no error' (breaking TypeScript declarations)
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (error) {
        callback(error, rpcResponse)
        return
      }
      if (rpcResponse == null || rpcResponse.result == null) {
        // Commenting out this line: RSKJ replies immediatly with a null response if the transaction
        // is still pending to be mined
        // (console.error('Empty JsonRpcResponse with no error message')
        callback(error, rpcResponse)
        return
      }
      rpcResponse.result = this._getTranslatedGsnResponseResult(rpcResponse.result)
      callback(error, rpcResponse)
    })
  }

  _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    log.info('calling sendAsync' + JSON.stringify(payload))
    let gsnTransactionDetails: GsnTransactionDetails = payload.params[0]

    if (gsnTransactionDetails.callForwarder === undefined || gsnTransactionDetails.callForwarder === null || gsnTransactionDetails.callForwarder === constants.ZERO_ADDRESS) {
      gsnTransactionDetails = { ...payload.params[0], callForwarder: this.config.forwarderAddress }
    }
    this.relayClient.relayTransaction(gsnTransactionDetails)
      .then((relayingResult) => {
        if (relayingResult.transaction != null) {
          const jsonRpcSendResult = this._convertTransactionToRpcSendResponse(relayingResult.transaction, payload)
          callback(null, jsonRpcSendResult)
        } else {
          const message = `Failed to relay call. Results:\n${_dumpRelayingResult(relayingResult)}`
          log.error(message)
          callback(new Error(message))
        }
      }, (reason: any) => {
        const reasonStr = reason instanceof Error ? reason.message : JSON.stringify(reason)
        log.info('Rejected relayTransaction call', reason)
        callback(new Error(`Rejected relayTransaction call - Reason: ${reasonStr}`))
      })
  }

  _convertTransactionToRpcSendResponse (transaction: Transaction, request: JsonRpcPayload): JsonRpcResponse {
    const txHash: string = transaction.hash(true).toString('hex')
    const hash = `0x${txHash}`
    const id = (typeof request.id === 'string' ? parseInt(request.id) : request.id) ?? -1
    return {
      jsonrpc: '2.0',
      id,
      result: hash
    }
  }

  // TODO: Seems not used anymore, double check and remove
  _getTranslatedGsnResponseResult (respResult: BaseTransactionReceipt): BaseTransactionReceipt {
    const fixedTransactionReceipt = Object.assign({}, respResult)
    if (respResult.logs === null || respResult.logs.length === 0) {
      return fixedTransactionReceipt
    }
    const logs = abiDecoder.decodeLogs(respResult.logs)
    const recipientRejectedEvents = logs.find((e: any) => e != null && e.name === 'TransactionRelayedButRevertedByRecipient')

    if (recipientRejectedEvents !== undefined && recipientRejectedEvents !== null) {
      const recipientRejectionReason: { value: string } = recipientRejectedEvents.events.find((e: any) => e.name === 'reason')
      if (recipientRejectionReason !== undefined && recipientRejectionReason !== null) {
        log.info(`Recipient rejected on-chain: ${recipientRejectionReason.value}. changing status to zero`)
        fixedTransactionReceipt.status = '0'
      }
      return fixedTransactionReceipt
    }

    const transactionRelayed = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')
    if (transactionRelayed !== undefined && transactionRelayed !== null) {
      const transactionRelayedStatus = transactionRelayed.events.find((e: any) => e.name === 'status')
      if (transactionRelayedStatus !== undefined && transactionRelayedStatus !== null) { // status was removed
        const status: string = transactionRelayedStatus.value.toString()
        // 0 signifies success
        if (status !== '0') {
          log.info(`reverted relayed transaction, status code ${status}. changing status to zero`)
          fixedTransactionReceipt.status = '0'
        }
      }
    }
    return fixedTransactionReceipt
  }

  _useGSN (payload: JsonRpcPayload): boolean {
    if (payload.method === 'eth_accounts') {
      return true
    }
    if (payload.params[0] === undefined) {
      return false
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    return gsnTransactionDetails?.useGSN ?? true
  }

  /* wrapping HttpProvider interface */

  host: string
  connected: boolean

  supportsSubscriptions (): boolean {
    return this.origProvider.supportsSubscriptions()
  }

  disconnect (): boolean {
    return this.origProvider.disconnect()
  }

  newAccount (): AccountKeypair {
    return this.relayClient.accountManager.newAccount()
  }

  addAccount (keypair: AccountKeypair): void {
    this.relayClient.accountManager.addAccount(keypair)
  }

  _getAccounts (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    this.origProviderSend(payload, (error: Error | null, rpcResponse?: JsonRpcResponse): void => {
      if (rpcResponse != null && Array.isArray(rpcResponse.result)) {
        const ephemeralAccounts = this.relayClient.accountManager.getAccounts()
        rpcResponse.result = rpcResponse.result.concat(ephemeralAccounts)
      }
      callback(error, rpcResponse)
    })
  }

  // The RSKJ node doesn't support additional parameters in RPC calls.
  // When using the original provider with the RSKJ node it is necessary to remove the additional useGSN property.
  _getPayloadForRSKProvider (payload: JsonRpcPayload): JsonRpcPayload {
    let p: JsonRpcPayload = payload

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (payload.params[0]?.hasOwnProperty('useGSN') || payload.params[0]?.hasOwnProperty('callVerifier')) {
      // Deep copy the payload to safely remove the useGSN property
      p = JSON.parse(JSON.stringify(payload))

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (payload.params[0]?.hasOwnProperty('useGSN')) {
        delete p.params[0].useGSN
      }

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (payload.params[0]?.hasOwnProperty('callVerifier')) {
        delete p.params[0].callVerifier
      }

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (payload.params[0]?.hasOwnProperty('forceGasPrice')) {
        delete p.params[0].forceGasPrice
      }

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (payload.params[0]?.hasOwnProperty('callForwarder')) {
        delete p.params[0].callForwarder
      }

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (payload.params[0]?.hasOwnProperty('isSmartWalletDeploy')) {
        delete p.params[0].isSmartWalletDeploy
      }
    }

    return p
  }
}

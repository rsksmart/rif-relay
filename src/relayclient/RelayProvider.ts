// @ts-ignore
import abiDecoder from 'abi-decoder'
import log from 'loglevel'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { HttpProvider } from 'web3-core'

import relayHubAbi from '../common/interfaces/IRelayHub.json'
import walletFactoryAbi from '../common/interfaces/IWalletFactory.json'

import { _dumpRelayingResult, RelayClient } from './RelayClient'
import EnvelopingTransactionDetails from './types/EnvelopingTransactionDetails'
import { configure, EnvelopingConfig, EnvelopingDependencies } from './Configurator'
import { Transaction } from 'ethereumjs-tx'
import { AccountKeypair } from './AccountManager'
import { RelayEvent } from './RelayEvents'
import { constants } from '../common/Constants'
import { Address } from './types/Aliases'
import { toBN, toChecksumAddress, toHex } from 'web3-utils'

abiDecoder.addABI(relayHubAbi)
abiDecoder.addABI(walletFactoryAbi)

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
  protected readonly config: EnvelopingConfig

  readonly relayClient: RelayClient

  /**
   * create a proxy provider, to relay transaction
   * @param overrideDependencies
   * @param relayClient
   * @param origProvider - the underlying web3 provider
   * @param envelopingConfig
   */
  constructor (origProvider: HttpProvider, envelopingConfig: Partial<EnvelopingConfig>, overrideDependencies?: Partial<EnvelopingDependencies>, relayClient?: RelayClient) {
    const config = configure(envelopingConfig)
    this.host = origProvider.host
    this.connected = origProvider.connected

    this.origProvider = origProvider
    this.config = config
    if (typeof this.origProvider.sendAsync === 'function') {
      this.origProviderSend = this.origProvider.sendAsync.bind(this.origProvider)
    } else {
      this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    }
    this.relayClient = relayClient ?? new RelayClient(origProvider, envelopingConfig, overrideDependencies)

    this._delegateEventsApi(origProvider)
  }

  registerEventListener (handler: (event: RelayEvent) => void): void {
    this.relayClient.registerEventListener(handler)
  }

  unregisterEventListener (handler: (event: RelayEvent) => void): void {
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
    if (this._useEnveloping(payload)) {
      if (payload.method === 'eth_sendTransaction') {
        if (payload.params[0].to === undefined) {
          throw new Error('Enveloping cannot relay contract deployment transactions. Add {from: accountWithRBTC, useEnveloping: false}.')
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
   * @param transactionDetails All the necessary information for creating the deploy request
   * from:address => EOA of the Smart Wallet owner
   * to:address => Optional custom logic address
   * data:bytes => init params for the optional custom logic
   * tokenContract:address => Token used to pay for the deployment, can be address(0) if the deploy is subsidized
   * tokenAmount:IntString => Amount of tokens paid for the deployment, can be 0 if the deploy is subsidized
   * tokenGas:IntString => Gas to be passed to the token transfer function. This was added because some ERC20 tokens (e.g, USDT) are unsafe, they use
   * assert() instead of require(). An elaborated (and quite difficult in terms of timing) attack by a user could plan to deplete their token balance between the time
   * the Relay Server makes the local relayCall to check the transaction passes and it actually submits it to the blockchain. In that scenario,
   * when the SmartWallet tries to pay with the user's USDT tokens and the balance is 0, instead of reverting and reimbursing the unused gas, it would revert and spend all the gas,
   * by adding tokeGas we prevent this attack, the gas reserved to actually execute the rest of the relay call is not lost but reimbursed to the relay worker/
   * factory:address => Address of the factory used to deploy the Smart Wallet
   * recoverer:address => Optional recoverer account/contract, can be address(0)
   * index:IntString => Numeric value used to generate several SW instances using the same paramaters defined above
   *
   * value: Not used here, only used in other scenarios where the worker account of the relay server needs to replenish balance.
   * Any value put here wont be sent to the "to" property, it won't be moved at all.
   *
   * @returns The transaction hash
   */
  async deploySmartWallet (transactionDetails: EnvelopingTransactionDetails): Promise<string> {
    let isSmartWalletDeployValue = transactionDetails.isSmartWalletDeploy
    let relayHubValue = transactionDetails.relayHub
    let onlyPreferredRelaysValue = transactionDetails.onlyPreferredRelays
    let txDetailsChanged = false

    if (isSmartWalletDeployValue === undefined || isSmartWalletDeployValue === null) {
      isSmartWalletDeployValue = true
      txDetailsChanged = true
    }

    if (!isSmartWalletDeployValue) {
      throw new Error('Request is not for SmartWallet deploy')
    }

    if (relayHubValue === undefined || relayHubValue === null || relayHubValue === constants.ZERO_ADDRESS) {
      relayHubValue = this.config.relayHubAddress
      txDetailsChanged = true
    }

    if (onlyPreferredRelaysValue === undefined || onlyPreferredRelaysValue === null) {
      onlyPreferredRelaysValue = this.config.onlyPreferredRelays
      txDetailsChanged = true
    }

    if (txDetailsChanged) {
      transactionDetails = {
        ...transactionDetails,
        isSmartWalletDeploy: isSmartWalletDeployValue,
        relayHub: relayHubValue,
        onlyPreferredRelays: onlyPreferredRelaysValue
      }
    }

    const tokenGas = transactionDetails.tokenGas ?? '0'
    const tokenContract = transactionDetails.tokenContract ?? constants.ZERO_ADDRESS

    if (tokenContract !== constants.ZERO_ADDRESS &&
      toBN(transactionDetails.tokenAmount ?? '0').gt(toBN('0')) &&
      toBN(tokenGas).isZero() &&
       (transactionDetails.smartWalletAddress ?? constants.ZERO_ADDRESS) === constants.ZERO_ADDRESS) {
      // There is a token payment involved
      // The user expects the client to estimate the gas required for the token call
      throw Error('In a deploy, if tokenGas is not defined, then the calculated SmartWallet address is needed to estimate the tokenGas value')
    }

    try {
      const relayingResult = await this.relayClient.relayTransaction(transactionDetails)
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
  calculateCustomSmartWalletAddress (factory: Address, ownerEOA: Address, recoverer: Address, customLogic: Address, walletIndex: number, bytecodeHash: string, logicInitParamsHash?: string): Address {
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

  calculateSmartWalletAddress (factory: Address, ownerEOA: Address, recoverer: Address, walletIndex: number, bytecodeHash: string): Address {
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

      callback(error, rpcResponse)
    })
  }

  _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    log.info('calling sendAsync' + JSON.stringify(payload))
    let transactionDetails: EnvelopingTransactionDetails = payload.params[0]

    let callForwarderValue = transactionDetails.callForwarder
    let relayHubValue = transactionDetails.relayHub
    let onlyPreferredRelaysValue = transactionDetails.onlyPreferredRelays
    let gasToSend = transactionDetails.forceGas

    if (callForwarderValue === undefined || callForwarderValue === null || callForwarderValue === constants.ZERO_ADDRESS) {
      callForwarderValue = this.config.forwarderAddress
    }

    if (relayHubValue === undefined || relayHubValue === null || relayHubValue === constants.ZERO_ADDRESS) {
      relayHubValue = this.config.relayHubAddress
    }

    if (onlyPreferredRelaysValue === undefined || onlyPreferredRelaysValue === null) {
      onlyPreferredRelaysValue = this.config.onlyPreferredRelays
    }

    if (gasToSend !== undefined && gasToSend !== null) {
      gasToSend = toHex(gasToSend)
    }

    /**
     * When using a RelayProvider, and the gas field is not manually set, then the original provider within calculates a ridiculously high gas.
     * In order to avoid this, we created a new field called forceGas, which is optional.
     * If the user wants to manually set the gas, then she can put a value in the forceGas field, otherwise it will be
     * automatically estimated (correctly) by the RelayClient.
     * The reason why we added this new forceGas field is because at this point, by reading the gas field,
     * we cannot differentiate between a user-entered gas value from the auto-calculated (and a very poor calculation)
     * value that comes from the original provider
     */
    transactionDetails = {
      ...transactionDetails,
      callForwarder: callForwarderValue,
      relayHub: relayHubValue,
      onlyPreferredRelays: onlyPreferredRelaysValue,
      gas: gasToSend // it is either undefined or a user-entered value
    }

    this.relayClient.relayTransaction(transactionDetails)
      .then((relayingResult) => {
        if (relayingResult.transaction !== undefined && relayingResult.transaction !== null) {
          const txHash = '0x' + relayingResult.transaction.hash(true).toString('hex')

          this.relayClient.getTransactionReceipt(txHash).then((receipt) => {
            const relayStatus = this._getRelayStatus(receipt)

            if (relayingResult.transaction === undefined || relayingResult.transaction === null) {
              // Imposible scenario, but we addded it so the linter does not complain since it wont allow using ! keyword
              callback(new Error(`Unknown Runtime error while processing result of txHash: ${txHash}`))
            } else {
              if (relayStatus.transactionRelayed) {
                const jsonRpcSendResult = this._convertTransactionToRpcSendResponse(relayingResult.transaction, payload)
                callback(null, jsonRpcSendResult)
              } else if (relayStatus.relayRevertedOnRecipient) {
                callback(new Error(`Transaction Relayed but reverted on recipient - TxHash: ${txHash} , Reason: ${relayStatus.reason}`))
              } else {
                const jsonRpcSendResult = this._convertTransactionToRpcSendResponse(relayingResult.transaction, payload)
                callback(null, jsonRpcSendResult)
              }
            }
          }, (error) => {
            const reasonStr = error instanceof Error ? error.message : JSON.stringify(error)
            log.info('Error while fetching transaction receipt', error)
            callback(new Error(`Rejected relayTransaction call - Reason: ${reasonStr}`))
          })
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

  _getRelayStatus (respResult: BaseTransactionReceipt): {relayRevertedOnRecipient: boolean, transactionRelayed: boolean, reason: string } {
    if (respResult.logs === null || respResult.logs.length === 0) {
      return { relayRevertedOnRecipient: false, transactionRelayed: false, reason: 'Tx logs not found' }
    }
    const logs = abiDecoder.decodeLogs(respResult.logs)
    const recipientRejectedEvents = logs.find((e: any) => e != null && e.name === 'TransactionRelayedButRevertedByRecipient')

    if (recipientRejectedEvents !== undefined && recipientRejectedEvents !== null) {
      const recipientRejectionReason: { value: string } = recipientRejectedEvents.events.find((e: any) => e.name === 'reason')
      let revertReason = 'Unknown'
      if (recipientRejectionReason !== undefined && recipientRejectionReason !== null) {
        log.info(`Recipient rejected on-chain: ${recipientRejectionReason.value}`)
        revertReason = recipientRejectionReason.value
      }
      return { relayRevertedOnRecipient: true, transactionRelayed: false, reason: revertReason }
    }

    const transactionRelayed = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')
    if (transactionRelayed !== undefined && transactionRelayed !== null) {
      return { relayRevertedOnRecipient: false, transactionRelayed: true, reason: '' }
    }

    // Check if it wasn't a deploy call which does not emit TransactionRelayed events but Deployed events
    const deployedEvent = logs.find((e: any) => e != null && e.name === 'Deployed')
    if (deployedEvent !== undefined && deployedEvent !== null) {
      return { relayRevertedOnRecipient: false, transactionRelayed: true, reason: '' }
    }

    log.info('Neither TransactionRelayed, Deployed, nor TransactionRelayedButRevertedByRecipient events found. This might be a non-enveloping transaction ')
    return { relayRevertedOnRecipient: false, transactionRelayed: false, reason: 'Neither TransactionRelayed, Deployed, nor TransactionRelayedButRevertedByRecipient events found. This might be a non-enveloping transaction' }
  }

  _useEnveloping (payload: JsonRpcPayload): boolean {
    if (payload.method === 'eth_accounts') {
      return true
    }
    if (payload.params[0] === undefined) {
      return false
    }
    const transactionDetails: EnvelopingTransactionDetails = payload.params[0]
    return transactionDetails?.useEnveloping ?? true
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
  // When using the original provider with the RSKJ node it is necessary to remove the additional useEnveloping property.
  _getPayloadForRSKProvider (payload: JsonRpcPayload): JsonRpcPayload {
    let p: JsonRpcPayload = payload

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    p = JSON.parse(JSON.stringify(payload))

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (payload.params[0]?.hasOwnProperty('useEnveloping')) {
      delete p.params[0].useEnveloping
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

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (payload.params[0]?.hasOwnProperty('onlyPreferredRelays')) {
      delete p.params[0].onlyPreferredRelays
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (payload.params[0]?.hasOwnProperty('tokenAmount')) {
      delete p.params[0].tokenAmount
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (payload.params[0]?.hasOwnProperty('tokenContract')) {
      delete p.params[0].tokenContract
    }

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (payload.params[0]?.hasOwnProperty('forceGas')) {
      delete p.params[0].forceGas
    }
    return p
  }
}

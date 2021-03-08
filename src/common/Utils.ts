import abi from 'web3-eth-abi'
import ethUtils from 'ethereumjs-util'
import web3Utils from 'web3-utils'
import sigUtil from 'eth-sig-util'
import { EventData } from 'web3-eth-contract'
import { JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString } from 'ethereumjs-tx'

import { Address, IntString } from '../relayclient/types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'

import TypedRequestData, { getDomainSeparatorHash } from './EIP712/TypedRequestData'
import { getDependencies, EnvelopingConfig, EnvelopingDependencies} from '../relayclient/Configurator'
import chalk from 'chalk'

import HttpClient from '../relayclient/HttpClient'
import { DeployRequest, RelayRequest } from './EIP712/RelayRequest'

import { DeployTransactionRequest, RelayMetadata, RelayTransactionRequest } from '../relayclient/types/RelayTransactionRequest'
import HttpWrapper from '../relayclient/HttpWrapper'
import { constants } from './Constants'
import { HttpProvider } from 'web3-core'

export function removeHexPrefix (hex: string): string {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'
const zeroAddr = '0x0000000000000000000000000000000000000000'

export function padTo64 (hex: string): string {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

export function event2topic (contract: any, names: string[]): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!contract.options || !contract.options.jsonInterface) { return names }
  if (typeof names === 'string') {
    return event2topic(contract, [names])[0]
  }
  return contract.options.jsonInterface
    .filter((e: any) => names.includes(e.name))
    // @ts-ignore
    .map(abi.encodeEventSignature)
}

export function addresses2topics (addresses: string[]): string[] {
  return addresses.map(address2topic)
}

export function address2topic (address: string): string {
  return '0x' + '0'.repeat(24) + address.toLowerCase().slice(2)
}

// extract revert reason from a revert bytes array.
export function decodeRevertReason (revertBytes: PrefixedHexString, throwOnError = false): string | null {
  if (revertBytes == null) { return null }
  if (!revertBytes.startsWith('0x08c379a0')) {
    if (throwOnError) {
      throw new Error('invalid revert bytes: ' + revertBytes)
    }
    return revertBytes
  }
  // @ts-ignore
  return abi.decodeParameter('string', '0x' + revertBytes.slice(10)) as any
}

export function getLocalEip712Signature (
  typedRequestData: TypedRequestData,
  privateKey: Buffer,
  jsonStringifyRequest = false
): PrefixedHexString {
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }

  // @ts-ignore
  return sigUtil.signTypedData_v4(privateKey, { data: dataToSign })
}

export async function getEip712Signature (
  web3: Web3,
  typedRequestData: TypedRequestData,
  methodSuffix = '',
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  const senderAddress = typedRequestData.message.from
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  return await new Promise((resolve, reject) => {
    let method
    // @ts-ignore (the entire web3 typing is fucked up)
    if (typeof web3.currentProvider.sendAsync === 'function') {
      // @ts-ignore
      method = web3.currentProvider.sendAsync
    } else {
      // @ts-ignore
      method = web3.currentProvider.send
    }
    method.bind(web3.currentProvider)({
      method: 'eth_signTypedData' + methodSuffix,
      params: [senderAddress, dataToSign],
      from: senderAddress,
      id: Date.now()
    }, (error: Error | string | null, result?: JsonRpcResponse) => {
      if (result?.error != null) {
        error = result.error
      }
      if (error != null || result == null) {
        reject((error as any).message ?? error)
      } else {
        resolve(result.result)
      }
    })
  })
}

/**
 * @returns maximum possible gas consumption by this relayed call
 */
export function calculateTransactionMaxPossibleGas (

  hubOverhead: number,
  relayCallGasLimit: string,
  cushion: number
): number {
  return hubOverhead +
    parseInt(relayCallGasLimit) + cushion
}

export function getEcRecoverMeta (message: PrefixedHexString, signature: string | Signature): PrefixedHexString {
  if (typeof signature === 'string') {
    const r = parseHexString(signature.substr(2, 65))
    const s = parseHexString(signature.substr(66, 65))
    const v = parseHexString(signature.substr(130, 2))

    signature = {
      v: v,
      r: r,
      s: s
    }
  }
  const msg = Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n32'), Buffer.from(removeHexPrefix(message), 'hex')])
  const signed = web3Utils.sha3('0x' + msg.toString('hex'))
  if (signed == null) {
    throw new Error('web3Utils.sha3 failed somehow')
  }
  const bufSigned = Buffer.from(removeHexPrefix(signed), 'hex')
  const recoveredPubKey = ethUtils.ecrecover(bufSigned, signature.v[0], Buffer.from(signature.r), Buffer.from(signature.s))
  return ethUtils.bufferToHex(ethUtils.pubToAddress(recoveredPubKey))
}

export function parseHexString (str: string): number[] {
  const result = []
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16))

    str = str.substring(2, str.length)
  }

  return result
}

export function isSameAddress (address1: Address, address2: Address): boolean {
  return address1.toLowerCase() === address2.toLowerCase()
}

export async function sleep (ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export function randomInRange (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min)
}

export function isSecondEventLater (a: EventData, b: EventData): boolean {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex > a.transactionIndex
  }
  return b.blockNumber > a.blockNumber
}

export function getLatestEventData (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(
    (a: EventData, b: EventData) => {
      if (a.blockNumber === b.blockNumber) {
        return b.transactionIndex - a.transactionIndex
      }
      return b.blockNumber - a.blockNumber
    })
  return eventDataSorted[0]
}

export function isRegistrationValid (registerEvent: EventData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  const portIncluded: boolean = config.url.indexOf(':') > 0
  return registerEvent != null &&
    isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
    registerEvent.returnValues.baseRelayFee.toString() === config.baseRelayFee.toString() &&
    registerEvent.returnValues.pctRelayFee.toString() === config.pctRelayFee.toString() &&
    registerEvent.returnValues.relayUrl.toString() === (config.url.toString() + ((!portIncluded && config.port > 0) ? ':' + config.port.toString() : ''))
}

/**
 * @param gasLimits
 * @param hubOverhead
 * @param relayCallGasLimit
 * @param calldataSize
 * @param gtxdatanonzero
 */
interface TransactionGasComponents {
  gasLimits: VerifierGasLimits
  hubOverhead: number
  relayCallGasLimit: string
}

export interface VerifierGasLimits {
  preRelayedCallGasLimit: string
  postRelayedCallGasLimit: string
}

interface Signature {
  v: number[]
  r: number[]
  s: number[]
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

export class EnvelopingUtils {
  
  config: EnvelopingConfig
  relayWorkerAddress : Address
  dependencies: EnvelopingDependencies
  private initialized: boolean
  

  constructor(_config: EnvelopingConfig, _web3 : Web3, _relayWorkerAddress : Address) {
    this.config = _config
    this.initialized = false
    this.dependencies = getDependencies(this.config, _web3.currentProvider as HttpProvider)
    this.relayWorkerAddress = _relayWorkerAddress
  }

  async _init() : Promise<void> {
    if(!this.initialized) {
      await this.dependencies.contractInteractor.init()
      this.initialized = true
    } else {
      throw new Error('_init was already called')
    }
  }

  async createDeployRequest(from: Address, gasLimit: IntString, tokenContract:  Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString, index? : IntString, recoverer? : IntString): Promise<DeployRequest> {
    const deployRequest : DeployRequest = {
      request: {
      relayHub: this.config.relayHubAddress,
      from: from,
      to: zeroAddr,
      value: '0',
      gas: gasLimit, //overhead (cte) + fee + (estimateDeploy * 1.1)
      nonce: (await this.getFactoryNonce(this.config.proxyFactoryAddress, from)).toString(),
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
      callForwarder: this.config.proxyFactoryAddress,
      callVerifier: this.config.deployVerifierAddress,
      domainSeparator: getDomainSeparatorHash(this.config.proxyFactoryAddress, this.config.chainId)
    }
  }

    return deployRequest
  }
  
  async createRelayRequest(from: Address, to: Address, data: PrefixedHexString, gasLimit: IntString, tokenContract:  Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString): Promise<RelayRequest> {
    const relayRequest : RelayRequest = {
      request: {
      relayHub: this.config.relayHubAddress,
      from: from,
      to: to,
      data: data,
      value: '0',
      gas: gasLimit,
      nonce: this.getSenderNonce(this.config.forwarderAddress).toString(),
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      tokenGas: tokenGas
    }, 
    relayData: {
      gasPrice: gasPrice ?? '0',
      relayWorker: this.relayWorkerAddress,
      callForwarder: this.config.forwarderAddress,
      callVerifier: this.config.relayVerifierAddress,
      domainSeparator: getDomainSeparatorHash(this.config.forwarderAddress, this.config.chainId)
    }
  }
  
    return relayRequest
  }

  signDeployRequest(privKey : Buffer, request : DeployRequest) : PrefixedHexString {
    const cloneRequest = { ...request }
    const dataToSign = new TypedDeployRequestData(
        this.config.chainId,
        this.config.forwarderAddress,
        cloneRequest
    )
    // @ts-ignore
    const signature = sigUtil.signTypedData_v4(privKey, { data: dataToSign })
    
    // @ts-ignore
    const rec = sigUtil.recoverTypedSignature_v4({
      data: dataToSign,
      sig: signature
    })

    if (!isSameAddress(request.request.from.toLowerCase(), rec)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Internal exception: signature is not correct: sender=${request.request.from}, recovered=${rec}`)
    }
    
    return signature
  }

  signRelayRequest(privKey : Buffer, request : RelayRequest) : PrefixedHexString {
    const cloneRequest = { ...request }
    const dataToSign = new TypedRequestData(
        this.config.chainId,
        this.config.forwarderAddress,
        cloneRequest
    )
    
    // @ts-ignore
    return sigUtil.signTypedData_v4(privKey, { data: dataToSign })
  }

  async generateDeployTransactionRequest(signature : PrefixedHexString, deployRequest: DeployRequest) : Promise<DeployTransactionRequest> {
    const request: DeployTransactionRequest = {
      relayRequest: deployRequest,
      metadata: await this.generateMetadata(signature)
    }

    return request
  }

  async generateRelayTransactionRequest(signature : PrefixedHexString, relayRequest: RelayRequest) : Promise<RelayTransactionRequest> {
    const request: RelayTransactionRequest = {
      relayRequest,
      metadata: await this.generateMetadata(signature)
    }

    return request
  }

  async generateMetadata(signature : PrefixedHexString) : Promise<RelayMetadata> {
    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature: signature,
      approvalData: '0x',
      relayMaxNonce: await this.dependencies.contractInteractor.getTransactionCount(this.relayWorkerAddress) + this.config.maxRelayNonceGap
    }

    return metadata
  }


  async getSenderNonce (sWallet: Address): Promise<IntString> {
    return await this.dependencies.contractInteractor.getSenderNonce(sWallet)
  }
​
  async getFactoryNonce (factoryAddr: Address, from: Address): Promise<IntString> {
    return await this.dependencies.contractInteractor.getFactoryNonce(factoryAddr, from)
  }

  async sendDeployTransaction(relayUrl : string, httpRelayRequest : DeployTransactionRequest) : Promise<void> {
    const httpClient = new HttpClient(new HttpWrapper(), {})
    try {
        console.log('AAAAAAA')
        const hexTransaction = await httpClient.relayTransaction(relayUrl, httpRelayRequest)
        console.log(`hexTrx is ${hexTransaction}`)
    } catch (error) {
        console.log(`GOT ERROR: ${error}`)
    }
  }
}

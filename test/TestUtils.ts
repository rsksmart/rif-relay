/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'

import { ether } from '@openzeppelin/test-helpers'

import { RelayHubInstance, StakeManagerInstance, ProxyFactoryInstance, IForwarderInstance, SmartWalletInstance, TestRecipientInstance } from '../types/truffle-contracts'
import HttpWrapper from '../src/relayclient/HttpWrapper'
import HttpClient from '../src/relayclient/HttpClient'
import { configureGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment, Environment, environments } from '../src/common/Environments'
import { PrefixedHexString } from 'ethereumjs-tx'
import { getLocalEip712Signature, sleep } from '../src/common/Utils'
import { RelayHubConfiguration } from '../src/relayclient/types/RelayHubConfiguration'
import TypedRequestData, { GsnRequestType, getDomainSeparatorHash, ENVELOPING_PARAMS, ForwardRequestType } from '../src/common/EIP712/TypedRequestData'
import { soliditySha3Raw } from 'web3-utils'

// @ts-ignore
import { TypedDataUtils, signTypedData_v4 } from 'eth-sig-util'
import { BN, bufferToHex, toBuffer, toChecksumAddress, privateToAddress } from 'ethereumjs-util'
import { constants } from '../src/common/Constants'

import { AccountKeypair } from '../src/relayclient/AccountManager'

// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import { Address } from '../src/relayclient/types/Aliases'
import RelayRequest from '../src/common/EIP712/RelayRequest'

require('source-map-support').install({ errorFormatterForce: true })

const RelayHub = artifacts.require('RelayHub')

const localhostOne = 'http://localhost:8090'

// start a background relay process.
// rhub - relay hub contract
// options:
//  stake, delay, pctRelayFee, url, relayOwner: parameters to pass to registerNewRelay, to stake and register it.
//
export async function startRelay (
  relayHubAddress: string,
  stakeManager: StakeManagerInstance,
  options: any): Promise<ChildProcessWithoutNullStreams> {
  const args = []

  const serverWorkDir = '/tmp/gsn/test/server'

  fs.rmdirSync(serverWorkDir, { recursive: true })
  args.push('--workdir', serverWorkDir)
  args.push('--devMode')
  args.push('--checkInterval', 10)
  args.push('--logLevel', 5)
  args.push('--relayHubAddress', relayHubAddress)
  const configFile = path.resolve(__dirname, './server-config.json')
  args.push('--config', configFile)
  if (options.ethereumNodeUrl) {
    args.push('--ethereumNodeUrl', options.ethereumNodeUrl)
  }
  if (options.gasPriceFactor) {
    args.push('--gasPriceFactor', options.gasPriceFactor)
  }
  if (options.pctRelayFee) {
    args.push('--pctRelayFee', options.pctRelayFee)
  }
  if (options.baseRelayFee) {
    args.push('--baseRelayFee', options.baseRelayFee)
  }
  const runServerPath = path.resolve(__dirname, '../src/relayserver/runServer.ts')
  const proc: ChildProcessWithoutNullStreams = childProcess.spawn('./node_modules/.bin/ts-node',
    [runServerPath, ...args])

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let relaylog = function (_: string): void {}
  if (options.relaylog) {
    relaylog = (msg: string) => msg.split('\n').forEach(line => console.log(`relay-${proc.pid.toString()}> ${line}`))
  }

  await new Promise((resolve, reject) => {
    let lastresponse: string
    const listener = (data: any): void => {
      const str = data.toString().replace(/\s+$/, '')
      lastresponse = str
      relaylog(str)
      if (str.indexOf('Listening on port') >= 0) {
        // @ts-ignore
        proc.alreadystarted = 1
        resolve(proc)
      }
    }
    proc.stdout.on('data', listener)
    proc.stderr.on('data', listener)
    const doaListener = (code: Object): void => {
      // @ts-ignore
      if (!proc.alreadystarted) {
        relaylog(`died before init code=${JSON.stringify(code)}`)
        reject(new Error(lastresponse))
      }
    }
    proc.on('exit', doaListener.bind(proc))
  })

  let res: any
  const http = new HttpClient(new HttpWrapper(), configureGSN({}))
  let count1 = 3
  while (count1-- > 0) {
    try {
      res = await http.getPingResponse(localhostOne)
      if (res) break
    } catch (e) {
      console.log('startRelay getaddr error', e)
    }
    console.log('sleep before cont.')
    await module.exports.sleep(1000)
  }
  assert.ok(res, 'can\'t ping server')
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  assert.ok(res.relayWorkerAddress, `server returned unknown response ${res.toString()}`)
  const relayManagerAddress = res.relayManagerAddress
  console.log('Relay Server Address', relayManagerAddress)
  // @ts-ignore
  await web3.eth.sendTransaction({
    to: relayManagerAddress,
    from: options.relayOwner,
    value: ether('0.02')
  })

  await stakeManager.stakeForAddress(relayManagerAddress, options.delay || 2000, {
    from: options.relayOwner,
    value: options.stake || ether('0.01')
  })
  await sleep(500)
  await stakeManager.authorizeHubByOwner(relayManagerAddress, relayHubAddress, {
    from: options.relayOwner
  })

  // now ping server until it "sees" the stake and funding, and gets "ready"
  res = ''
  let count = 25
  while (count-- > 0) {
    res = await http.getPingResponse(localhostOne)
    if (res?.ready) break
    await sleep(500)
  }
  assert.ok(res.ready, 'Timed out waiting for relay to get staked and registered')

  // TODO: this is temporary hack to make helper test work!!!
  // @ts-ignore
  proc.relayManagerAddress = relayManagerAddress
  return proc
}

export function stopRelay (proc: ChildProcessWithoutNullStreams): void {
  proc?.kill()
}

export async function increaseTime (time: number): Promise<void> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [time],
      id: Date.now()
    }, (err: Error | null) => {
      if (err) return reject(err)
      module.exports.evmMine()
        .then((r: any) => resolve(r))
        .catch((e: Error) => reject(e))
    })
  })
}

export async function evmMineMany (count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await evmMine()
  }
}

export async function evmMine (): Promise<any> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      params: [],
      id: Date.now()
    }, (e: Error | null, r: any) => {
      if (e) {
        reject(e)
      } else {
        resolve(r)
      }
    })
  })
}

export async function snapshot (): Promise<{ id: number, jsonrpc: string, result: string }> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: Date.now()
    }, (err: Error | null, snapshotId: { id: number, jsonrpc: string, result: string }) => {
      if (err) { return reject(err) }
      return resolve(snapshotId)
    })
  })
}

export async function revert (id: string): Promise<void> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_revert',
      params: [id],
      id: Date.now()
    }, (err: Error | null, result: any) => {
      if (err) { return reject(err) }
      return resolve(result)
    })
  })
}

// encode revert reason string as a byte error returned by revert(stirng)
export function encodeRevertReason (reason: string): PrefixedHexString {
  return web3.eth.abi.encodeFunctionCall({
    name: 'Error',
    type: 'function',
    inputs: [{ name: 'error', type: 'string' }]
  }, [reason])
  // return '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', reason))
}

export async function getTestingEnvironment (): Promise<Environment> {
  const networkId = await web3.eth.net.getId()
  return networkId === 33 ? environments.rsk : defaultEnvironment
}

export async function deployHub (
  stakeManager: string = constants.ZERO_ADDRESS,
  penalizer: string = constants.ZERO_ADDRESS,
  configOverride: Partial<RelayHubConfiguration> = {}): Promise<RelayHubInstance> {
  const relayHubConfiguration: RelayHubConfiguration = {
    ...defaultEnvironment.relayHubConfiguration,
    ...configOverride
  }
  return await RelayHub.new(
    stakeManager,
    penalizer,
    relayHubConfiguration.maxWorkerCount,
    relayHubConfiguration.gasReserve,
    relayHubConfiguration.postOverhead,
    relayHubConfiguration.gasOverhead,
    relayHubConfiguration.maximumRecipientDeposit,
    relayHubConfiguration.minimumUnstakeDelay,
    relayHubConfiguration.minimumStake)
}

export async function createProxyFactory (template: IForwarderInstance, versionHash: string = web3.utils.keccak256('2')): Promise<ProxyFactoryInstance> {
  const ProxyFactory = artifacts.require('ProxyFactory')
  return await ProxyFactory.new(template.address, versionHash)
}

export async function createSmartWallet (ownerEOA: string, factory: ProxyFactoryInstance, privKey: Buffer, chainId: number = -1, logicAddr: string = constants.ZERO_ADDRESS,
  initParams: string = '0x', tokenContract: string = constants.ZERO_ADDRESS, tokenRecipient: string = constants.ZERO_ADDRESS, tokenAmount: string = '0',
  gas: string = '400000'): Promise<SmartWalletInstance> {
  const typeName = `${GsnRequestType.typeName}(${ENVELOPING_PARAMS},${GsnRequestType.typeSuffix}`
  const typeHash = web3.utils.keccak256(typeName)
  chainId = (chainId < 0 ? (await getTestingEnvironment()).chainId : chainId)

  const rReq = {
    request: {
      from: ownerEOA,
      to: logicAddr,
      value: '0',
      gas: gas,
      nonce: '0',
      data: initParams,
      tokenRecipient: tokenRecipient,
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      factory: factory.address,
      recoverer: constants.ZERO_ADDRESS,
      index: '0'
    },
    relayData: {
      gasPrice: '10',
      pctRelayFee: '10',
      baseRelayFee: '10000',
      relayWorker: constants.ZERO_ADDRESS,
      paymaster: constants.ZERO_ADDRESS,
      forwarder: constants.ZERO_ADDRESS,
      paymasterData: '0x',
      clientId: '1'
    }
  }

  const createdataToSign = new TypedRequestData(
    chainId,
    factory.address,
    rReq
  )

  const deploySignature = getLocalEip712Signature(createdataToSign, privKey)
  const encoded = TypedDataUtils.encodeData(createdataToSign.primaryType, createdataToSign.message, createdataToSign.types)
  const countParams = ForwardRequestType.length
  const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32)) // keccak256 of suffixData
  await factory.relayedUserSmartWalletCreation(rReq.request, getDomainSeparatorHash(factory.address, chainId), typeHash, suffixData, deploySignature)

  const swAddress = await factory.getSmartWalletAddress(ownerEOA, constants.ZERO_ADDRESS, logicAddr, soliditySha3Raw({ t: 'bytes', v: initParams }), '0')

  const SmartWallet = artifacts.require('SmartWallet')
  const sw: SmartWalletInstance = await SmartWallet.at(swAddress)

  return sw
}

export async function getGaslessAccount (): Promise<AccountKeypair> {
  const a = ethWallet.generate()
  const gaslessAccount = {
    privateKey: a.privKey,
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    address: toChecksumAddress(bufferToHex(privateToAddress(a.privKey)), (await getTestingEnvironment()).chainId).toLowerCase()

  }

  return gaslessAccount
}

// An existing account in RSKJ that have been depleted
export async function getExistingGaslessAccount (): Promise<AccountKeypair> {
  const gaslessAccount = {
    privateKey: toBuffer('0x082f57b8084286a079aeb9f2d0e17e565ced44a2cb9ce4844e6d4b9d89f3f595'),
    address: toChecksumAddress('0x09a1eda29f664ac8f68106f6567276df0c65d859', (await getTestingEnvironment()).chainId).toLowerCase()
  }

  const balance = new BN(await web3.eth.getBalance(gaslessAccount.address))
  if (!balance.eqn(0)) {
    const receiverAddress = toChecksumAddress(bufferToHex(privateToAddress(toBuffer(bytes32(1)))), (await getTestingEnvironment()).chainId).toLowerCase()

    await web3.eth.sendTransaction({
      from: gaslessAccount.address,
      to: receiverAddress,
      value: balance.subn(21000),
      gasPrice: 1,
      gas: 21000
    })
  }

  assert(await web3.eth.getBalance(gaslessAccount.address) === '0', 'Gassless account should have no funds')

  return gaslessAccount
}

export function addr (n: number): string {
  return '0x' + n.toString().repeat(40).slice(0, 40)
}

export function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

export function stripHex (s: string): string {
  return s.slice(2, s.length)
}

export function bufferToHexString (b: Buffer): string {
  return '0x' + b.toString('hex')
}

export async function prepareTransaction (testRecipient: TestRecipientInstance, account: AccountKeypair, relayWorker: Address, paymaster: Address, web3: Web3, nonce: string, swallet: string): Promise<{ relayRequest: RelayRequest, signature: string}> {
  const paymasterData = '0x'
  const clientId = '1'
  const relayRequest: RelayRequest = {
    request: {
      to: testRecipient.address,
      data: testRecipient.contract.methods.emitMessage('hello world').encodeABI(),
      from: account.address,
      nonce: nonce,
      value: '0',
      gas: '10000',
      tokenRecipient: constants.ZERO_ADDRESS,
      tokenContract: constants.ZERO_ADDRESS,
      tokenAmount: '0',
      factory: constants.ZERO_ADDRESS, // only set if this is a deploy request
      recoverer: constants.ZERO_ADDRESS,
      index: '0'
    },
    relayData: {
      pctRelayFee: '1',
      baseRelayFee: '1',
      gasPrice: '1',
      paymaster,
      paymasterData,
      clientId,
      forwarder: swallet,
      relayWorker
    }
  }

  const dataToSign = new TypedRequestData(
    (await getTestingEnvironment()).chainId,
    swallet,
    relayRequest
  )

  const signature = signTypedData_v4(account.privateKey, { data: dataToSign })

  return {
    relayRequest,
    signature
  }
}

/**
 * Not all "signatures" are valid, so using a hard-coded one for predictable error message.
 */
export const INCORRECT_ECDSA_SIGNATURE = '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c'

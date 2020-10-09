/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'

import { constants, ether } from '@openzeppelin/test-helpers'

import { RelayHubInstance, StakeManagerInstance, ProxyFactoryInstance, ISmartWalletInstance, SmartWalletInstance, EnvelopingHubInstance } from '../types/truffle-contracts'
import HttpWrapper from '../src/relayclient/HttpWrapper'
import HttpClient from '../src/relayclient/HttpClient'
import { configureGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment, Environment, environments } from '../src/common/Environments'
import { PrefixedHexString } from 'ethereumjs-tx'
import { sleep, getEip712Signature } from '../src/common/Utils'
import { RelayHubConfiguration } from '../src/relayclient/types/RelayHubConfiguration'
import { GsnRequestType, getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import EnvelopingTypedRequestData, { ENVELOPING_PARAMS, GsnDomainSeparatorType, EIP712DomainType, EnvelopingRequestType } from '../src/common/EIP712/EnvelopingTypedRequestData'
// @ts-ignore
import { TypedDataUtils, signTypedData_v4 } from 'eth-sig-util'
import { bufferToHex, toBuffer } from 'ethereumjs-util'

const zeroAddr = '0x0000000000000000000000000000000000000000'

require('source-map-support').install({ errorFormatterForce: true })

const RelayHub = artifacts.require('RelayHub')
const EnvelopingHub = artifacts.require('EnvelopingHub')


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
    value: ether('2')
  })

  await stakeManager.stakeForAddress(relayManagerAddress, options.delay || 2000, {
    from: options.relayOwner,
    value: options.stake || ether('1')
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

export async function deployEnvelopingHub (
  stakeManager: string = constants.ZERO_ADDRESS,
  penalizer: string = constants.ZERO_ADDRESS,
  configOverride: Partial<RelayHubConfiguration> = {}): Promise<EnvelopingHubInstance> {
  const relayHubConfiguration: RelayHubConfiguration = {
    ...defaultEnvironment.relayHubConfiguration,
    ...configOverride
  }
    return await EnvelopingHub.new(
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

export async function createProxyFactory (template: ISmartWalletInstance): Promise<ProxyFactoryInstance> {
  const ProxyFactory = artifacts.require('ProxyFactory')
  const factory: ProxyFactoryInstance = await ProxyFactory.new(template.address)

  await factory.registerRequestType(
    GsnRequestType.typeName,
    GsnRequestType.typeSuffix
  )
  await factory.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version)
  return factory
}

export async function createSmartWallet (ownerEOA: string, factory: ProxyFactoryInstance, chainId: number = 33, privKey: string = '', logicAddr: string = zeroAddr,
  initParams: string = '0x', tokenContract: string = zeroAddr, tokenRecipient: string = zeroAddr, tokenAmount: string = '0',
  gas: string = '400000'): Promise<SmartWalletInstance> {
  const reqParamCount = 10

  let deploySignature
  let encoded

  if (privKey === '') {
    const typeName = `${GsnRequestType.typeName}(${ENVELOPING_PARAMS},${GsnRequestType.typeSuffix}`
    const typeHash = web3.utils.keccak256(typeName)
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
        factory: factory.address
      },
      relayData: {
        gasPrice: '10',
        pctRelayFee: '10',
        baseRelayFee: '10000',
        relayWorker: zeroAddr,
        paymaster: zeroAddr,
        forwarder: zeroAddr,
        paymasterData: '0x',
        clientId: '1'
      }
    }
    const createdataToSign = new EnvelopingTypedRequestData(
      chainId,
      factory.address,
      rReq
    )
    deploySignature = await getEip712Signature(
      web3,
      createdataToSign
    )

    console.log(`sognature ${deploySignature}`)
    encoded = TypedDataUtils.encodeData(createdataToSign.primaryType, createdataToSign.message, createdataToSign.types)
    const suffixData = bufferToHex(encoded.slice((1 + reqParamCount) * 32))
    await factory.relayedUserSmartWalletCreation(rReq.request, getDomainSeparatorHash(factory.address, chainId), typeHash, suffixData, deploySignature)
  } else {
    // We can use a simpler type, without the extra relayData in suffixData

    const typeName = `ForwardRequest(${ENVELOPING_PARAMS})`
    const typeHash = web3.utils.keccak256(typeName)
    const rReq = {
      from: ownerEOA,
      to: logicAddr,
      value: '0',
      gas: gas,
      nonce: '0',
      data: initParams,
      tokenRecipient: tokenRecipient,
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      factory: factory.address
    }
    const domainInfo = {
      name: GsnDomainSeparatorType.name,
      version: GsnDomainSeparatorType.version,
      chainId,
      verifyingContract: factory.address
    }
    const data = {
      domain: domainInfo,
      primaryType: 'ForwardRequest',
      types: {
        EIP712Domain: EIP712DomainType,
        ForwardRequest: EnvelopingRequestType
      },
      message: rReq
    }

    deploySignature = signTypedData_v4(toBuffer(privKey), { data })
    await factory.relayedUserSmartWalletCreation(rReq, getDomainSeparatorHash(factory.address, chainId), typeHash, '0x', deploySignature)
  }

  const swAddress = await factory.getSmartWalletAddress(ownerEOA, logicAddr, initParams)

  const SmartWallet = artifacts.require('SmartWallet')
  const sw: SmartWalletInstance = await SmartWallet.at(swAddress)
  await sw.registerRequestType(
    GsnRequestType.typeName,
    GsnRequestType.typeSuffix
  )
  await sw.registerRequestType(
    'ForwardRequest',
    ''
  )
  await sw.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version)

  return sw
}

/**
 * Not all "signatures" are valid, so using a hard-coded one for predictable error message.
 */
export const INCORRECT_ECDSA_SIGNATURE = '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c'

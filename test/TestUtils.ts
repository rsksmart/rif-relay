/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'

// @ts-ignore
import { TypedDataUtils, signTypedData_v4 } from 'eth-sig-util'
import { ethers } from 'hardhat'
import { DeployRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import TypedRequestData, { DeployRequestDataType, DEPLOY_PARAMS, getDomainSeparatorHash, RequestType, TypedDeployRequestData } from '../src/common/EIP712/TypedRequestData'
import { getLocalEip712Signature, sleep } from '../src/common/Utils'
import { CustomSmartWallet, CustomSmartWalletFactory, CustomSmartWalletFactory__factory, CustomSmartWallet__factory, IForwarder, RelayHub, RelayHub__factory, SmartWallet, SmartWalletFactory__factory, SmartWallet__factory, TestRecipient } from '../typechain'
import { SmartWalletFactory } from '../typechain/SmartWalletFactory'
import { constants } from '../src/common/Constants'
import { defaultEnvironment, Environment, environments } from '../src/common/Environments'
import { Address, PrefixedHexString } from '../src/relayclient/types/Aliases'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { RelayHubConfiguration } from '../src/relayclient/types/RelayHubConfiguration'
import { Contract, ContractReceipt, providers } from 'ethers'
import HttpClient from '../src/relayclient/HttpClient'
import HttpWrapper from '../src/relayclient/HttpWrapper'
import { configure } from '../src/relayclient/Configurator'
import { assert } from 'chai'

const localhostOne = 'http://localhost:8090'
export const deployTypeName = `${RequestType.typeName}(${DEPLOY_PARAMS},${RequestType.typeSuffix}`
export const deployTypeHash = ethers.utils.id(deployTypeName)

// start a background relay process.
// rhub - relay hub contract
// options:
//  stake, delay, url, relayOwner: parameters to pass to registerNewRelay, to stake and register it.
//

export interface RelayServerData {
  proc: ChildProcessWithoutNullStreams
  worker: Address
  manager: Address
}

export async function startRelay (
  relayHub: RelayHub,
  options: any): Promise<RelayServerData> {
  const args = []

  const serverWorkDir = '/tmp/enveloping/test/server'

  fs.rmdirSync(serverWorkDir, { recursive: true })
  args.push('--workdir', serverWorkDir)
  args.push('--devMode', true)
  args.push('--checkInterval', 10)
  args.push('--logLevel', 5)
  args.push('--relayHubAddress', relayHub.address)
  const configFile = path.resolve(__dirname, './server-config.json')
  args.push('--config', configFile)
  if (options.rskNodeUrl) {
    args.push('--rskNodeUrl', options.rskNodeUrl)
  }
  if (options.gasPriceFactor) {
    args.push('--gasPriceFactor', options.gasPriceFactor)
  }
  if (options.checkInterval) {
    args.push('--checkInterval', options.checkInterval)
  }

  if (options.deployVerifierAddress) {
    args.push('--deployVerifierAddress', options.deployVerifierAddress)
  }
  if (options.relayVerifierAddress) {
    args.push('--relayVerifierAddress', options.relayVerifierAddress)
  }

  if (options.trustedVerifiers) {
    args.push('--trustedVerifiers', options.trustedVerifiers)
  }

  if (options.workerMinBalance) {
    args.push('--workerMinBalance', options.workerMinBalance)
  }

  if (options.workerTargetBalance) {
    args.push('--workerTargetBalance', options.workerTargetBalance)
  }

  if (options.managerMinBalance) {
    args.push('--managerMinBalance', options.managerMinBalance)
  }

  if (options.managerMinStake) {
    args.push('--managerMinStake', options.managerMinStake)
  }

  if (options.managerTargetBalance) {
    args.push('--managerTargetBalance', options.managerTargetBalance)
  }

  if (options.minHubWithdrawalBalance) {
    args.push('--minHubWithdrawalBalance', options.minHubWithdrawalBalance)
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
  const http = new HttpClient(new HttpWrapper(), configure({}))
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
  console.log('Relay Manager Address', relayManagerAddress)
  const transaction: providers.TransactionRequest = {
    to: relayManagerAddress,
    from: options.relayOwner,
    value: ethers.utils.parseEther('2')
  }
  const signedTx = ethers.provider.getSigner().signTransaction(transaction)
  await ethers.provider.sendTransaction(signedTx)

  await relayHub.stakeForAddress(relayManagerAddress, options.delay || 2000, {
    from: options.relayOwner,
    value: options.stake || ethers.utils.parseEther('1')
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
  return { proc, worker: res.relayWorkerAddress, manager: relayManagerAddress }
}

export function stopRelay (proc: ChildProcessWithoutNullStreams): void {
  proc?.kill()
}

export async function getGaslessAccount (): Promise<AccountKeypair> {
  const a = ethers.Wallet.createRandom()
  const gaslessAccount: AccountKeypair = {
    privateKey: ethers.utils.arrayify(a.privateKey),
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    address: ethers.utils.getAddress(a.address).toLowerCase()

  }
  return gaslessAccount
}

export async function evmMineMany (count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await evmMine()
  }
}

export async function evmMine (): Promise<any> {
  return await ethers.provider.send('evm_mine', [])
  // return await new Promise((resolve, reject) => {
  //   ethers.provider.send('evm_mine',[]).then((r) => {
  //     resolve(r)
  //   }).catch((e) =>
  //   reject(e))
  // })
}

export async function snapshot (): Promise<{ id: number, jsonrpc: string, result: string }> {
  return await ethers.provider.send('evm_snapshot', [])
  // return await new Promise((resolve, reject) => {
  //   // @ts-ignore
  //   web3.currentProvider.send({
  //     jsonrpc: '2.0',
  //     method: 'evm_snapshot',
  //     id: Date.now()
  //   }, (err: Error | null, snapshotId: { id: number, jsonrpc: string, result: string }) => {
  //     if (err) { return reject(err) }
  //     return resolve(snapshotId)
  //   })
  // })
}

export async function revert (id: string): Promise<void> {
  return await ethers.provider.send('evm_revert', [id])
  // return await new Promise((resolve, reject) => {
  //   // @ts-ignore
  //   web3.currentProvider.send({
  //     jsonrpc: '2.0',
  //     method: 'evm_revert',
  //     params: [id],
  //     id: Date.now()
  //   }, (err: Error | null, result: any) => {
  //     if (err) { return reject(err) }
  //     return resolve(result)
  //   })
  // })
}

export async function deployHub (
  penalizer: string = constants.ZERO_ADDRESS,
  configOverride: Partial<RelayHubConfiguration> = {}): Promise<RelayHub> {
  const RelayHub = await ethers.getContractFactory('RelayHub') as RelayHub__factory
  const relayHubConfiguration: RelayHubConfiguration = {
    ...defaultEnvironment.relayHubConfiguration,
    ...configOverride
  }
  const rh = await RelayHub.deploy(
    penalizer,
    relayHubConfiguration.maxWorkerCount,
    relayHubConfiguration.minimumEntryDepositValue,
    relayHubConfiguration.minimumUnstakeDelay,
    relayHubConfiguration.minimumStake)
  await rh.deployed()
  return rh
}

export async function createSmartWalletFactory (template: IForwarder): Promise<SmartWalletFactory> {
  const SmartWalletFactory = await ethers.getContractFactory('SmartWalletFactory') as SmartWalletFactory__factory
  const swf = await SmartWalletFactory.deploy(template.address)
  return await swf.deployed()
}

export async function createSmartWallet (relayHub: string, ownerEOA: string, factory: SmartWalletFactory, privKey: Uint8Array, chainId: number = -1,
  tokenContract: string = constants.ZERO_ADDRESS, tokenAmount: string = '0',
  tokenGas: string = '0', recoverer: string = constants.ZERO_ADDRESS): Promise<SmartWallet> {
  chainId = (chainId < 0 ? (await getTestingEnvironment()).chainId : chainId)

  const rReq: DeployRequest = {
    request: {
      relayHub: relayHub,
      from: ownerEOA,
      to: constants.ZERO_ADDRESS,
      value: '0',
      nonce: '0',
      data: '0x',
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      tokenGas: tokenGas,
      recoverer: recoverer,
      index: '0'
    },
    relayData: {
      gasPrice: '10',
      domainSeparator: '0x',
      relayWorker: constants.ZERO_ADDRESS,
      callForwarder: constants.ZERO_ADDRESS,
      callVerifier: constants.ZERO_ADDRESS
    }
  }

  const createdataToSign = new TypedDeployRequestData(
    chainId,
    factory.address,
    rReq
  )

  const deploySignature = getLocalEip712Signature(createdataToSign, privKey)
  const encoded = TypedDataUtils.encodeData(createdataToSign.primaryType, createdataToSign.message, createdataToSign.types)
  const countParams = DeployRequestDataType.length
  const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32)) // keccak256 of suffixData
  const txResult = await factory.relayedUserSmartWalletCreation(rReq.request, getDomainSeparatorHash(factory.address, chainId), suffixData, deploySignature)
  console.log('Cost of deploying SmartWallet: ', (await txResult.wait()).cumulativeGasUsed.toNumber())
  const swAddress = await factory.getSmartWalletAddress(ownerEOA, recoverer, '0')

  const SmartWallet = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
  const sw: SmartWallet = SmartWallet.attach(swAddress)

  return sw
}

export async function createCustomSmartWalletFactory (template: IForwarder): Promise<CustomSmartWalletFactory> {
  const CustomSmartWalletFactory = await ethers.getContractFactory('CustomSmartWalletFactory') as CustomSmartWalletFactory__factory
  const swf = await CustomSmartWalletFactory.deploy(template.address)
  return await swf.deployed()
}

export async function createCustomSmartWallet (relayHub: string, ownerEOA: string, factory: CustomSmartWalletFactory, privKey: Uint8Array, chainId: number = -1, logicAddr: string = constants.ZERO_ADDRESS,
  initParams: string = '0x', tokenContract: string = constants.ZERO_ADDRESS, tokenAmount: string = '0',
  tokenGas: string = '0', recoverer: string = constants.ZERO_ADDRESS): Promise<CustomSmartWallet> {
  chainId = (chainId < 0 ? (await getTestingEnvironment()).chainId : chainId)

  const rReq: DeployRequest = {
    request: {
      relayHub: relayHub,
      from: ownerEOA,
      to: logicAddr,
      value: '0',
      nonce: '0',
      data: initParams,
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      tokenGas: tokenGas,
      recoverer: recoverer,
      index: '0'
    },
    relayData: {
      gasPrice: '10',
      domainSeparator: '0x',
      relayWorker: constants.ZERO_ADDRESS,
      callForwarder: constants.ZERO_ADDRESS,
      callVerifier: constants.ZERO_ADDRESS
    }
  }

  const createdataToSign = new TypedDeployRequestData(
    chainId,
    factory.address,
    rReq
  )

  const deploySignature = getLocalEip712Signature(createdataToSign, privKey)
  const encoded = TypedDataUtils.encodeData(createdataToSign.primaryType, createdataToSign.message, createdataToSign.types)
  const countParams = DeployRequestDataType.length
  const suffixData = ethers.utils.hexlify(encoded.slice((1 + countParams) * 32)) // keccak256 of suffixData
  const txResult = await factory.relayedUserSmartWalletCreation(rReq.request, getDomainSeparatorHash(factory.address, chainId), suffixData, deploySignature, { from: relayHub })
  console.log('Cost of deploying SmartWallet: ', (await txResult.wait()).cumulativeGasUsed)
  const _initParams = ethers.utils.solidityKeccak256(['bytes'], [initParams])
  const swAddress = await factory.getSmartWalletAddress(ownerEOA, recoverer, logicAddr, _initParams, '0')

  const CustomSmartWallet = await ethers.getContractFactory('CustomSmartWallet') as CustomSmartWallet__factory
  const sw: CustomSmartWallet = CustomSmartWallet.attach(swAddress)

  return sw
}

export async function getTestingEnvironment (): Promise<Environment> {
  const networkId = (await ethers.getDefaultProvider().detectNetwork()).chainId
  return networkId === 33 ? environments.rsk : defaultEnvironment
}

export function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
}

export function encodeRevertReason (reason: string): PrefixedHexString {
  const ABI = ['function Error(string error)']
  const iface = new ethers.utils.Interface(ABI)
  const encodeRevertReason = iface.encodeFunctionData('Error', [reason])
  return encodeRevertReason
}

export function stripHex (s: string): string {
  return s.slice(2, s.length)
}

export async function increaseTime (time: number): Promise<void> {
  const ret = await ethers.provider.send('evm_increaseTime', [time])
  await evmMine()
  return ret
}

/**
 * Returns given a receipt if an event was emitted
 */
export function emittedEvent (contract: Contract, receipt: ContractReceipt, eventName: string, params: any[]): boolean {
  const encodedEvent = contract.interface.encodeFilterTopics(contract.interface.events[eventName], params)
  const topicsWithEncodedEvent = receipt.logs.filter(log => log.topics.some(topic => encodedEvent.includes(topic)))
  return topicsWithEncodedEvent.length !== 0
}

export async function prepareTransaction (relayHub: Address, testRecipient: TestRecipient, account: AccountKeypair, relayWorker: Address, verifier: Address, nonce: string, swallet: string, tokenContract: Address, tokenAmount: string, tokenGas: string = '50000'): Promise<{ relayRequest: RelayRequest, signature: string}> {
  const chainId = (await getTestingEnvironment()).chainId
  const relayRequest: RelayRequest = {
    request: {
      relayHub: relayHub,
      to: testRecipient.address,
      data: (await testRecipient.populateTransaction.emitMessage('hello world')).data ?? '',
      from: account.address,
      nonce: nonce,
      value: '0',
      gas: '200000',
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      tokenGas: tokenGas
    },
    relayData: {
      gasPrice: '1',
      domainSeparator: getDomainSeparatorHash(swallet, chainId),
      relayWorker: relayWorker,
      callForwarder: swallet,
      callVerifier: verifier
    }
  }

  const dataToSign = new TypedRequestData(
    chainId,
    swallet,
    relayRequest
  )
  const signature = signTypedData_v4(account.privateKey, { data: dataToSign })
  return {
    relayRequest,
    signature
  }
}

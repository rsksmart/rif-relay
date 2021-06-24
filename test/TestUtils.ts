import { TypedDataUtils } from 'eth-sig-util'
import { ethers } from 'hardhat'
import { DeployRequest } from '../src/common/EIP712/RelayRequest'
import { DeployRequestDataType, getDomainSeparatorHash, TypedDeployRequestData } from '../src/common/EIP712/TypedRequestData'
import { getLocalEip712Signature } from '../src/common/Utils'
import { CustomSmartWallet, CustomSmartWalletFactory, CustomSmartWalletFactory__factory, CustomSmartWallet__factory, IForwarder, RelayHub, RelayHub__factory, SmartWallet, SmartWalletFactory__factory, SmartWallet__factory } from '../typechain'
import { SmartWalletFactory } from '../typechain/SmartWalletFactory'
import { constants } from '../src/common/Constants'
import { defaultEnvironment, Environment, environments } from '../src/common/Environments'
import { PrefixedHexString } from '../src/relayclient/types/Aliases'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { RelayHubConfiguration } from '../src/relayclient/types/RelayHubConfiguration'
import { Contract, ContractReceipt } from 'ethers'

export async function getGaslessAccount (): Promise<AccountKeypair> {
  const a = ethers.Wallet.createRandom()
  const gaslessAccount: AccountKeypair = {
    privateKey: ethers.utils.arrayify(a.privateKey),
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    address: ethers.utils.getAddress(a.address).toLowerCase()

  }
  return gaslessAccount
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

export async function evmMineMany (count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await evmMine()
  }
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

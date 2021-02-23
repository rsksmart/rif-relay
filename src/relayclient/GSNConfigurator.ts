import { HttpProvider } from 'web3-core'
import { LogLevelNumbers } from 'loglevel'

import { constants } from '../common/Constants'
import { defaultEnvironment } from '../common/Environments'

import AccountManager from './AccountManager'
import ContractInteractor, { Web3Provider } from '../common/ContractInteractor'
import HttpClient from './HttpClient'
import HttpWrapper from './HttpWrapper'
import { KnownRelaysManager, DefaultRelayScore, EmptyFilter } from './KnownRelaysManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import { Address, AsyncDataCallback, AsyncScoreCalculator, IntString, PingFilter, RelayFilter } from './types/Aliases'
import { EmptyDataCallback, GasPricePingFilter } from './RelayClient'

const GAS_PRICE_PERCENT = 0 //
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800
const DEFAULT_LOOKUP_WINDOW_BLOCKS = 60000

const defaultGsnConfig: GSNConfig = {
  preferredRelays: [],
  onlyPreferredRelays: false,
  relayLookupWindowParts: 1,
  relayLookupWindowBlocks: DEFAULT_LOOKUP_WINDOW_BLOCKS,
  gasPriceFactorPercent: GAS_PRICE_PERCENT,
  minGasPrice: 1e09,
  maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
  sliceSize: 3,
  relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
  methodSuffix: '',
  jsonStringifyRequest: false,
  chainId: defaultEnvironment.chainId,
  relayHubAddress: constants.ZERO_ADDRESS,
  deployVerifierAddress: constants.ZERO_ADDRESS,
  relayVerifierAddress: constants.ZERO_ADDRESS,
  forwarderAddress: constants.ZERO_ADDRESS,
  logLevel: 0,
  clientId: '1'
}

/**
 * All classes in GSN must be configured correctly with non-null values.
 * Yet it is tedious to provide default values to all configuration fields on new instance creation.
 * This helper allows users to provide only the overrides and the remainder of values will be set automatically.
 */
export function configureGSN (partialConfig: Partial<GSNConfig>): GSNConfig {
  return Object.assign({}, defaultGsnConfig, partialConfig) as GSNConfig
}

/**
 * Same as {@link configureGSN} but also resolves the GSN deployment from Verifier
 * @param provider - web3 provider needed to query blockchain
 * @param partialConfig
 */
export async function resolveConfigurationGSN (provider: Web3Provider, partialConfig: Partial<GSNConfig>): Promise<GSNConfig> {
  // @ts-ignore
  if (provider.send == null && provider.sendAsync == null) {
    throw new Error('First param is not a web3 provider')
  }

  if (partialConfig.relayHubAddress != null) {
    throw new Error('Resolve cannot override passed values')
  }

  const contractInteractor = new ContractInteractor(provider, defaultGsnConfig)

  const [
    chainId, forwarderAddress
  ] = await Promise.all([
    partialConfig.chainId ?? contractInteractor.getAsyncChainId(),
    partialConfig.forwarderAddress ?? ''
  ])

  const isMetamask: boolean = (provider as any).isMetaMask

  // provide defaults valid for metamask (unless explicitly specified values)
  const methodSuffix = partialConfig.methodSuffix ?? (isMetamask ? '_v4' : defaultGsnConfig.methodSuffix)
  const jsonStringifyRequest = partialConfig.jsonStringifyRequest ?? (isMetamask ? true : defaultGsnConfig.jsonStringifyRequest)

  const resolvedConfig = {
    forwarderAddress,
    chainId,
    methodSuffix,
    jsonStringifyRequest
  }
  return {
    ...defaultGsnConfig,
    ...partialConfig,
    ...resolvedConfig
  }
}

/**
 * @field methodSuffix - allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
 * @field jsonStringifyRequest - should be 'true' for Metamask, false for ganache
 */
export interface GSNConfig {
  preferredRelays: string[]
  onlyPreferredRelays: boolean
  relayLookupWindowBlocks: number
  relayLookupWindowParts: number
  methodSuffix: string
  jsonStringifyRequest: boolean
  relayTimeoutGrace: number
  sliceSize: number
  logLevel: LogLevelNumbers
  gasPriceFactorPercent: number
  minGasPrice: number
  maxRelayNonceGap: number
  relayHubAddress: Address
  deployVerifierAddress: Address
  relayVerifierAddress: Address
  forwarderAddress: Address
  chainId: number
  clientId: IntString
}

export interface GSNDependencies {
  httpClient: HttpClient
  contractInteractor: ContractInteractor
  knownRelaysManager: KnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprovalData: AsyncDataCallback
  asyncVerifierData: AsyncDataCallback
  scoreCalculator: AsyncScoreCalculator
  config: GSNConfig
}

export function getDependencies (config: GSNConfig, provider?: HttpProvider, overrideDependencies?: Partial<GSNDependencies>): GSNDependencies {
  let contractInteractor = overrideDependencies?.contractInteractor
  if (contractInteractor == null) {
    if (provider != null) {
      contractInteractor = new ContractInteractor(provider, config)
    } else {
      throw new Error('either contract interactor or web3 provider must be non-null')
    }
  }

  let accountManager = overrideDependencies?.accountManager
  if (accountManager == null) {
    if (provider != null) {
      accountManager = new AccountManager(provider, config.chainId ?? contractInteractor.getChainId(), config)
    } else {
      throw new Error('either account manager or web3 provider must be non-null')
    }
  }

  const httpClient = overrideDependencies?.httpClient ?? new HttpClient(new HttpWrapper(), config)
  const pingFilter = overrideDependencies?.pingFilter ?? GasPricePingFilter
  const relayFilter = overrideDependencies?.relayFilter ?? EmptyFilter
  const asyncApprovalData = overrideDependencies?.asyncApprovalData ?? EmptyDataCallback
  const asyncVerifierData = overrideDependencies?.asyncVerifierData ?? EmptyDataCallback
  const scoreCalculator = overrideDependencies?.scoreCalculator ?? DefaultRelayScore
  const knownRelaysManager = overrideDependencies?.knownRelaysManager ?? new KnownRelaysManager(contractInteractor, config, relayFilter)
  const transactionValidator = overrideDependencies?.transactionValidator ?? new RelayedTransactionValidator(contractInteractor, config)

  const ret = {
    httpClient,
    contractInteractor,
    knownRelaysManager,
    accountManager,
    transactionValidator,
    pingFilter,
    relayFilter,
    asyncApprovalData,
    asyncVerifierData,
    scoreCalculator,
    config
  }

  // sanity check: overrides must not contain unknown fields.
  for (const key in overrideDependencies) {
    if ((ret as any)[key] == null) {
      throw new Error(`Unexpected override key ${key}`)
    }
  }

  return ret
}

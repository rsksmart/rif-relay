import sigUtil from 'eth-sig-util'
import { providers, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { DeployRequest, RelayRequest } from '../common/EIP712/RelayRequest'
import TypedRequestData, { TypedDeployRequestData } from '../common/EIP712/TypedRequestData'
import { getEip712Signature, isSameAddress } from '../common/Utils'
import { EnvelopingConfig } from './Configurator'
import { Address, PrefixedHexString } from './types/Aliases'
export interface AccountKeypair {
  privateKey: Uint8Array
  address: Address
}
export default class AccountManager {
  private readonly provider: providers.JsonRpcProvider
  private readonly accounts: AccountKeypair[] = []
  private readonly config: EnvelopingConfig
  readonly chainId: number
  private readonly signWithProviderImpl: (signedData: any) => Promise<string>

  constructor (provider: providers.JsonRpcProvider, chainId: number, config: EnvelopingConfig, signWithProviderImpl?: (signedData: any) => Promise<string>) {
    this.provider = provider
    this.chainId = chainId
    this.config = config
    this.signWithProviderImpl = signWithProviderImpl ?? this._signWithProviderDefault
  }

  addAccount (keypair: AccountKeypair): void {
    const wallet = new Wallet(keypair.privateKey)
    if (!isSameAddress(wallet.address, keypair.address)) {
      throw new Error('invalid keypair')
    }
    this.accounts.push(keypair)
  }

  newAccount (): AccountKeypair {
    const a = Wallet.createRandom()
    const keypair = {
      privateKey: ethers.utils.arrayify(a.privateKey),
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      address: a.address
    }
    this.addAccount(keypair)
    return keypair
  }

  isDeployRequest (req: any): boolean {
    let isDeploy = false
    if (req.request.recoverer !== undefined) {
      isDeploy = true
    }

    return isDeploy
  }

  async sign (relayRequest: RelayRequest | DeployRequest): Promise<PrefixedHexString> {
    const cloneRequest = { ...relayRequest }

    const isDeploy = this.isDeployRequest(relayRequest)

    const signedData = isDeploy ? new TypedDeployRequestData(
      this.chainId,
      relayRequest.relayData.callForwarder,
      cloneRequest as DeployRequest
    ) : new TypedRequestData(
      this.chainId,
      relayRequest.relayData.callForwarder,
      cloneRequest as RelayRequest
    )

    const keypair = this.accounts.find(account => isSameAddress(account.address, relayRequest.request.from))
    let rec: Address
    let signature: string

    try {
      if (keypair != null) {
        signature = this._signWithControlledKey(keypair, signedData)
      } else {
        signature = await this._signWithProvider(signedData)
      }
      // Sanity check only
      // @ts-ignore
      rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to sign relayed transaction for ${relayRequest.request.from}: ${error}`)
    }
    if (!isSameAddress(relayRequest.request.from.toLowerCase(), rec)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Internal RelayClient exception: signature is not correct: sender=${relayRequest.request.from}, recovered=${rec}`)
    }
    return signature
  }

  // These methods is extracted to
  // a) allow different implementations in the future, and
  // b) allow spying on Account Manager in tests
  async _signWithProvider (signedData: any): Promise<string> {
    return await this.signWithProviderImpl(signedData)
  }

  async _signWithProviderDefault (signedData: any): Promise<string> {
    return await getEip712Signature(
      this.provider,
      signedData,
      this.config.methodSuffix ?? '',
      this.config.jsonStringifyRequest ?? false
    )
  }

  _signWithControlledKey (keypair: AccountKeypair, signedData: TypedRequestData | TypedDeployRequestData): string {
    // @ts-ignore
    return sigUtil.signTypedData_v4(keypair.privateKey, { data: signedData })
  }

  getAccounts (): string[] {
    return this.accounts.map(it => it.address)
  }
}
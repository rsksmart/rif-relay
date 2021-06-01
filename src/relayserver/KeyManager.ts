
import Wallet, { hdkey as EthereumHDKey } from 'ethereumjs-wallet'
import { providers } from 'ethers'
import fs from 'fs'
import { ethers } from 'hardhat'
import ow from 'ow'
import { PrefixedHexString } from '../relayclient/types/Aliases'

export const KEYSTORE_FILENAME = 'keystore'

export class KeyManager {
  private readonly hdkey: any
  private _privateKeys: Record<PrefixedHexString, Buffer> = {}
  private nonces: Record<string, number> = {}

  /**
   * @param count - # of addresses managed by this manager
   * @param workdir - read seed from keystore file (or generate one and write it)
   * @param seed - if working in memory (no workdir), you can specify a seed - or use randomly generated one.
   */
  constructor (count: number, workdir?: string, seed?: Buffer) {
    ow(count, ow.number)
    if (seed != null && workdir != null) {
      throw new Error('Can\'t specify both seed and workdir')
    }

    if (workdir != null) {
      // @ts-ignore
      try {
        if (!fs.existsSync(workdir)) {
          fs.mkdirSync(workdir, { recursive: true })
        }
        let genseed
        const keyStorePath = workdir + '/' + KEYSTORE_FILENAME
        if (fs.existsSync(keyStorePath)) {
          genseed = Buffer.from(JSON.parse(fs.readFileSync(keyStorePath).toString()).seed, 'hex')
        } else {
          genseed = Wallet.generate().getPrivateKey()
          fs.writeFileSync(keyStorePath, JSON.stringify({ seed: genseed.toString('hex') }), { flag: 'w' })
        }
        this.hdkey = EthereumHDKey.fromMasterSeed(genseed)
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!e.message.includes('file already exists')) {
          throw e
        }
      }
    } else {
      // no workdir: working in-memory
      if (seed == null) {
        seed = Wallet.generate().getPrivateKey()
      }
      this.hdkey = EthereumHDKey.fromMasterSeed(seed ?? Buffer.from(''))
    }

    this.generateKeys(count)
  }

  generateKeys (count: number): void {
    this._privateKeys = {}
    this.nonces = {}
    for (let index = 0; index < count; index++) {
      const w = this.hdkey.deriveChild(index).getWallet()
      const address = ethers.utils.hexlify(w.getAddress())
      this._privateKeys[address] = w.getPrivateKey()
      this.nonces[index] = 0
    }
  }

  getAddress (index: number): PrefixedHexString {
    return this.getAddresses()[index]
  }

  getAddresses (): PrefixedHexString[] {
    return Object.keys(this._privateKeys)
  }

  isSigner (signer: string): boolean {
    return this._privateKeys[signer] != null
  }

  async signTransaction (signer: string, tx: providers.TransactionRequest): Promise<PrefixedHexString> {
    ow(signer, ow.string)
    const privateKey = this._privateKeys[signer]
    if (privateKey === undefined) {
      throw new Error(`Can't sign: signer=${signer} is not managed`)
    }

    const _signer = new ethers.Wallet(privateKey)
    const signedTx = _signer.signTransaction(tx)
    return signedTx
    // const rawTx = '0x' + tx.serialize().toString('hex')
    // return rawTx
  }
}

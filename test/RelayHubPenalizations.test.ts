/* eslint-disable @typescript-eslint/require-await */
// This rule seems to be flickering and buggy - does not understand async arrow functions correctly
import { expect } from 'chai'
import { cloneRelayRequest, RelayRequest } from '../src/common/EIP712/RelayRequest'
import { getDomainSeparatorHash } from '../src/common/EIP712/TypedRequestData'
import { isRsk, Environment } from '../src/common/Environments'
import { deployHub, getTestingEnvironment, createSmartWalletFactory, createSmartWallet, getGaslessAccount } from './TestUtils'
import { constants } from '../src/common/Constants'
import { AccountKeypair } from '../src/relayclient/AccountManager'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Penalizer, Penalizer__factory, RelayHub, SmartWallet, SmartWalletFactory, SmartWallet__factory, TestVerifierEverythingAccepted__factory } from '../typechain'
import { providers, Transaction } from 'ethers'

describe('RelayHub Penalizations', () =>  {
  let Penalizer: Penalizer__factory
  let relayHub: RelayHub
  let penalizer: Penalizer
  let env: Environment
  let defaultAccount: string
  let relayOwner: string
  let relayWorker: string
  let otherRelayWorker: string
  let sender: string
  let other: string
  let relayManager: string
  let otherRelayManager: string
  let thirdRelayWorker: string
  let reporterRelayManager: string
  let defaultAccountSigner: SignerWithAddress
  let relayOwnerSigner: SignerWithAddress
  let relayWorkerSigner: SignerWithAddress
  let otherRelayWorkerSigner: SignerWithAddress
  let senderSigner: SignerWithAddress
  let otherSigner: SignerWithAddress
  let relayManagerSigner: SignerWithAddress
  let otherRelayManagerSigner: SignerWithAddress
  let thirdRelayWorkerSigner: SignerWithAddress
  let reporterRelayManagerSigner: SignerWithAddress
  let relayRequest: RelayRequest

  // RSK requires a different relay's private key, original was '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c'
  const relayCallArgs = {
    gasPrice: 50,
    gasLimit: 1000000,
    nonce: 0,
    privateKey: '0x88fcad7d65de4bf854b88191df9bf38648545e7e5ea367dff6e025b06a28244d' // RSK relay's private key
  }

  describe('penalizations', function () {
    const stake = ethers.utils.parseEther('1')

    before(async function () {
      [defaultAccountSigner, relayOwnerSigner, relayWorkerSigner, otherRelayWorkerSigner, senderSigner, otherSigner, relayManagerSigner, otherRelayManagerSigner, thirdRelayWorkerSigner, reporterRelayManagerSigner] = await ethers.getSigners()
      Penalizer = await ethers.getContractFactory('Penalizer') as Penalizer__factory
      defaultAccount = await defaultAccountSigner.getAddress()
      relayOwner = await relayOwnerSigner.getAddress()
      relayWorker = await relayWorkerSigner.getAddress()
      otherRelayWorker = await otherRelayWorkerSigner.getAddress()
      sender = await senderSigner.getAddress()
      other = await otherSigner.getAddress()
      relayManager = await relayManagerSigner.getAddress()
      otherRelayManager = await otherRelayManagerSigner.getAddress()
      thirdRelayWorker = await thirdRelayWorkerSigner.getAddress()
      reporterRelayManager = await reporterRelayManagerSigner.getAddress()
      for (const addr of [relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker]) {
        console.log(addr)
      }

      relayRequest = {
        request: {
          relayHub: constants.ZERO_ADDRESS,
          to: '0x1820b744B33945482C17Dc37218C01D858EBc714',
          data: '0x1234',
          from: constants.ZERO_ADDRESS,
          nonce: '0',
          value: '0',
          gas: '1000000',
          tokenContract: constants.ZERO_ADDRESS,
          tokenAmount: '0',
          tokenGas: '0'
        },
        relayData: {
          gasPrice: '50',
          relayWorker,
          domainSeparator: '',
          callForwarder: constants.ZERO_ADDRESS,
          callVerifier: constants.ZERO_ADDRESS
        }
      }

      penalizer = await Penalizer.deploy()
      await penalizer.deployed()
      relayHub = await deployHub(penalizer.address)
      env = await getTestingEnvironment()
    //   const networkId = await web3.eth.net.getId()
    //   const chain = await web3.eth.net.getNetworkType()
    //   transactionOptions = getRawTxOptions(env.chainId, networkId, chain)

      await relayHub.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
        value: ethers.utils.parseEther('1'),
        gasPrice: '1'
      })

      await relayHub.connect(relayManagerSigner).addRelayWorkers([relayWorker], { gasPrice: '1' })
    //   // @ts-ignore
    //   Object.keys(RelayHub.events).forEach(function (topic) {
    //     // @ts-ignore
    //     RelayHub.network.events[topic] = RelayHub.events[topic]
    //   })
    //   // @ts-ignore
    //   Object.keys(RelayHub.events).forEach(function (topic) {
    //     // @ts-ignore
    //     Penalizer.network.events[topic] = RelayHub.events[topic]
    //   })

      await relayHub.connect(relayOwnerSigner).stakeForAddress(reporterRelayManager, 1000, {
        value: ethers.utils.parseEther('1')
      })
    })

    describe('penalization access control (relay manager only)', function () {
      before(async function () {
        const env: Environment = await getTestingEnvironment()
        const tx = await thirdRelayWorkerSigner.sendTransaction({ to: other, value: ethers.utils.parseEther('0.5'), gasPrice: 1 })
        const receipt = await tx.wait()
        const transactionHash = receipt.transactionHash;

        ({
          data: penalizableTxData,
          signature: penalizableTxSignature
        } = await getDataAndSignatureFromHash(transactionHash, env))
      })

      let penalizableTxData: string
      let penalizableTxSignature: string

      it('penalizeRepeatedNonce', async function () {
        await expect(
          penalizer.connect(otherSigner).penalizeRepeatedNonce(penalizableTxData, penalizableTxSignature, penalizableTxData, penalizableTxSignature, relayHub.address)).to.revertedWith(
          'Unknown relay manager'
        )
      })
    })

    describe('penalizable behaviors', function () {
      describe('repeated relay nonce', function () {
        beforeEach('staking for relay', async function () {
          await relayHub.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
            value: stake,
            gasPrice: '1'
          })
        })

        it('penalizes transactions with same nonce and different data', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)

          relayRequest.request.data = '0xabcd'

          const txDataSigB = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)

          const rskDifference: number = isRsk(env) ? 210000 : 0
          await expectPenalization(async (opts) =>
            await penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('penalizes transactions with same nonce and different gas limit', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { gasLimit: 100 }), chainId, env)

          const rskDifference: number = isRsk(env) ? 185000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('penalizes transactions with same nonce and different value', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { value: 100 }), chainId, env)

          const rskDifference: number = isRsk(env) ? 185000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )
        })

        it('does not penalize transactions with same nonce and data, value, gasLimit, destination', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { gasPrice: 70 }), chainId, env) // only gasPrice may be different

          await expect(
            penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)).to.revertedWith(
            'tx is equal'
          )
        })

        it('does not penalize transactions with different nonces', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { nonce: 1 }), chainId, env)

          await expect(
            penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)).to.revertedWith(
            'Different nonce'
          )
        })

        
        it('does not penalize transactions with same nonce from different relays', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const privateKey: string = '0x0123456789012345678901234567890123456789012345678901234567890123'
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { privateKey: privateKey }) , chainId, env)

          await expect(
            penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)).to.revertedWith('Different signer')
        })

        it('does not penalize with the same pair of transactions twice', async function () {
          const env: Environment = await getTestingEnvironment()
          const chainId: number = env.chainId
          const relayRequest: RelayRequest = await createRelayRequest()

          const txDataSigA = await getDataAndSignature(relayRequest, relayCallArgs, chainId, env)
          const txDataSigB = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { value: 100 }), chainId, env)

          const rskDifference: number = isRsk(env) ? 185000 : 0

          await expectPenalization(async (opts) =>
            await penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts), rskDifference
          )

          // stake relayer again to attempt to penalize again with the same set of transactions. It must fail.
          await relayHub.connect(relayOwnerSigner).stakeForAddress(relayManager, 1000, {
            value: ethers.utils.parseEther('1'),
            gasPrice: '1'
          })

          await expect(
            penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)).to.revertedWith(
            'Transactions already penalized'
          )

          // attempt to penalize with one of the previous transactions a new one. It must succeed
          const txDataSigC = await getDataAndSignature(relayRequest, Object.assign({}, relayCallArgs, { value: 200 }), chainId, env)

          await expectPenalization(async (opts) =>
            await penalizer.connect(reporterRelayManagerSigner).penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigC.data, txDataSigC.signature, relayHub.address, opts), rskDifference
          )
        })
      })
    })

    async function encodeRelayCallEIP155 (relayRequest: RelayRequest, relayCallArgs: any): Promise<Transaction> {
      const privateKey = relayCallArgs.privateKey
      const relayWorker = ethers.utils.computeAddress(privateKey)
      relayRequest.relayData.relayWorker = relayWorker

      const encodedCall = (await (relayHub.populateTransaction.relayCall(relayRequest, '0xabcdef123456'))).data ??''

      const transaction: providers.TransactionRequest = {
        nonce: relayCallArgs.nonce,
        gasLimit: relayCallArgs.gasLimit,
        gasPrice: relayCallArgs.gasPrice,
        to: relayHub.address,
        value: relayCallArgs.value,
        data: encodedCall
      }
      const signer = new ethers.Wallet(privateKey)
      const signedTx = await signer.signTransaction(transaction)
      return ethers.utils.parseTransaction(signedTx)
    }

    async function getDataAndSignatureFromHash (txHash: string, env: Environment): Promise<{ data: string, signature: string }> {
      const rpcTx = await ethers.provider.getTransaction(txHash)
      // eslint: this is stupid how many checks for 0 there are
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!env.chainId && parseInt(rpcTx.v, 16) > 28) {
        throw new Error('Missing ChainID for EIP-155 signature')
      }
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (env.chainId && !isRsk(env) && parseInt(rpcTx.v, 16) <= 28) {
        throw new Error('Passed ChainID for non-EIP-155 signature')
      }
    //   const tx: Transaction = {
    //     nonce: rpcTx.nonce,
    //     chainId: env.chainId,
    //     gasPrice: BigNumber.from(rpcTx.gasPrice),
    //     gasLimit: BigNumber.from(rpcTx.gasLimit),
    //     to: rpcTx.to,
    //     value: BigNumber.from(rpcTx.value),
    //     data: rpcTx.data,
    //     // @ts-ignore
    //     v: rpcTx.v,
    //     // @ts-ignore
    //     r: rpcTx.r,
    //     // @ts-ignore
    //     s: rpcTx.s
    // }

      return await getDataAndSignatureFromTx(rpcTx, env.chainId)
    }

    async function getDataAndSignature (relayRequest: RelayRequest, relayCallArgs: any, chainId: number, env: Environment): Promise<{ data: string; signature: string} > {
      const tx = await encodeRelayCallEIP155(relayRequest, relayCallArgs)
      return await getDataAndSignatureFromTx(tx, chainId)
    }

    async function getDataAndSignatureFromTx (tx: Transaction, chainId: number): Promise<{ data: string; signature: string} > {
        // const input = [tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]
        let txData = {
            gasPrice: tx.gasPrice,
            gasLimit: tx.gasLimit,
            value: tx.value,
            nonce: tx.nonce,
            data: tx.data,
            chainId: tx.chainId,
            to: tx.to
           }
           if (chainId) {
            txData = {...txData, chainId: tx.chainId}
        }

        const expandedSig = {
          r: tx.r?? "",
          s: tx.s?? "",
          v: tx.v?? 0
        }

        const signature = ethers.utils.joinSignature(expandedSig)
        const rsTx = await ethers.utils.resolveProperties(txData)
        const data = ethers.utils.serializeTransaction(rsTx) // returns RLP encoded tx
        return {
            data,
            signature
        }
    }

    async function createRelayRequest (): Promise<RelayRequest> {
      const smartWallet = await getSmartWalletAddress()
      const TestVerifierEverythingAccepted = await ethers.getContractFactory('TestVerifierEverythingAccepted') as TestVerifierEverythingAccepted__factory
      const verifier = await TestVerifierEverythingAccepted.deploy()
      await verifier.deployed()

      const r: RelayRequest = cloneRelayRequest(relayRequest)
      r.request.from = smartWallet.address
      r.request.relayHub = relayHub.address
      r.relayData.callForwarder = smartWallet.address
      r.relayData.callVerifier = verifier.address
      r.relayData.domainSeparator = getDomainSeparatorHash(smartWallet.address, env.chainId)

      return r
    }

    async function getSmartWalletAddress (): Promise<SmartWallet> {
      const gaslessAccount: AccountKeypair = await getGaslessAccount()
      const SmartWallet: SmartWallet__factory = await ethers.getContractFactory('SmartWallet') as SmartWallet__factory
      const smartWalletTemplate: SmartWallet = await SmartWallet.deploy()
      await smartWalletTemplate.deployed()
      const factory: SmartWalletFactory = await createSmartWalletFactory(smartWalletTemplate)
      const smartWallet: SmartWallet = await createSmartWallet(defaultAccount, gaslessAccount.address, factory, gaslessAccount.privateKey, env.chainId)

      return smartWallet
    }

    // Receives a function that will penalize the relay and tests that call for a penalization, including checking the
    // emitted event and penalization reward transfer. Returns the transaction receipt.
    async function expectPenalization (penalizeWithOpts: (opts: providers.TransactionRequest) => Promise<providers.TransactionResponse>, rskDifference: number = 0): Promise<void> {
      const initialReporterBalanceTracker = await ethers.provider.getBalance(reporterRelayManager)
      const initialStakeBalanceTracker = await ethers.provider.getBalance(relayHub.address)
      const stakeInfo = await relayHub.stakes(relayManager)
      
      const stake = stakeInfo.stake 
      const expectedReward = stake.div(2)
      
      // A gas price of zero makes checking the balance difference simpler
      // RSK: Setting gasPrice to 1 since the RSKJ node doesn't support transactions with a gas price lower than 0.06 gwei
      await expect(penalizeWithOpts({
        gasPrice: 1
      })).to.emit(relayHub, 'StakePenalized').withArgs(
          relayManager,
          reporterRelayManager,
          expectedReward
      )

      // expectEvent.inLogs(receipt.logs, 'StakePenalized', {
      //   relayManager: relayManager,
      //   beneficiary: reporterRelayManager,
      //   reward: expectedReward
      // })
      const delta = (await ethers.provider.getBalance(reporterRelayManager)).sub(initialReporterBalanceTracker) // (await reporterBalanceTracker.delta())
      const halfStake = stake.div(2)
      const difference = halfStake.sub(delta)
      // The reporter gets half of the stake
      // expect(delta).to.be.aproximately(halfStake)

      // Since RSKJ doesn't support a transaction gas price below 0.06 gwei we need to change the assert
      expect(difference).to.be.at.most(rskDifference)

      // The other half is burned, so RelayHub's balance is decreased by the full stake
      const finalDelta = initialStakeBalanceTracker.sub(await ethers.provider.getBalance(relayHub.address))
      expect(finalDelta).to.be.equal(stake)
    }
  })
})

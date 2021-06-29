// import { RelayClient } from '../../src/relayclient/RelayClient'
// import { ProfilingProvider } from '../../src/common/dev/ProfilingProvider'
// import ContractInteractor from '../../src/common/ContractInteractor'
// import { constants } from '../../src/common/Constants'

// import { isRsk, Environment } from '../../src/common/Environments'
// import { getTestingEnvironment } from '../TestUtils'
// import { ethers } from 'hardhat'
// import { expect } from 'chai'
// import { PrefixedHexString } from '../../src/relayclient/types/Aliases'
// import { UnsignedTransaction, Wallet } from 'ethers'

// describe('ContractInteractor', function () {
//   // TODO: these tests create an entire instance of the client to test one method.
//   context('#_validateCompatibility()', function () {
//     it('should not throw if the hub address is not configured', async function () {
//       const relayClient = new RelayClient(ethers.provider, { logLevel: 5 })
//       await relayClient._init()
//     })
//   })

//   context('#broadcastTransaction()', function () {
//     let provider: ProfilingProvider
//     let contractInteractor: ContractInteractor
//     let sampleTransactionHash: PrefixedHexString
//     let sampleTransactionData: PrefixedHexString

//     before(async function () {
//       const env: Environment = await getTestingEnvironment()
//       let pk: string = '46e6ef4a356fa3fa3929bf4b59e6b3eb9d0521ea660fd2879c67bd501002ac2b'
//       let address: string = '0xb473D6BE09D0d6a23e1832046dBE258cF6E8635B'
//       let gasPrice: number = 0
//       let txOpts = {}

//       if (isRsk(env)) {
//         pk = 'c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4'
//         address = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
//         gasPrice = 1
//         txOpts = { chainId: env.chainId }
//       }

//       provider = new ProfilingProvider(ethers.provider)
//       contractInteractor = new ContractInteractor(provider, configure({}))
//       const nonce = await ethers.provider.getTransactionCount(address)

//       const transaction: UnsignedTransaction = { ...txOpts, to: constants.ZERO_ADDRESS, gasLimit: '0x5208', gasPrice, nonce}

//       const w = new Wallet(Buffer.from(pk, 'hex'))

//       // const signedTx = await w.signTransaction(transaction)
//       ethers.utils.serializeTransaction(transaction)

//       sampleTransactionData = ethers.utils.serializeTransaction(transaction)
//       sampleTransactionHash = ethers.utils.keccak256(sampleTransactionData)
//     })

//     it('should sent the transaction to the blockchain directly', async function () {
//       const txHash = await contractInteractor.broadcastTransaction(sampleTransactionData)
//       expect(txHash).to.be.equal(sampleTransactionHash)
//       expect(provider.methodsCount.size).to.be.equal(1)
//       expect(provider.methodsCount.get('eth_sendRawTransaction')).to.be.equal(1)
//     })
//   })
// })

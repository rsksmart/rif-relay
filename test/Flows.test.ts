// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import { RelayProvider } from '../src/relayclient/RelayProvider'
import { Address, AsyncDataCallback } from '../src/relayclient/types/Aliases'
import {
  RelayHubInstance, StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance, TestPaymasterPreconfiguredApprovalInstance,
  TestRecipientInstance,ProxyFactoryInstance, ForwarderInstance
} from '../types/truffle-contracts'
import { deployHub, startRelay, stopRelay, getTestingEnvironment } from './TestUtils'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { GSNConfig } from '../src/relayclient/GSNConfigurator'
import TypedRequestData,{ GsnRequestType, getDomainSeparatorHash} from '../src/common/EIP712/TypedRequestData'
// @ts-ignore
import {TypedDataUtils} from 'eth-sig-util'
import { bufferToHex} from 'ethereumjs-util'
import {getEip712Signature} from '../src/common/Utils'


const TestRecipient = artifacts.require('tests/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('tests/TestPaymasterEverythingAccepted')
const TestPaymasterPreconfiguredApproval = artifacts.require('tests/TestPaymasterPreconfiguredApproval')

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')
const ProxyFactory = artifacts.require('ProxyFactory')


const options = [
  {
    title: 'Direct-',
    relay: false
  },
  {
    title: 'Relayed-',
    relay: true
  }
]

options.forEach(params => {
  contract(params.title + 'Flow', function (accounts) {
    let from: Address
    let sr: TestRecipientInstance
    let paymaster: TestPaymasterEverythingAcceptedInstance
    let rhub: RelayHubInstance
    let sm: StakeManagerInstance
    let gasless: Address
    let relayproc: ChildProcessWithoutNullStreams
    let relayClientConfig: Partial<GSNConfig>
    let factory : ProxyFactoryInstance //Creator of Smart Wallets


    before(async () => {
      const gasPricePercent = 20
      const env = await getTestingEnvironment()

      gasless = await web3.eth.personal.newAccount('password')
      await web3.eth.personal.unlockAccount(gasless, 'password')

      sm = await StakeManager.new()
      const p = await Penalizer.new()
      rhub = await deployHub(sm.address, p.address, env)
      if (params.relay) {
        relayproc = await startRelay(rhub.address, sm, {
          stake: 1e18,
          delay: 3600 * 24 * 7,
          pctRelayFee: 12,
          url: 'asd',
          relayOwner: accounts[0],
          // @ts-ignore
          ethereumNodeUrl: web3.currentProvider.host,
          gasPricePercent: gasPricePercent,
          relaylog: true // process.env.relaylog
        })
        console.log('relay started')
        from = gasless
      } else {
        from = accounts[0]
      }

      let forwarder:ForwarderInstance = await Forwarder.new()

      await forwarder.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )

      ////
      factory = await ProxyFactory.new(forwarder.address)

      await factory.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
     )
  
      const logicAddress = '0x0000000000000000000000000000000000000000';
      const initParams = '0x';
      const reqParamCount = 11;
      const rReq={
        request:{
          to: '0x0000000000000000000000000000000000000000',
          data: '0x',
          from: gasless,
          nonce: '0',
          value: '0',
          gas: '400000',
          tokenRecipient: '0x0000000000000000000000000000000000000000',
          tokenContract: '0x0000000000000000000000000000000000000000',
          paybackTokens: '0',
          tokenGas: '400000',
          isDeploy: true
        },
        relayData:{
          gasPrice:'10',
          pctRelayFee:'10',
          baseRelayFee:'10000',
          relayWorker: '0x0000000000000000000000000000000000000000',
          paymaster:'0x0000000000000000000000000000000000000000',
          forwarder: '0x0000000000000000000000000000000000000000',
          paymasterData:'0x',
          clientId:'1'
        }
      }
  
      const createdataToSign = new TypedRequestData(
        env.chainId,
        factory.address,
        rReq
      )
  
      const deploySignature = await getEip712Signature(
        web3,
        createdataToSign
      )
  
      const FORWARDER_PARAMS = "address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 paybackTokens,uint256 tokenGas,bool isDeploy";
      const typeName = `${GsnRequestType.typeName}(${FORWARDER_PARAMS},${GsnRequestType.typeSuffix}`
      const typeHash = web3.utils.keccak256(typeName)
  
      const encoded = TypedDataUtils.encodeData(createdataToSign.primaryType, createdataToSign.message, createdataToSign.types);
      let suffixData = bufferToHex(encoded.slice((1 + reqParamCount) * 32))
  
      let a = await factory.relayedUserSmartWalletCreation(rReq.request, getDomainSeparatorHash(factory.address,env.chainId), typeHash,suffixData,deploySignature);
      const fwdAddress = await factory.getSmartWalletAddress(gasless, logicAddress, initParams)      
      const fwd:ForwarderInstance = await Forwarder.at(fwdAddress);
      await fwd.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
     )
      forwarder= fwd;
      ////
      sr = await TestRecipient.new(forwarder.address)

      paymaster = await TestPaymasterEverythingAccepted.new()
      await paymaster.setTrustedForwarder(forwarder.address)
      await paymaster.setRelayHub(rhub.address)
    })

    after(async function () {
      await stopRelay(relayproc)
    })

    if (params.relay) {
      before(params.title + 'enable relay', async function () {
        await rhub.depositFor(paymaster.address, { value: (1e18).toString() })

        const env = await getTestingEnvironment()
        
        relayClientConfig = {
          relayHubAddress: rhub.address,
          stakeManagerAddress: sm.address,
          paymasterAddress: paymaster.address,
          verbose: false,
          chainId: env.chainId
        }

        // @ts-ignore
        const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)

        // web3.setProvider(relayProvider)

        // NOTE: in real application its enough to set the provider in web3.
        // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
        // so changing the global one is not enough...
        TestRecipient.web3.setProvider(relayProvider)
      })
    }

    it(params.title + 'send normal transaction', async () => {
      console.log('running emitMessage (should succeed)')
      let res
      try {
        const gas = await sr.contract.methods.emitMessage('hello').estimateGas()
        res = await sr.emitMessage('hello', { from: from, gas })
      } catch (e) {
        console.log('error is ', e.message)
        throw e
      }
      assert.equal('hello', res.logs[0].args.message)
    })

    it(params.title + 'send gasless transaction', async () => {
      console.log('gasless=' + gasless)

      console.log('running gasless-emitMessage (should fail for direct, succeed for relayed)')
      let ex: Error | undefined
      try {
        const res = await sr.emitMessage('hello, from gasless', { from: gasless, gas: 1e6 })
        console.log('res after gasless emit:', res.logs[0].args.message)
      } catch (e) {
        ex = e
      }

      if (params.relay) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        assert.ok(ex == null, `should succeed sending gasless transaction through relay. got: ${ex?.toString()}`)
      } else {
        // In RSK if the account doesn't have funds the error message received is 'the sender account doesn't exist'
        // eslint-disable-next-line @typescript-eslint/no-base-to-string,@typescript-eslint/restrict-template-expressions
        assert.ok(ex!.toString().indexOf('the sender account doesn\'t exist') > 0, `Expected Error with 'the sender account doesn\'t exist'. got: ${ex?.toString()}`)
      }
    })
    it(params.title + 'running testRevert (should always fail)', async () => {
      await asyncShouldThrow(async () => {
        await sr.testRevert({ from: from })
      }, 'revert')
    })

    if (params.relay) {
      let approvalPaymaster: TestPaymasterPreconfiguredApprovalInstance
      let relayProvider: RelayProvider

      describe('request with approvaldata', () => {
        before(async function () {
          approvalPaymaster = await TestPaymasterPreconfiguredApproval.new()
          await approvalPaymaster.setRelayHub(rhub.address)
          await approvalPaymaster.setTrustedForwarder(await sr.getTrustedForwarder())
          await rhub.depositFor(approvalPaymaster.address, { value: (1e18).toString() })
        })

        const setRecipientProvider = function (asyncApprovalData: AsyncDataCallback): void {
          relayProvider =
            // @ts-ignore
            new RelayProvider(web3.currentProvider,
              relayClientConfig, { asyncApprovalData })
          TestRecipient.web3.setProvider(relayProvider)
        }

        it(params.title + 'wait for specific approvalData', async () => {
          try {
            await approvalPaymaster.setExpectedApprovalData('0x414243', {
              from: accounts[0]
              //,useGSN: false
            })

            setRecipientProvider(async () => await Promise.resolve('0x414243'))

            await sr.emitMessage('xxx', {
              from: gasless,
              paymaster: approvalPaymaster.address
            })
          } catch (e) {
            console.log('error1: ', e)
            throw e
          } finally {
            await approvalPaymaster.setExpectedApprovalData('0x', {
              from: accounts[0]
              //,useGSN: false
            })
          }
        })

        it(params.title + 'fail if asyncApprovalData throws', async () => {
          setRecipientProvider(() => { throw new Error('approval-exception') })
          await asyncShouldThrow(async () => {
            await sr.emitMessage('xxx', {
              from: gasless,
              paymaster: approvalPaymaster.address
            })
          }, 'Error: approval-exception')
        })

        it(params.title + 'fail on no approval data', async () => {
          try {
            // @ts-ignore
            await approvalPaymaster.setExpectedApprovalData(Buffer.from('hello1'), {
              from: accounts[0]
              //,useGSN: false
            })
            await asyncShouldThrow(async () => {
              setRecipientProvider(async () => await Promise.resolve('0x'))

              await sr.emitMessage('xxx', {
                from: gasless,
                paymaster: approvalPaymaster.address
              })
            }, 'unexpected approvalData: \'\' instead of')
          } catch (e) {
            console.log('error3: ', e)
            throw e
          } finally {
            // @ts-ignore
            await approvalPaymaster.setExpectedApprovalData(Buffer.from(''), {
              from: accounts[0]
              //,useGSN: false
            })
          }
        })
      })
    }

    async function asyncShouldThrow (asyncFunc: () => Promise<any>, str?: string): Promise<void> {
      const msg = str ?? 'Error'
      let ex: Error | undefined
      try {
        await asyncFunc()
      } catch (e) {
        ex = e
      }
      assert.ok(ex != null, `Expected to throw ${msg} but threw nothing`)
      const isExpectedError = ex?.toString().includes(msg)
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      assert.ok(isExpectedError, `Expected to throw ${msg} but threw ${ex?.message}`)
    }
  })
})

import {
    TestRecipientInstance,
    DeployPaymasterInstance,
    RelayPaymasterInstance,
    TestTokenInstance,
    ForwarderInstance,
    TestForwarderTargetInstance,
    RelayHubInstance,
    ProxyFactoryInstance
  } from '../types/truffle-contracts'
//  import BN from 'bn.js'
//  import { PrefixedHexString } from 'ethereumjs-tx'
//  import { GsnRequestType } from '../src/common/EIP712/TypedRequestData'
//  import { deployHub, getTestingEnvironment } from './TestUtils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import BN = require('bn.js')
import { deployHub, getTestingEnvironment } from './TestUtils'
import { Environment } from '../src/common/Environments'
  
const Forwarder = artifacts.require('Forwarder')
const DeployPaymaster = artifacts.require('DeployPaymaster')
const RelayPaymaster = artifacts.require('RelayPaymaster')
const TestToken = artifacts.require('TestToken')
const TestForwarderTarget = artifacts.require('TestForwarderTarget')
const ProxyFactory = artifacts.require('ProxyFactory')

const baseRelayFee = '10000'
const pctRelayFee = '10'
const gasPrice = '10'
const gasLimit = '1000000'
const senderNonce = '0'
let relayRequestData: RelayRequest
const paymasterData = '0x'
const clientId = '1'
const tokensPaid = 1
  
  contract('DeployPaymaster', function ([_, dest, relayManager, relayWorker, senderAddress, other, paymasterOwner, relayHub]) {
    let deployPaymaster: DeployPaymasterInstance
    let token: TestTokenInstance
    let fwd: ForwarderInstance
    let recipient : TestForwarderTargetInstance
    let proxy : ProxyFactoryInstance
    let forwarder: string    
  
    before(async function () {
      fwd = await Forwarder.new();
      forwarder = fwd.address;

      recipient = await TestForwarderTarget.new(forwarder);
      deployPaymaster = await DeployPaymaster.new({from:paymasterOwner});
      token = await TestToken.new();
      proxy = await ProxyFactory.new(fwd.address);

      await deployPaymaster.setTrustedForwarder(forwarder, {from:paymasterOwner});
      await deployPaymaster.setRelayHub(relayHub, {from:paymasterOwner});
      await deployPaymaster.setProxyFactory(relayHub, {from:paymasterOwner});

      let data;

      data = "0xef06ad14000000000000000000000000c783df8a850f42e7f7e57013759c285caa701eb600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000078371bdede8aac7debfff451b74c5edb385af7000000000000000000000000ead9c93b79ae7c1591b1fb5323bd777e86e150d4000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000186a0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000002a59800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000411fdf77b663cd5082669f97b136f87f8322a23e6c494cb0c5929f4581b6aaa0161b20485f69455eeb2e59e321e8b9751855955e38fe5b9cc1e45d5d82ca92b6b81b00000000000000000000000000000000000000000000000000000000000000"

      relayRequestData = {
        request: {
          to: recipient.address,
          data,
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          tokenRecipient: dest,
          tokenContract: token.address,
          paybackTokens: tokensPaid.toString(),
          tokenGas: gasLimit,
        },
        relayData: {
          pctRelayFee,
          baseRelayFee,
          gasPrice,
          relayWorker,
          forwarder,
          paymaster: deployPaymaster.address,
          paymasterData,
          clientId
        }
      }

    })
  
    it('Should not fail on checks of preRelayCall', async function () {     
      //await deployPaymaster.preRelayedCallInternal(relayRequestData);
    })
  });

  contract('RelayPaymaster', function ([_, dest, relayManager, relayWorker, senderAddress, other, paymasterOwner, relayHub]) {
    let relayPaymaster: RelayPaymasterInstance
    let token: TestTokenInstance
    let fwd: ForwarderInstance
    let recipient : TestForwarderTargetInstance
    let proxy : ProxyFactoryInstance
    let forwarder: string
    let relayRequestData: RelayRequest

    before(async function () {
      fwd = await Forwarder.new();
      forwarder = fwd.address;

      recipient = await TestForwarderTarget.new(forwarder);
      relayPaymaster = await RelayPaymaster.new({from:paymasterOwner});
      token = await TestToken.new();
      proxy = await ProxyFactory.new(fwd.address);

      await relayPaymaster.setTrustedForwarder(forwarder, {from:paymasterOwner});
      await relayPaymaster.setRelayHub(relayHub, {from:paymasterOwner});


      relayRequestData = {
        request: {
          to: recipient.address,
          data:"0x00",
          from: fwd.address,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          tokenRecipient: dest,
          tokenContract: token.address,
          paybackTokens: tokensPaid.toString(),
          tokenGas: gasLimit,
        },
        relayData: {
          pctRelayFee,
          baseRelayFee,
          gasPrice,
          relayWorker,
          forwarder,
          paymaster: relayPaymaster.address,
          paymasterData,
          clientId
        }
      }
    })

    it('Should not fail on checks of preRelayCall', async function () {     
      await relayPaymaster.preRelayedCallInternal(relayRequestData);
    })
  })
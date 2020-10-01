import {
    TestRecipientInstance,
    DeployPaymasterInstance,
    RelayPaymasterInstance,
    TestTokenInstance,
    ForwarderInstance,
    TestForwarderTargetInstance,
    RelayHubInstance
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
  
  contract('DeployPaymaster', function ([_, dest, relayManager, relayWorker, senderAddress, other, paymasterOwner, relayHub]) {
    let deployPaymaster: DeployPaymasterInstance
    let token: TestTokenInstance
    let fwd: ForwarderInstance
    let recipient : TestForwarderTargetInstance
    let forwarder: string

    const baseRelayFee = '10000'
    const pctRelayFee = '10'
    const gasPrice = '10'
    const gasLimit = '1000000'
    const senderNonce = '0'
    let relayRequestData: RelayRequest
    const paymasterData = '0x'
    const clientId = '1'
    const tokensPaid = 1
    
  
    before(async function () {
      fwd = await Forwarder.new();
      forwarder = fwd.address;

      recipient = await TestForwarderTarget.new(forwarder);
      deployPaymaster = await DeployPaymaster.new({from:paymasterOwner});
      token = await TestToken.new();

      await deployPaymaster.setTrustedForwarder(forwarder, {from:paymasterOwner});
      await deployPaymaster.setRelayHub(relayHub, {from:paymasterOwner});

      relayRequestData = {
        request: {
          to: recipient.address,
          data: '0x00',
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
      await deployPaymaster.preRelayedCallInternal(relayRequestData, {from : relayHub});
    })
  })
  
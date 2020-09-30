import {
    TestRecipientInstance,
    DeployPaymasterInstance,
    RelayPaymasterInstance,
    TestTokenInstance,
    ForwarderInstance,
    TestForwarderTargetInstance
  } from '../types/truffle-contracts'
//  import BN from 'bn.js'
//  import { PrefixedHexString } from 'ethereumjs-tx'
//  import { GsnRequestType } from '../src/common/EIP712/TypedRequestData'
//  import { deployHub, getTestingEnvironment } from './TestUtils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import BN = require('bn.js')
  
const Forwarder = artifacts.require('Forwarder')
const DeployPaymaster = artifacts.require('DeployPaymaster')
const RelayPaymaster = artifacts.require('RelayPaymaster')
const TestToken = artifacts.require('TestToken')
const TestForwarderTarget = artifacts.require('TestForwarderTarget')

  
  contract('TokenPaymaster', function ([_, dest, relayManager, relayWorker, senderAddress, other, paymasterOwner, incorrectWorker]) {
    let deployPaymaster: DeployPaymasterInstance
    let relayPaymaster: RelayPaymasterInstance
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
      deploypaymaster = await TokenPaymaster.new({from:paymasterOwner});
      token = await TestToken.new()

      paymaster.setTrustedForwarder(forwarder, {from:paymasterOwner});

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
          paymaster: paymaster.address,
          paymasterData,
          clientId
        }
      }

    })
  
    it('should succeed on transfer tokens to paymaster contract', async function () {
      let paymasterAddress = paymaster.address;

      let expectedTokens = new BN(tokensPaid);
      
      //we mint tokens to the sender, and aprrove the allowance
      await token.mint(tokensPaid+4,senderAddress);
      await token.approve(paymasterAddress, tokensPaid+4, {from:senderAddress});

      //run method
      await paymaster.preRelayedCallInternal(relayRequestData);

      assert.equal((await token.balanceOf(paymasterAddress)).toNumber(), expectedTokens.toNumber());
    })
  })
  
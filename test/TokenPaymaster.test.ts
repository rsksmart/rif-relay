import {
    TestRecipientInstance,
    TokenPaymasterInstance,
    TestTokenInstance,
  } from '../types/truffle-contracts'
//  import BN from 'bn.js'
//  import { PrefixedHexString } from 'ethereumjs-tx'
//  import { GsnRequestType } from '../src/common/EIP712/TypedRequestData'
//  import { deployHub, getTestingEnvironment } from './TestUtils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import BN = require('bn.js')
  
const TokenPaymaster = artifacts.require('TokenPaymaster')
const TestToken = artifacts.require('TestToken')

  
  contract('TokenPaymaster', function ([_, relayOwner, relayManager, relayWorker, senderAddress, other, dest, incorrectWorker]) {
    let paymaster: TokenPaymasterInstance
    let token: TestTokenInstance
    let forwarder: string
    let tokenAddress: string
    let paymasterAddress: string

    const baseRelayFee = '10000'
    const pctRelayFee = '10'
    const gasPrice = '10'
    const gasLimit = '1000000'
    const senderNonce = '0'
    let relayRequestData: RelayRequest
    const paymasterData = '0x'
    const clientId = '1'
    const tokensPaid = 1
    forwarder = other;
  
    before(async function () {
      paymaster = await TokenPaymaster.new()
      token = await TestToken.new()
      paymasterAddress = paymaster.address
      tokenAddress = token.address

      relayRequestData = {
        request: {
          to: dest,
          data: '0x00',
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          tokenRecipient: dest,
          tokenContract: tokenAddress,
          paybackTokens: tokensPaid.toString(),
          tokenGas: gasLimit,
        },
        relayData: {
          pctRelayFee,
          baseRelayFee,
          gasPrice,
          relayWorker,
          forwarder,
          paymaster: paymasterAddress,
          paymasterData,
          clientId
        }
      }

    })
  
    it('should succeed on transfer tokens to paymaster contract', async function () {
      let expectedTokens = new BN(tokensPaid);
      
      //we mint tokens to the sender, and aprrove the allowance
      await token.mint(tokensPaid+4,senderAddress);
      await token.approve(paymasterAddress, tokensPaid+4, {from:senderAddress});

      //run method
      await paymaster.preRelayedCallInternal(relayRequestData);

      assert.equal((await token.balanceOf(paymasterAddress)).toNumber(), expectedTokens.toNumber());
    })
  })
  
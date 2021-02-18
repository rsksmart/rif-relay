# Integration guide

Enveloping allows the user to pay fees with token. To achieve this, Enveloping exposes functions that dApps and wallets can consume in order to enable the option to pay the transaction adopting directly Enveloping.

## Using the Relay Provider

An option is to adopt Enveloping is through the Relay Provider. It wraps web3, so all the transaction and calls are made through the Relay Provider. HABLAR DE RELAY CLIENT Y RELAY SERVER.

```typescript
    this.config = await resolveConfigurationGSN(web3.currentProvider, {
      verbose: window.location.href.includes('verbose'),
      onlyPreferredRelays: false, //If false it will look for a relayer, if true it reads preferred Relays
      chainId: chainId,
      relayVerifierAddress: this.contracts.relayVerifier,
      factory: this.contracts.factory,
      preferredRelays:[]
    })

    this.provider = new Enveloping.RelayProvider(web3.currentProvider, this.config)
    web3.setProvider(this.provider)

    this.provider.deploySmartWallet(trxData)
    this.provider.calculateSmartWalletAddress(
    factory.address,gaslessAccount.address, recoverer, customLogic, walletIndex, bytecodeHash)

    await testRecipient.emitMessage('hello world', {
        from: gaslessAccount.address,
        gas: '100000',
        gasPrice: '1',
        callVerifier: verifierInstance.address,
        onlyPreferredRelays: true //It will read the preferredRelays on the config.
    })
```

## Using the Relay Server directly

Another option to use Enveloping in your wallet or dApp is using the Relay Server directly. The instructions for running a Relayer are [here](docs/launching_enveloping.md). The communication with the Relay Server is through HTTP requests.

The order for relaying or deploying a transaction through the Relay Server is
1. Create a relay or deploy request.
2. Sign the structure using the EIP712 signature.
3. Create the metadata with the signature.
4. With the relay or deploy request and the metadata, creating an HTTP request.
5. Call the HTTP Server `/relay` method using an HTTP POST request.


### Example of deploying a Smart Wallet using Enveloping

As we mentioned in the [documentation]() an advantage of the Enveloping's solution is the chance to have a token's wallet without deploying it. Only when a user wants to use her tokens, it needs to request the deployment of the smart wallet using a deploy request.




```typescript
from: this.smartWalletOwner,                  // EOA who will be the owner of this SmartWallet
      to: ZERO_ADDR,                                // The SmartWallet will not have custom logic
      callVerifier: DEPLOY_VERIFIER_ADDR,             // The verifier that will verify the transaction
      factory: this.contracts.factory,              // The factory contract that will create the SmartWallet proxy
      tokenContract: this.rifTokenContract.options.address, // The token the user will use to pay for the SmartWallet deploy 
      tokenRecipient: DEPLOY_VERIFIER_ADDR,        // The deployment cost will be paid in tokens to this paymaster
      tokenAmount: "0",                             // The user will no pay RIF tokens for the deployment
      data: '0x',                                   // No initialization params for custom logic
      index:index,                                 // Index that allows the user to create multiple SmartWallets
      recoverer: ZERO_ADDR,                         // This SmartWallet instance will not hace recovery support,

    const deployRequest: DeployRequest = {
        request: {
            relayHub: RELAY_HUB_ADDRESS,
            to: PROXY_FACTORY_ADDRESS,  // The factory contract that will create the SmartWallet proxy
            data: '0x', // No initialization parameters for custom logic
            from: EOA_ADDRESS, // EOA who will be the owner of this SmartWallet
            value: '0',
            nonce: senderNonce, // const senderNonce = await factory.nonce(from)
            gas: gasLimit,
            tokenAmount: gsnTransactionDetails.tokenAmount ?? , //Amount of tokens paid for the deployment, can be 0 if the deploy is subsidized
            tokenContract: gsnTransactionDetails.tokenContract ?? // The token the user will use to pay for the SmartWallet deploy 
            recoverer: gsnTransactionDetails.recoverer ?? constants.ZERO_ADDRESS, //Optional recoverer account/contract, can be address(0)
            index: gsnTransactionDetails.index ?? '0' // index:IntString => Numeric value used to generate several SW instances using the same paramaters defined above
        },
            relayData: {
            gasPrice,
            callVerifier,
            domainSeparator: getDomainSeparatorHash(forwarderAddress, this.accountManager.chainId),
            callForwarder: forwarderAddress,
            relayWorker
        }
    }

    const cloneRequest = { ...deployRequest }
    const signedData = new TypedRequestData(
        chainId,
        SMART_WALLET_ADDRESS,
        cloneRequest
    )

    const signature =  sigUtil.signTypedData_v4(privKey, { data: signedData })

    const metadata: RelayMetadata = {
        relayHubAddress: RELAY_HUB_ADDRESS,
        signature: sign(deployRequest),
        approvalData: '0x',
        relayMaxNonce: this.web3.eth.getTransactionCount(RELAY_WORKER_ADDRESS, defaultBlock) + (0 || 3)
    }

    const httpRequest: DeployTransactionRequest = {
        relayRequest,
        metadata
    }
    ​
    call '/relay' with httpRequest


const enveloping = new Enveloping(GSNConfig)   

//Create a deploy request
const deployRequest = enveloping.createDeployRequest(from, gasLimit, tokenContract, tokenAmount, index)

//Signed the deploy request
const signature = enveloping.signRequest(deployRequest)

//Send http request
const status = enveloping.sendHttpRequest(deployRequest, signature)
```

### Example of relaying a transaction using Enveloping

This is an example for relay a transaction from a gasless account to a contract sponsored by a relayer.

```typescript
    const relayRequest: RelayRequest = {
        request: {
            relayHub: RELAY_HUB_ADDRESS
            to: ADDRESS_OF_CONTRACT_TO_CALL 
            data: msg.data //Sponsored transaction encoded
            from: EOA_ADDRESS_OF_SMARTWALLET,
            value: ZERO_VALUE, //0 native-currency
            nonce: getSenderNonce //Sender's nonce in the sender's smart wallet.
            gas: GAS_OF_USER_CALL, // gas cost of the sponsored transaction
            tokenAmount: token_amount, //tokens pay to the relayer
            tokenContract: RIF_CONTRACT_ADDRESS, //address of the token's contract
            },
        relayData: {
            gasPrice: '60000000',
            domainSeparator: getDomainSeparatorHash(forwarder, chainId)
            relayWorker: RELAY_WORKER_ADDRESS
            callForwarder: SMART_WALLET_ADDRESS
            callVerifier: RELAY_VERIFIER_ADDRESS
        }
    }

    const cloneRequest = { ...relayRequest }
    const signedData = new TypedRequestData(
        chainId,
        SMART_WALLET_ADDRESS,
        cloneRequest
    )

    const signature =  sigUtil.signTypedData_v4(privKey, { data: signedData })

    const metadata: RelayMetadata = {
        relayHubAddress: RELAY_HUB_ADDRESS,
        signature: sign(relayRequest),
        approvalData: '0x',
        relayMaxNonce: this.web3.eth.getTransactionCount(RELAY_WORKER_ADDRESS, defaultBlock) + (0 || 3)
    }

    const httpRequest: RelayTransactionRequest = {
        relayRequest,
        metadata
    }
    ​
    call '/relay' with httpRequest
```

## MetaCoin

As a complete example, we developed Metacoin for minting and sending tokens without requiring RBTC for gas. Works on Regtest.

Try it: https://github.com/rsksmart/enveloping-metacoin
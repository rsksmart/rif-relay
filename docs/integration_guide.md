# Integration guide

Enveloping allows the user to pay fees with token. To achieve this, Enveloping expose functions that dApps and wallet can consume in order to enable the option to pay the transaction adopting directly Enveloping.

## Using the Relay Provider

An option to adopt Enveloping is setting the Relay Provider as provider. It wraps web3, so all the transaction and calls made pass through the Relay Provider.

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

## Using the Relay Server

Another option to use Enveloping in your wallet or dApp is through an own Relay Server. The instructions for running it are [here](docs/launching_enveloping.md).



## MetaCoin

As a complete example, we developed Metacoin for minting and sending tokens without requiring RBTC for gas. Works on Regtest.

Try it: https://github.com/rsksmart/enveloping-metacoin
# RIF Enveloping - V2

A secure sponsored-transaction system to enable users to pay fees using ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/enveloping/tree/master)
## Description

The first version of Enveloping was based on the [Gas Station Network (GSN) project](https://github.com/opengsn/gsn). GSN is a decentralized system that improves dApp usability without sacrificing security. In a nutshell, GSN abstracts away gas (used to pay transaction fees) to minimize onboarding and UX friction for dApps. With GSN, "gasless clients" can interact with smart contracts paying for gas with tokens instead of native-currency.

RIF Enveloping V2 is a redesign of GSN. It reduces gas costs and simplifies contract interaction.

It achieves this by:

- Securely deploying counterfactual Smart Wallet proxies for each user account: this eliminates the need for relying on _msgSender() and _msgData() functions, making existing and future contracts compatible with RIF Enveloping without any modification.
- Allowing Relay providers to receive tokens in a worker address under their control to later on decide what to do with funds.
- Reducing gas costs by optimizing the existing GSN architecture.

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokens, and thereby remove the need to acquire RBTC in advance.

It is important to recall that  - as a security measure - the version 1 contracts deployed on Mainnet have limits on the amount of RBTC that can be staked, these  limits were removed in version 2.

## Technical Documentation

The following technical content are available:

- Enveloping architecture [docs/enveloping_architecture](docs/enveloping_architecture.md)
- Installing basic requirements [docs/basic_requirements](docs/basic_requirements.md)
- Launching enveloping [docs/launching_enveloping](docs/launching_enveloping.md)
- Development guide [docs/development_guide](docs/development_guide.md)
- Integration guide [docs/integration_guide](docs/integration_guide.md)
- RIF Enveloping gas costs [docs/overhead_tx_costs](docs/overhead_tx_costs.md)


## Testnet Contracts - V2

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [StakeManager][1]    | 0xb059f16a6BDa9D8372AF8699b1d256dB630aBD3e |
| [Penalizer][2]       | 0xD44B83F6c1F7FD6832617F5090251995e8ceA526 |
| [RelayHub][3]        | 0x0fD966aE0b39EC5177d04348D92391E2571523cD |
| [SmartWallet][4]     | 0x06Abd711C3AdD1363C8DcAB6aB3e58477818C043 |
| [ProxyFactory][5]    | 0xc546898f17226ccC271f5060339c3b74733b2B62 |
| [SimpleSmartWallet][6]    | 0xE94B9C5Bb2B323F7D748cAb397E64a5d3D774201 |
| [SimpleProxyFactory][7]   | 0x70279F9Ed7222AcEf62e6794Db762Fa43e51043E |
| [DeployVerifier][8]  | 0x515Daa4c05B65C5FfBC4cddcc10F26aa8B7ABF62 |
| [RelayVerifier][9]   | 0x5316C84AB67Eff7f09e376d5caA2df77ad585717 |

[1]:(https://explorer.testnet.rsk.co/address/0xb059f16a6BDa9D8372AF8699b1d256dB630aBD3e)
[2]:(https://explorer.testnet.rsk.co/address/0xD44B83F6c1F7FD6832617F5090251995e8ceA526)
[3]:(https://explorer.testnet.rsk.co/address/0x0fD966aE0b39EC5177d04348D92391E2571523cD)
[4]:(https://explorer.testnet.rsk.co/address/0x06Abd711C3AdD1363C8DcAB6aB3e58477818C043)
[5]:(https://explorer.testnet.rsk.co/address/0xc546898f17226ccC271f5060339c3b74733b2B62)
[6]:(https://explorer.testnet.rsk.co/address/0xE94B9C5Bb2B323F7D748cAb397E64a5d3D774201)
[7]:(https://explorer.testnet.rsk.co/address/0x70279F9Ed7222AcEf62e6794Db762Fa43e51043E)
[8]:(https://explorer.testnet.rsk.co/address/0x515Daa4c05B65C5FfBC4cddcc10F26aa8B7ABF62)
[9]:(https://explorer.testnet.rsk.co/address/0x5316C84AB67Eff7f09e376d5caA2df77ad585717)
## Testnet Contracts - V1

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [StakeManager][10]    | 0x4aD91a4315b3C060F60B69Fd0d1eBaf16c14148D |
| [Penalizer][11]       | 0xd3021763366708d5FD07bD3A7Cd04F94Fc5e1726 |
| [RelayHub][12]        | 0x3f8e67A0aCc07ff2F4f46dcF173C652765a9CA6C |
| [TestRecipient][13]   | 0xFBE5bF13F7533F00dF301e752b41c96965c10Bfa |
| [SmartWallet][14]     | 0xE7552f1FF31670aa36b08c17e3F1F582Af6302d1 |
| [ProxyFactory][15]    | 0xb7a5370F126d51138d60e20E3F332c81f1507Ce2 |
| [DeployVerifier][16] | 0x3AD4EDEc75570c3B03620f84d37EF7F9021665bC |
| [RelayVerifier][17]  | 0x053b4a77e9d5895920cBF505eB8108F99d929395 |

[10]:(https://explorer.testnet.rsk.co/address/0x4aD91a4315b3C060F60B69Fd0d1eBaf16c14148D)
[11]:(https://explorer.testnet.rsk.co/address/0xd3021763366708d5FD07bD3A7Cd04F94Fc5e1726)
[12]:(https://explorer.testnet.rsk.co/address/0x3f8e67A0aCc07ff2F4f46dcF173C652765a9CA6C)
[13]:(https://explorer.testnet.rsk.co/address/0xFBE5bF13F7533F00dF301e752b41c96965c10Bfa)
[14]:(https://explorer.testnet.rsk.co/address/0xE7552f1FF31670aa36b08c17e3F1F582Af6302d1)
[15]:(https://explorer.testnet.rsk.co/address/0xb7a5370F126d51138d60e20E3F332c81f1507Ce2)
[16]:(https://explorer.testnet.rsk.co/address/0x3AD4EDEc75570c3B03620f84d37EF7F9021665bC)
[17]:(https://explorer.testnet.rsk.co/address/0x053b4a77e9d5895920cBF505eB8108F99d929395)

## Create a Smart Wallet

As mentioned before, the moment we need to use the Enveloping system, we have to deploy a Smart Wallet (SW). 

1. **Use your address to deploy a Smart Wallet (SW)**
```typescript
      const trxData: EnvelopingTransactionDetails = {
        from: ownerEOA.address,
        to: customLogic,
        data: logicData,
        tokenRecipient: paymaster,
        tokenContract: token.address,
        tokenAmount: '10',
        factory: factory.address,
        recoverer: recoverer,
        index: walletIndex.toString(),
        paymaster: paymaster
      }

      const txHash = relayProvider.deploySmartWallet(trxData)
```

2. **Get your SW address**
```typescript
const swAddress = rProvider.calculateSmartWalletAddress(
factory.address,gaslessAccount.address, recoverer, customLogic, walletIndex, bytecodeHash)
//Using the same parameters as when SW was created.
```

## Changelog

### V2

* In V2 the Relay Hub contract doesn't receive payments, the payment for the service (in tokens) is paid directly to the worker relaying the transaction on behalf of the user.

* Paymaster verifications are now done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.

* Gas cost optimization

* Security issues fixed.

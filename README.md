# RIF Enveloping - V2

A secure transaction relay system to enable users to pay fees using ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/enveloping/tree/master)
## Description

RIF Enveloping takes its inspiration from the [Gas Station Network (GSN) project](https://github.com/opengsn/gsn). GSN is a decentralized system that improves dApp usability without sacrificing security. In a nutshell, GSN abstracts away gas (used to pay transaction fees) to minimize onboarding and UX friction for dApps. With GSN, "gasless clients" can interact with smart contracts paying for gas with tokens instead of native-currency.

RIF Enveloping V1 started as a fork of GSN with two goals in mind:

- Be compatible with existing and future smart contracts without requiring such contracts to be adapted to work with RIF Enveloping.
- Be as cost effective as possible.

RIF Enveloping V2 is a redesign of GSN, it reduces gas costs and simplifies the interaction between the different contracts that are part of the system. It achieves this by:

- Securely deploying counterfactual Smart Wallet proxies for each user account: this eliminates the need for relying on _msgSender() and _msgData() functions, making existing and future contracts compatible with RIF Enveloping without any modification.
- Allowing relayers to receive tokens in a worker address under their control and decide what to do with funds later on.
- Reducing gas costs by optimizing the GSN architecture.

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokens (e.g. RIF tokens), and thereby remove the need to acquire RBTC in advance.

It is important to recall that - as a security measure - the version 1 contracts deployed on Mainnet have limits on the staked amounts to operate, these limits were removed in version 2.

## Technical Documentation

The following technical content is available:

- Architecture [docs/enveloping_architecture](docs/enveloping_architecture.md)
- Installing requirements [docs/basic_requirements](docs/basic_requirements.md)
- Launching RIF Enveloping [docs/launching_enveloping](docs/launching_enveloping.md)
- Development guide [docs/development_guide](docs/development_guide.md)
- Integration guide [docs/integration_guide](docs/integration_guide.md)
- Gas costs [docs/overhead_tx_costs](docs/overhead_tx_costs.md)


## Testnet Contracts - V2

### Primary contracts

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [Penalizer][1]       | 0x39D731b481553E476fC82C64dA75EFDd03B41A0F |
| [RelayHub][2]        | 0x1c3aB77f8E1eCB6D61f7eb2733D69037C8F5485D |
| [SmartWallet][3]     | 0xC4dC9FDC6A397Cf8c4E7f2EAaEbEa9c865390C4b |
| [SmartWalletFactory][4]    | 0x8D47dC700Bb8e53e61Fbb6344d541E75B8A841b8 |
| [DeployVerifier][5] | 0x62a037a371539FD936361d93D3Da4b91fC2306EB |
| [RelayVerifier][6]  | 0x6270D9f0E1ed28f5A69Db56287F41ad8016C83Cf |

### For CustomSmartWallet support

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [CustomSmartWallet][7]     | 0x5ae8c096b29a5352dbd76eE458C8094EB63CF3Fb |
| [CustomSmartWalletFactory][8]    | 0x04B867e93104E752457736763417D322A1f5e8f3 |
| [CustomSmartWalletDeployVerifier][9] | 0xeaC0935274d0B62E0803a6C5Eb1043aB97801aD3 |
| [CustomSmartWalletRelayVerifier][10] | 0xB7cD33d2ebb3aF38988a6E78725d453B87D66437 |


### For Testing purposes

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [SampleRecipient][11]   | 0x18122D5Da028E4B9869311aeCE66A9DD7F00746B |
| [TestToken][12]   | 0x93160B8b13F14589758Ee84D1BfD51562A614Dd7 |

[1]: https://explorer.testnet.rsk.co/address/0x39D731b481553E476fC82C64dA75EFDd03B41A0F
[2]: https://explorer.testnet.rsk.co/address/0x1c3aB77f8E1eCB6D61f7eb2733D69037C8F5485D
[3]: https://explorer.testnet.rsk.co/address/0xC4dC9FDC6A397Cf8c4E7f2EAaEbEa9c865390C4b
[4]: https://explorer.testnet.rsk.co/address/0x8D47dC700Bb8e53e61Fbb6344d541E75B8A841b8
[5]: https://explorer.testnet.rsk.co/address/0x62a037a371539FD936361d93D3Da4b91fC2306EB
[6]: https://explorer.testnet.rsk.co/address/0x6270D9f0E1ed28f5A69Db56287F41ad8016C83Cf
[7]: https://explorer.testnet.rsk.co/address/0x5ae8c096b29a5352dbd76eE458C8094EB63CF3Fb
[8]: https://explorer.testnet.rsk.co/address/0x04B867e93104E752457736763417D322A1f5e8f3
[9]: https://explorer.testnet.rsk.co/address/0xeaC0935274d0B62E0803a6C5Eb1043aB97801aD3
[10]: https://explorer.testnet.rsk.co/address/0xB7cD33d2ebb3aF38988a6E78725d453B87D66437
[11]: https://explorer.testnet.rsk.co/address/0x18122D5Da028E4B9869311aeCE66A9DD7F00746B
[12]: https://explorer.testnet.rsk.co/address/0x93160B8b13F14589758Ee84D1BfD51562A614Dd7

## Changelog

### V2

* RelayHub contract doesn't receive payments, the payment for the service (in tokens) is sent directly to the worker relaying the transaction on behalf of the user.
* RelayHub contract now handles relay manager staking.
* Paymaster verifications are done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.
* Big gas cost optimization.
* Security issues fixed.

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
| [Penalizer][1]       | 0x193824d776cf82193c63a5c19AB06368F9c583Fb |
| [RelayHub][2]        | 0x572c36BFd46961b4F0c38459EA45Ad0403fC0dc6 |
| [SmartWallet][3]     | 0x9E09c9d0b40319c87d3232D536AFb89942feD5e8 |
| [SmartWalletFactory][4]    | 0x1A699cAa814B67279dEAc73aF214D9A6D2ce96Ef |
| [DeployVerifier][5] | 0x487e1345735adEf75005AF616869669172278c62 |
| [RelayVerifier][6]  | 0xfC31a94E4df97677742d2aF360Cb5E4795304F05 |

### For CustomSmartWallet support

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [CustomSmartWallet][7]     | 0xa79F0cE6D93fe202ffEDaE9C2EA88736e73d28D3 |
| [CustomSmartWalletFactory][8]    | 0x65d48e78935DaD9088626109cFb0abE51D509d14 |
| [CustomSmartWalletDeployVerifier][9] | 0xEa1a4D780ca2Efc6A51a071a20d7Fd00159F46a6 |
| [CustomSmartWalletRelayVerifier][10] | 0x1ce29Fe0398CdB106287e5710F13cc3b7a435Ea7 |


### For Testing purposes

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [SampleRecipient][11]   | 0x80ba06510D7DF0Fd2aD70e1222630Ce442Ef71d9 |
| [TestToken][12]   | 0x55533d63eb9D6B77f7D236765B0D99d21fF4f864 |

[1]: https://explorer.testnet.rsk.co/address/0x193824d776cf82193c63a5c19AB06368F9c583Fb
[2]: https://explorer.testnet.rsk.co/address/0x572c36BFd46961b4F0c38459EA45Ad0403fC0dc6
[3]: https://explorer.testnet.rsk.co/address/0x9E09c9d0b40319c87d3232D536AFb89942feD5e8
[4]: https://explorer.testnet.rsk.co/address/0x1A699cAa814B67279dEAc73aF214D9A6D2ce96Ef
[5]: https://explorer.testnet.rsk.co/address/0x487e1345735adEf75005AF616869669172278c62
[6]: https://explorer.testnet.rsk.co/address/0xfC31a94E4df97677742d2aF360Cb5E4795304F05
[7]: https://explorer.testnet.rsk.co/address/0xa79F0cE6D93fe202ffEDaE9C2EA88736e73d28D3
[8]: https://explorer.testnet.rsk.co/address/0x65d48e78935DaD9088626109cFb0abE51D509d14
[9]: https://explorer.testnet.rsk.co/address/0xEa1a4D780ca2Efc6A51a071a20d7Fd00159F46a6
[10]: https://explorer.testnet.rsk.co/address/0x1ce29Fe0398CdB106287e5710F13cc3b7a435Ea7
[11]: https://explorer.testnet.rsk.co/address/0x80ba06510D7DF0Fd2aD70e1222630Ce442Ef71d9
[12]: https://explorer.testnet.rsk.co/address/0x55533d63eb9D6B77f7D236765B0D99d21fF4f864

## Changelog

### V2

* RelayHub contract doesn't receive payments, the payment for the service (in tokens) is sent directly to the worker relaying the transaction on behalf of the user.
* RelayHub contract now handles relay manager staking.
* Paymaster verifications are done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.
* Big gas cost optimization.
* Security issues fixed.

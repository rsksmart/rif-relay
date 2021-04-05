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

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokens (e.g. RIF tokens), and thereby remove the need to acquire RBTC in advance.

It is important to recall that  - as a security measure - the version 1 contracts deployed on Mainnet have limits on the staked amounts to operate, these limits were removed in version 2.

## Technical Documentation

The following technical content are available:

- Enveloping architecture [docs/enveloping_architecture](docs/enveloping_architecture.md)
- Installing basic requirements [docs/basic_requirements](docs/basic_requirements.md)
- Launching enveloping [docs/launching_enveloping](docs/launching_enveloping.md)
- Development guide [docs/development_guide](docs/development_guide.md)
- Integration guide [docs/integration_guide](docs/integration_guide.md)
- RIF Enveloping gas costs [docs/overhead_tx_costs](docs/overhead_tx_costs.md)


## Testnet Contracts - V2

### Primary contracts

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [Penalizer][1]       | 0x82F3D69cA3d79E580931D4D58efbDD3D5dB7aB3f |
| [RelayHub][2]        | 0x0B5b176d682753DE19935964ca2459Ae324e7bda |
| [SmartWallet][3]     | 0xa3aeFc1AF430E830e74B66fA91D6726919cCFEF1 |
| [SmartWalletFactory][4]    | 0x71b41C09B8f99dA8b6B71535346c6536f66096c4 |
| [DeployVerifier][5] | 0xE3A1d035dCe5c40b97b39d774b9AE2739952b763 |
| [RelayVerifier][6]  | 0xD72FD5DF821cECbe2Cb0804e84093461Dd24252A |

### For CustomSmartWallet support

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [CustomSmartWallet][7]     | 0x910727b76b08bF9D1FE0B685e71C5e379D1DEBD3 |
| [CustomSmartWalletFactory][8]    | 0xa63Eb5935Fb2281b506C1789cdAee00BA45E3DE2 |
| [CustomSmartWalletDeployVerifier][9] | TBD |

### For Testing purposes

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [TestRecipient][10]   | 0x7158c388Adc7e21Cd9200B06b29F62eeBa55E9FD |

[1]: https://explorer.testnet.rsk.co/address/0x82F3D69cA3d79E580931D4D58efbDD3D5dB7aB3f
[2]: https://explorer.testnet.rsk.co/address/0x0B5b176d682753DE19935964ca2459Ae324e7bda
[3]: https://explorer.testnet.rsk.co/address/0xa3aeFc1AF430E830e74B66fA91D6726919cCFEF1
[4]: https://explorer.testnet.rsk.co/address/0x71b41C09B8f99dA8b6B71535346c6536f66096c4
[5]: https://explorer.testnet.rsk.co/address/0xE3A1d035dCe5c40b97b39d774b9AE2739952b763
[6]: https://explorer.testnet.rsk.co/address/0xD72FD5DF821cECbe2Cb0804e84093461Dd24252A
[7]: https://explorer.testnet.rsk.co/address/0x910727b76b08bF9D1FE0B685e71C5e379D1DEBD3
[8]: https://explorer.testnet.rsk.co/address/0xa63Eb5935Fb2281b506C1789cdAee00BA45E3DE2
[9]: https://explorer.testnet.rsk.co/address/TBD
[10]: https://explorer.testnet.rsk.co/address/0x7158c388Adc7e21Cd9200B06b29F62eeBa55E9FD


## Changelog

### V2

* RelayHub contract doesn't receive payments, the payment for the service (in tokens) is sent directly to the worker relaying the transaction on behalf of the user.
* RelayHub contract now handles relay manager staking.
* Paymaster verifications are done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.
* Big gas cost optimization.
* Security issues fixed.

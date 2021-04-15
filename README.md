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
| [Penalizer][1]       | 0x2aC0d7bCdEEa716c47041763D2ACb44544C1F072 |
| [RelayHub][2]        | 0xD8cf6b656cd510392a076821ecd722F80E06734F |
| [SmartWallet][3]     | 0xB945ef22A7C39Bce170CE2d3d4dcc0Ae12349241 |
| [SmartWalletFactory][4]    | 0xfF9b58102407FB077A3Fe632E5a9c94554C6dFf4 |
| [DeployVerifier][5] | 0x86cC4c29E00bE2ffdD3A2DBAeda247391d98585A |
| [RelayVerifier][6]  | 0x47f34837b4a96875011d8a375dcADfc9ea18Fa75 |

### For CustomSmartWallet support

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [CustomSmartWallet][7]     | 0xC3BE4ABE9C39941b0D647F78df611007bC99F410 |
| [CustomSmartWalletFactory][8]    | 0x3eA66409DE3Ed4664852a0Ef0570bf933a24f486 |
| [CustomSmartWalletDeployVerifier][9] | 0x5cC5ABA3a626fc100402e919aEC9829b29E4c8da |
| [CustomSmartWalletRelayVerifier][10] | 0x61551023521B964495fB19FA433eED9EFE8A913c |


### For Testing purposes

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [SampleRecipient][11]   | 0x2D319651D8Bf9A049e15232fE43196F94D3CB13B |

[1]: https://explorer.testnet.rsk.co/address/0x2ac0d7bcdeea716c47041763d2acb44544c1f072
[2]: https://explorer.testnet.rsk.co/address/0xd8cf6b656cd510392a076821ecd722f80e06734f
[3]: https://explorer.testnet.rsk.co/address/0xb945ef22a7c39bce170ce2d3d4dcc0ae12349241
[4]: https://explorer.testnet.rsk.co/address/0xff9b58102407fb077a3fe632e5a9c94554c6dff4
[5]: https://explorer.testnet.rsk.co/address/0x86cc4c29e00be2ffdd3a2dbaeda247391d98585a
[6]: https://explorer.testnet.rsk.co/address/0x47f34837b4a96875011d8a375dcadfc9ea18fa75
[7]: https://explorer.testnet.rsk.co/address/0xc3be4abe9c39941b0d647f78df611007bc99f410
[8]: https://explorer.testnet.rsk.co/address/0x3ea66409de3ed4664852a0ef0570bf933a24f486
[9]: https://explorer.testnet.rsk.co/address/0x5cc5aba3a626fc100402e919aec9829b29e4c8da
[10]: https://explorer.testnet.rsk.co/address/0x61551023521b964495fb19fa433eed9efe8a913c
[11]: https://explorer.testnet.rsk.co/address/0x2d319651d8bf9a049e15232fe43196f94d3cb13b

## Changelog

### V2

* RelayHub contract doesn't receive payments, the payment for the service (in tokens) is sent directly to the worker relaying the transaction on behalf of the user.
* RelayHub contract now handles relay manager staking.
* Paymaster verifications are done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.
* Big gas cost optimization.
* Security issues fixed.

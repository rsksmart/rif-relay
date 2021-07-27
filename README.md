# RIF Enveloping - V2

A secure transaction relay system to enable users to pay fees using ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/enveloping/tree/master)

## Description

RIF Enveloping takes its inspiration from the [Gas Station Network (GSN) project](https://github.com/opengsn/gsn). GSN is a decentralized system that improves dApp usability without sacrificing security. In a nutshell, GSN abstracts away gas (used to pay transaction fees) to minimize onboarding and UX friction for dApps. With GSN, "gasless clients" can interact with smart contracts paying for gas with tokens instead of native-currency.

RIF Enveloping V1 started as a fork of GSN with two goals in mind:

- Be compatible with existing and future smart contracts without requiring such contracts to be adapted to work with RIF Enveloping.
- Be as cost effective as possible.

RIF Enveloping V2 is a redesign of GSN, it reduces gas costs and simplifies the interaction between the different contracts that are part of the system. It achieves this by:

- Securely deploying counterfactual Smart Wallet proxies for each user account: this eliminates the need for relying on \_msgSender() and \_msgData() functions, making existing and future contracts compatible with RIF Enveloping without any modification.
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

| Contract           | Address                                    |
| ------------------ | ------------------------------------------ |
| Penalizer          | 0x5FdeE07Fa5Fed81bd82e3C067e322B44589362d9 |
| RelayHub           | 0xe90592939fE8bb6017A8a533264a5894B41aF7d5 |
| SmartWallet        | 0x27646c85F9Ad255989797DB0d99bC4a9DF2EdA68 |
| SmartWalletFactory | 0xEbb8AA43CA09fD39FC712eb57F47A9534F251996 |
| DeployVerifier     | 0x345799D90aF318fd2d8CbA87cAD4894feF2f3518 |
| RelayVerifier      | 0xDe988dB9a901C29A9f04050eB7ab08f71868a8fc |

### For CustomSmartWallet support

| Contract                        | Address                                    |
| ------------------------------- | ------------------------------------------ |
| CustomSmartWallet               | 0xB8dB52615B1a94a03C2251fD417cA4d945484530 |
| CustomSmartWalletFactory        | 0xA756bD95D8647be254de40B842297c945D8bB9a5 |
| CustomSmartWalletDeployVerifier | 0x3c26685CE3ac89F755D68A81175655b4bBE54AE0 |
| CustomSmartWalletRelayVerifier  | 0xBcCA9B8faA9cee911849bFF83B869d230f83f945 |

### For Testing purposes

| Contract        | Address                                    |
| --------------- | ------------------------------------------ |
| SampleRecipient | 0x4De3eB249409e8E40a99e3264a379BCfa10634F5 |
| TestToken       | 0x77740cE4d7897430E74D5E06540A9Eac2C2Dee70 |

## Changelog

### V2

- RelayHub contract doesn't receive payments, the payment for the service (in tokens) is sent directly to the worker relaying the transaction on behalf of the user.
- RelayHub contract now handles relay manager staking.
- Gas estimation improvements:
  - GasOverhead removed from RelayHub, there are no more validations against hardcoded values
  - Now the gas and tokenGas fields from the request can be left undefined, and in that case they will be automatically estimated by the RelayClient.
  - The maximum gas estimation in the RelayServer is more precise now
  - A new utility function is available to estimate the maximum gas a relay transaction would consume, based in a linear fit estimation. This can be used in applications that don't want to sign a payload each time they need an approximation of the cost of relaying the transaction
- Paymaster verifications are done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.
- Big gas cost optimization.
- Security issues fixed.

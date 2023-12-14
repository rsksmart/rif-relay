# RIF Relay

A secure transaction relay system to enable users to pay fees using ERC-20 tokens.

## Description

RIF Relay takes its inspiration from the [Gas Station Network (GSN) project](https://github.com/opengsn/gsn). GSN is a decentralized system that improves dApp usability without sacrificing security. In a nutshell, GSN abstracts away gas (used to pay transaction fees) to minimize onboarding and UX friction for dApps. With GSN, “gasless clients” can interact with smart contracts paying for gas with tokens instead of native-currency.

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokens (e.g. RIF tokens), and thereby remove the need to acquire RBTC in advance.

It is important to recall that - as a security measure - the version 1 contracts deployed on Mainnet have limits on the staked amounts to operate, these limits were removed in version 2.

## Modules

RIF Relay is built in modules, the entire system is made up by 3 modules.

1. [RIF Relay Contracts](https://github.com/rsksmart/rif-relay-contracts) contains all the contracts used by the RIF Relay System.
2. [RIF Relay Client](https://github.com/rsksmart/rif-relay-client) contains a library to interact with the relay server.
3. [RIF Relay Server](https://github.com/rsksmart/rif-relay-server) has all the relay server code. You can run the server directly from there.

Each module has instructions for development and usage.

## Getting Started: How to use the RIF Relay Sample dApp SDK

[Installation Requirement](https://dev.rootstock.io/guides/rif-relay/installation-requirements/)

### Running the Rootstock node

Running the Rootstock node is crucial for several reasons, some of which includes:
1. **Network Support**: You contribute to the network's security and decentralization.
2. **Smart Contract Interaction**: Essential for deploying and interacting with smart contracts on RSK.
3. **Privacy and Security**: Running your own node enhances privacy and security compared to using third-party services.
4. **Real-Time Data Access**: You get immediate access to blockchain data.
5. **Customization and Optimization**: Allows for tailored configurations for specific needs.
6. **Network Synchronization**: Ensures you have the latest blockchain data.
7. **Ecosystem Support**: Helps in the growth and development of the RSK ecosystem.
8. **Financial Rewards**: Possible incentives like transaction fees or block rewards.

This can be done either by using the [JAR package](https://dev.rootstock.io/rsk/node/install/operating-systems/java/) or the [docker](https://dev.rootstock.io/rsk/node/install/operating-systems/) container

### Add network to Metamask

In order to interact with the Rootstock network, we have to add it to Metamask. As we are using the node on ``--regtest mode``, we will add the Regtest Network. Follow the steps below or see tutorial on [How to add Metamask to Rootstock](https://dev.rootstock.io/develop/wallet/use/metamask/).

### Set up RIF Relay contracts and Server

Setting up RIF Relay contracts and server involves a multi-step process that includes deploying on-chain components, fulfilling installation requirements, and utilizing development tools. 

Follow this guide to [Setup RIF Relay Contract and Server](https://dev.rootstock.io/guides/rif-relay/deployment/)
- RIF Relay Server Repository: https://github.com/rsksmart/rif-relay-server
- RIF Relay Contracts Repository: https://github.com/rsksmart/rif-relay-contracts

### RIF Relay Sample dApp

This is a sample dApp to showcase how users can submit relayed transactions to the Rootstock blockchain using the [RIF Relay SDK](https://github.com/infuy/relaying-services-sdk). You will need to connect to the dApp with MetaMask but only for signing transactions with the account that owns the Smart Wallets. Follow this guide for [RIF Relay Sample dApp](https://github.com/rsksmart/rif-relay-sample-dapp)


## Testing

This repository contains all the integration tests. These tests verify the behavior of the entire system.
You have two ways to run tests:

1. Executing `npm test` will run all the test suite and verify all the system. This could take 
   a few hours since executing the entire test suite is a heavy task.
2. Running `npm run testOnly <TEST_FILE>` where `<TEST_FILE>` it’s the typescript file
that contains the test code inside will execute only that test and make the verifications inside it. An example could be `npm run testOnly ./test/relayserver/RelayServer.test.ts`.

**Important Note**: when you run the tests you will see folders like `contracts`, `migrations` and some other files
appearing during the tests and disappearing after, that’s because we need to have the contracts
on the same context as this repository during tests, this is a normal behavior. 

## Scripts

This repository contains a script that analyzes gas consumption for relay and deploy transactions. It prints different metrics related to gas usage when relaying a transaction or deploying a smart wallet.
To run it, execute the command:

`npm run analyze:gas <NETWORK_NAME>`

where:
- `<NETWORK_NAME>` is a required parameter for the network name, taken from the `hardhat.config.ts`, and must correspond to a valid RSK Node (commonly, regtest is used). Do not use this with the default network (hardhat) as it will fail.

Example: 
`npm run analyze:gas regtest`

[Deprecated Doc](docs/README.md)

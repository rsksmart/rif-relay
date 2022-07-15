# Rif Relay

A secure transaction relay system to enable users to pay fees using ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/rif-relay/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/rif-relay/tree/master)

## Description

RIF Enveloping takes its inspiration from the [Gas Station Network (GSN) project](https://github.com/opengsn/gsn). GSN is a decentralized system that improves dApp usability without sacrificing security. In a nutshell, GSN abstracts away gas (used to pay transaction fees) to minimize onboarding and UX friction for dApps. With GSN, “gasless clients” can interact with smart contracts paying for gas with tokens instead of native-currency.

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokens (e.g. RIF tokens), and thereby remove the need to acquire RBTC in advance.

It is important to recall that - as a security measure - the version 1 contracts deployed on Mainnet have limits on the staked amounts to operate, these limits were removed in version 2.

## Modules

Rif Relay is built in modules, the entire system is made up by 4 modules.

1. [Rif Relay Contracts](https://github.com/anarancio/rif-relay-contracts) contains all the contracts used by the Rif Relay System.
2. [Rif Relay Common](https://github.com/infuy/rif-relay-common) it’s a library that contains all the common code used by other modules.
3. [Rif Relay Client](https://github.com/infuy/rif-relay-client) contains a library to interact with the relay server.
4. [Rif Relay Server](https://github.com/infuy/rif-relay-server) has all the relay server code, you can use it as a library or run the server directly from there.

Each module has instructions for development and usage.

## Testing

This repository contains all the integration tests. These tests verify the behaviour of the entire system.
You have two ways to run tests:

1. Executing `npm test` will run all the test suite and verify all the system. This could take 
   a few hours since executing the entire test suite is a heavy task.
2. Running `npm run testOnly <TEST_FILE>` where `<TEST_FILE>` it’s the typescript file
that contains the test code inside will execute only that test and make the verifications inside it. An example could be `npm run testOnly ./test/relayserver/RelayServer.test.ts`.

**Important Note**: when you run the tests you will see folders like `contracts`, `migrations` and some other files
appearing during the tests and disappearing after, that’s because we need to have the contracts
on the same context as this repository during tests, this is a normal behaviour. 

[Deprecated Doc](docs/README.md)

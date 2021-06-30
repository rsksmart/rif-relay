# RIF Enveloping - V2

A secure transaction relay system to enable users to pay fees using ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/enveloping/tree/master)


## Table of contents

- [Description](#Description)
- [Requirements](#Requirements)
- [Launching](#Launching)
- [Testnet Contracts](#Testnet-Contracts-V2)
- [Troubleshooting](#Troubleshooting)
- [Changelog](#Changelog)

## Additional Technical Documentation

The following technical content is available:

- [Architecture](docs/enveloping_architecture.md)
- [Launching RIF Enveloping](docs/launching_enveloping.md)
- [Development guide](docs/development_guide.md)
- [Integration guide](docs/integration_guide.md)
- [Gas costs](docs/overhead_tx_costs.md)

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

## Requirements

### RSK Node

You need to have a running RSK node version [PAPYRUS-2.2.0](https://github.com/rsksmart/rskj/releases) or higher.

### Yarn

We use `yarn` version `v1.22.0` for package management. 

Installation instructions at Yarn's [site](https://yarnpkg.com/getting-started/install). Check the install by running `yarn version`.

### Node & NPM

We use `Node` version `v12.18.3`.

Installation instructions at Node's [site](https://nodejs.org/en/). Check the install by running `node -v`.

### Npx & Truffle

An important tool we use for interacting with the blockchain is `Truffle` version `v5.0.33`.

You can follow the installation guide in the official [site](https://www.trufflesuite.com/truffle).

We run all truffle commands with the prefix `npx`. This is to execute node packages using the project's version.

Checking the install by running `npx truffle version`.

The configuration file is `truffle.js`. Please see Truffle's documentation for details about this file and how to use it.

### Docker

We recommend following the official [documentation](https://docs.docker.com/get-docker/) for installing Docker and keeping it updated.

You'll need to install both `docker` as well as `docker-compose`.

#### Running on macOS
To run the project using Docker on a Mac, please follow these steps or the scripts and web apps will not work. 

- Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So we must patch `readlink`. This can be done using [Homebrew](https://brew.sh/) as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this step, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can check this with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.

## Installation

### Building the project

Clone the project. Then run the following from the project's root directory to build it.

`yarn install`
`yarn prepare`

### Deploy contracts Locally

We'll use `truffle` for deploying contracts. Have an RSK node up and running in regtest mode and then execute the following on the project's root folder:

`npx truffle migrate --network rsk`


After running this command you will see a summary of contracts on the 
terminal something similar to this:

```
|===================================|============================================|
| Contract                          | Address                                    |
|===================================|============================================|
| Penalizer                         | 0xe8C7C6f18c3B9532343487faD807060750C1fE95 |
| RelayHub                          | 0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701 |
| SampleRecipient                   | 0x5D0aBdE7Ed6B7e122eD55EAe514E617d6c08f407 |
| SmartWallet                       | 0xB7a001eE69E7C1eef25Eb8e628e46214Ea74BF0F |
| SmartWalletFactory                | 0x8C1108cFCd7ddad09D8910e5f42982A6c54aD9cD |
| SmartWalletDeployVerifier         | 0x1938517B0762103d52590Ca21d459968c25c9E67 |
| SmartWalletRelayVerifier          | 0x74Dc4471FA8C8fBE09c7a0C400a0852b0A9d04b2 |
| CustomSmartWallet                 | 0x96A90Ee24C20c78Ba20AcE1a2aa4D59F79353C54 |
| CustomSmartWalletFactory          | 0x89bac3BB0517F7Dc0E5E94265217A9Acc5cc489f |
| CustomSmartWalletDeployVerifier   | 0x3eE31F6049065B616f85470985c0eF067f2bEbDE |
| CustomSmartWalletRelayVerifier    | 0xDE8Ae20488BE104f0782C0126038b6682ECc1eC7 |
|===================================|============================================|
```

You'll need to save this summary for later use.


### Deploy contracts On Testnet


We'll use `truffle` for deploying contracts.

`npx truffle migrate --network rsktestnet` (disclaimer: to use testnet, you should have an unlocked account with funds or configure it in `truffle.js`).

These contracts have been deployed on Testnet. See [here](#testnet-contracts) for their addresses.

## Launching

### Run the Relay Server
Now you need to start the relay server, to do so you need to configure the json config file located at `<PROJECT_ROOT>/jsrelay/config/relay-config.json` which has this structure:
   
```
{
  "url": "localhost",
  "port": 8090,
  "relayHubAddress": "0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701",
  "relayVerifierAddress": "0x74Dc4471FA8C8fBE09c7a0C400a0852b0A9d04b2",
  "deployVerifierAddress": "0x1938517B0762103d52590Ca21d459968c25c9E67",
  "gasPriceFactor": 1,
  "rskNodeUrl": "http://rsk-node:4444",
  "devMode": true,
  "customReplenish": false,
  "logLevel": 1,
  "workdir": "/home/user/workspace"
}
```

Where:

* **url**: is the URL where the relay server will be deployed, it could be localhost or the IP of the host machine.
* **port**: the port where the relay server will be hosted.
* **relayHubAddress**: is the relay hub contract address, you can retrieve this from the contract summary.
* **relayVerifierAddress**: is the relay verifier contract address, you can retrieve this from the contract summary.
* **deployVerifierAddress**: is the deploy verifier contract address, you can retrieve this from the contract summary.
* **gasPriceFactor**: is the gas price factor used to calculate the gas on the server, you can leave it as 1.
* **rskNodeUrl**: is the RSK node endpoint URL, where the RSK node is located.
* **devMode**: it indicates to the server if we are in development mode or not.
* **customReplenish**: set if the server uses a custom replenish function or not.
* **logLevel**: is the log level for the relay server.
* **workdir**: is the absolute path to the folder where the server will store the database and all its data.

3. Now we can use the command `yarn relay` (on the root of the relay project) to start the relay server.
If it's the first time you run the relay server, you will see a log saying that it isn't ready and that some values are wrong, that's ok, you just need to register this relay server into the relay hub in order to be usable by the clients.

## Allow tokens

Now the final step is to allow some tokens to be used by enveloping on the smart wallets.

### On Regtest

On regtest you can use a script located at `<PROJECT_ROOT>/scripts/allowTokens` this script needs to be configured, it looks
   something like this:
   
```
#!/bin/bash

TOKEN_ADDRESSES="0x0E569743F573323F430B6E14E5676EB0cCAd03D9,0x1Af2844A588759D0DE58abD568ADD96BB8B3B6D8"
SMART_WALLET_DEPLOY_VERIFIER_ADDRESS="0x1938517B0762103d52590Ca21d459968c25c9E67"
SMART_WALLET_RELAY_VERIFIER_ADDRESS="0x74Dc4471FA8C8fBE09c7a0C400a0852b0A9d04b2"
CUSTOM_SMART_WALLET_DEPLOY_VERIFIER_ADDRESS="0x3eE31F6049065B616f85470985c0eF067f2bEbDE"
CUSTOM_SMART_WALLET_RELAY_VERIFIER_ADDRESS="0xDE8Ae20488BE104f0782C0126038b6682ECc1eC7"
NETWORK=33
RSK_HOST="rsk-node"
RSK_PORT=4444

TRUFFLE_CONFIG="module.exports = {  networks: { development: { host: '${RSK_HOST}', port: ${RSK_PORT}, network_id: '${NETWORK}' } } };"

echo "${TRUFFLE_CONFIG}" > truffle-config.js
...
```

Where:

* **TOKEN_ADDRESSES**: it's a comma separated list of token addresses to be allowed.
* **SMART_WALLET_DEPLOY_VERIFIER_ADDRESS**: is the smart wallet deploy verifier contract address, you can retrieve this from the contract summary.
* **SMART_WALLET_RELAY_VERIFIER_ADDRESS**: is the smart wallet relay verifier contract address, you can retrieve this from the contract summary.
* **CUSTOM_SMART_WALLET_DEPLOY_VERIFIER_ADDRESS**: is the custom smart wallet deploy verifier contract address, you can retrieve this from the contract summary.
* **CUSTOM_SMART_WALLET_RELAY_VERIFIER_ADDRESS**: is the custom smart wallet relay verifier contract address, you can retrieve this from the contract summary.
* **NETWORK**: the network id that for regtest is 33 so can leave it as it is.
* **RSK_HOST**: the RSK node endpoint host.
* **RSK_PORT**: the RSK node endpoint port.

After configuring that script you need to run it and wait until it finishes.

**Important Note**: the script to allow tokens assumes you are in regtest and uses the account[0] as the owner of the contracts and that's important because
only the owner can allow tokens on the contracts.

### On Testnet

There is no script for this situation, so you will need to call the method `acceptsToken(address token)` directly in the following contracts, using an account with tRBTC:

- `SmartWalletDeployVerifier`
- `SmartWalletRelayVerifier`
- `CustomSmartWalletDeployVerifier`
- `CustomSmartWalletRelayVerifier`


## Register the Relay Server

### On Regtest

Once the relay server is up, you need to register this server in order for it to be usable, to do so, first configure the script located on `<PROJECT_ROOT>/scripts/registerRelayServer` and replace the 
   values as you consider. The script contains the following:

```
node dist/src/cli/commands/enveloping.js relayer-register --funds 100 --stake 200 --network http://rsk-node:4444/ --hub "0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701"
```

Where:

* **--funds**: indicates the amount of RBTC that you will transfer from accounts[0] to the worker manager account.
* **--stake**: how much RBTC the server will stake. twice the value of funds is an acceptable value.
* **--hub**: is the relay hub contract address, you can retrieve this from the contract summary.
* **--network**: is the url of the rsk node API.

After doing that you need to open another terminal and run the `yarn registerRelay` command on the root of the relay project in order to register the relay. 

After running this command you will be seeing several log entries indicating how everything is turning out. After a little while, look for this entry in the relay server execution terminal to make sure that the server is ready:

```
Relayer state: READY
```

### On Testnet

1.  In another terminal run `curl http://localhost:8090/getaddr`, which will return a JSON with information of the running jsRelay Server, for example:
```json
{"relayWorkerAddress":"0xe722143177fe9c7c58057dc3d98d87f6c414dc95","relayManagerAddress":"0xe0820002dfaa69cbf8add6a738171e8eb0a5ee54",
"relayHubAddress":"0x38bebd507aBC3D76B10d61f5C95668e1240D087F", "minGasPrice":"6000000000", "chainId":"31", "networkId":"31","ready":false,"version":"2.0.1"}
```
2. Send to relayManagerAddress at least 0.001 tRBTC to set it up
3. Send to relayWorkerAddress at least 0.001 tRBTC to set it up
4. Once both addresses have been funded, run `node dist/src/cli/commands/enveloping.js relayer-register --network <RSKJ_NODE_URL> --hub <RELAY_HUB_CONTRACT_ADDRESS> -m <secret_mnemonic> --from <ADDRESS>  --funds <FUNDS> --stake <STAKE> --relayUrl <RELAY_URL>` where `<secret_mnemonic>` contains the path to a file with the mnemonic of a funded account to use during the relay server registration, `<ADDRESS>` is the account address associated to that mnemonic.

## Testnet Contracts V2

### Primary contracts

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| Penalizer       | 0x5FdeE07Fa5Fed81bd82e3C067e322B44589362d9 |
| RelayHub        | 0xe90592939fE8bb6017A8a533264a5894B41aF7d5 |
| SmartWallet     | 0x27646c85F9Ad255989797DB0d99bC4a9DF2EdA68 |
| SmartWalletFactory    | 0xEbb8AA43CA09fD39FC712eb57F47A9534F251996 |
| DeployVerifier | 0x345799D90aF318fd2d8CbA87cAD4894feF2f3518 |
| RelayVerifier  | 0xDe988dB9a901C29A9f04050eB7ab08f71868a8fc |

### For CustomSmartWallet support

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| CustomSmartWallet     | 0xB8dB52615B1a94a03C2251fD417cA4d945484530 |
| CustomSmartWalletFactory    | 0xA756bD95D8647be254de40B842297c945D8bB9a5 |
| CustomSmartWalletDeployVerifier |  0x3c26685CE3ac89F755D68A81175655b4bBE54AE0 |
| CustomSmartWalletRelayVerifier | 0xBcCA9B8faA9cee911849bFF83B869d230f83f945 |


### For Testing purposes

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| SampleRecipient   | 0x4De3eB249409e8E40a99e3264a379BCfa10634F5 |
| TestToken   | 0x77740cE4d7897430E74D5E06540A9Eac2C2Dee70 |

## Changelog

### V2

* RelayHub contract doesn't receive payments, the payment for the service (in tokens) is sent directly to the worker relaying the transaction on behalf of the user.
* RelayHub contract now handles relay manager staking.
* Gas estimation improvements:
    * GasOverhead removed from RelayHub, there are no more validations against hardcoded values
    * Now the gas and tokenGas fields from the request can be left undefined, and in that case they will be automatically estimated by the RelayClient.
    * The maximum gas estimation in the RelayServer is more precise now
    * A new utility function is available to estimate the maximum gas a relay transaction would consume, based in a linear fit estimation. This can be used in applications that don't want to sign a payload each time they need an approximation of the cost of relaying the transaction
* Paymaster verifications are done off-chain to optimize gas costs, thus the paymasters are now called Verifiers and they are not part of the on-chain relay flow nor they handle payments at all.
* Big gas cost optimization.
* Security issues fixed.

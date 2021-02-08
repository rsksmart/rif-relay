# RIF Enveloping

Secure sponsored transaction system to enable users to pay fees using ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/enveloping/tree/master)

## Table of Contents

1. [Description](#c01)
2. [Technical Overview](#c02)<br>
  2.1 [Testnet Contracts](#c02.1)<br>
3. [Building project](#c03)<br>
  3.1 [Deploy](#c03.1)<br>
  3.2 [Test](#c03.2)<br>
  3.3 [Create a Smart Wallet](#c03.3)<br>
4. [Run a Relay Server](#c04)<br>
  4.1 [Regtest](#c04.1)<br>
  4.2 [Testnet](#c04.2)
5. [Use MetaCoin](#c05)
6. [Documentation](#c06)
7. [Troubleshooting](#c07)<br>
  7.1 [Running on macOS](#c07.1)<br>
  7.2 [Common errors when testing](#c07.2)

## 1. Description <a id="c01"></a>

The following information discribes the version 1 of RIF Enveloping. This version is based on the Gas Station Network (GSN) project (https://github.com/opengsn/gsn). In a nutshell, GSN abstracts away gas to minimize onboarding & UX friction for dapps. With GSN, gasless clients can interact with Ethereum contracts without users needing ETH for transaction fees. The GSN is a decentralized system that improves dapp usability without sacrificing security. 

RIF Enveloping expands the GSN capabilities and security model while reducing gas costs by:

- Securely deploying counterfactual SmartWallet proxies for each user account: this eliminates the need for relying on _msgSender() and _msgData() functions.
- Elimination of interaction with Uniswap: relay providers accumulate tokens on a paymaster under their control to later on decide what to do with funds.
- Reducing gas costs by optimizing the existing GSN architecture.

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokes, removing the need get RBTC.

The RIF Enveloping team is working on a new architecture to further reduce gas costs while simplifying the entire design of the solution. This changes will be part of the upcoming version 2.

It is important to mention that in version 1 the contracts deployed on Mainnet have as security measure **kill()**, **pause()** and **unpause()** functions and limits to the amount of RBTC that can be staked. These functions and limits will be removed in the upcoming version 2.

## 2. Technical Overview <a id="c02"></a>

The system is designed to achieve deployments and transaction sponsorship at low cost. The cost of the relay service provided by "sponsors" is agreed among the parties off-chain. The low cost of transactions on RSK contributes to keeping overall service costs low as well.

The core Enveloping architecture is defined by the following components:

- **Relay Request** - a structure that wraps the transaction sent by an end-user including the required data for the relay (e.g. address of the payer, address of the original requester, token payment data).
- **Relay Hub** - a core contract on the blockchain which serves as the interface for the on-chain system. It manages the balances of the accounts involved and forwards Relay Requests to the rest of the contracts. 
- **Verifier** - an abstract contract that authorizes a specific relay request.
- **Smart Wallet** - a contract that verifies forwarded data and invokes the receipient contract of the transaction. The smart wallet is created *counterfactually* at the moment it is needed. This happens, for instance, when a user with some token balances wants to move those tokens without spending gas, i.e. using the enveloping system.
- **Relay Server** - a relay service daemon, running as a  HTTP service.  Advertises itself (through the RelayHub) and waits for client requests.
- **Relay Client** - a typescript library for a client to access the blockchain through a relay. Provides APIs to find a good relay, and to send transactions through it. The library hooks the local web3, so that any loade. Id contract API will go through the relay.

### 2.1 Testnet Contracts <a id="c02.1"></a>

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [StakeManager]    | 0x4aD91a4315b3C060F60B69Fd0d1eBaf16c14148D |
| [Penalizer]       | 0xd3021763366708d5FD07bD3A7Cd04F94Fc5e1726 |
| [RelayHub]        | 0x3f8e67A0aCc07ff2F4f46dcF173C652765a9CA6C |
| [TestRecipient]   | 0xFBE5bF13F7533F00dF301e752b41c96965c10Bfa |
| [SmartWallet]     | 0xE7552f1FF31670aa36b08c17e3F1F582Af6302d1 |
| [ProxyFactory]    | 0xb7a5370F126d51138d60e20E3F332c81f1507Ce2 |
| [DeployVerifier] | 0x3AD4EDEc75570c3B03620f84d37EF7F9021665bC |
| [RelayVerifier]  | 0x053b4a77e9d5895920cBF505eB8108F99d929395 |

[StakeManager]:(https://explorer.testnet.rsk.co/address/0x4aD91a4315b3C060F60B69Fd0d1eBaf16c14148D)
[Penalizer]:(https://explorer.testnet.rsk.co/address/0xd3021763366708d5FD07bD3A7Cd04F94Fc5e1726)
[RelayHub]:(https://explorer.testnet.rsk.co/address/0x3f8e67A0aCc07ff2F4f46dcF173C652765a9CA6C)
[TestRecipient]:(https://explorer.testnet.rsk.co/address/0xFBE5bF13F7533F00dF301e752b41c96965c10Bfa)
[SmartWallet]:(https://explorer.testnet.rsk.co/address/0xE7552f1FF31670aa36b08c17e3F1F582Af6302d1)
[ProxyFactory]:(https://explorer.testnet.rsk.co/address/0xb7a5370F126d51138d60e20E3F332c81f1507Ce2)
[DeployVerifier]:(https://explorer.testnet.rsk.co/address/0x3AD4EDEc75570c3B03620f84d37EF7F9021665bC)
[RelayVerifier]:(https://explorer.testnet.rsk.co/address/0x053b4a77e9d5895920cBF505eB8108F99d929395)

## 3. Building project <a id="c03"></a>

Clone the project. Then run the following from the project's root directory
-  `yarn install && yarn prepare` (for instruction to install yarn [here](https://classic.yarnpkg.com/en/))
- Move [here](rsknode/README.md) (optional: it runs an RSK client)

### 3.1. Deploy <a id="c03.1"></a>

We can deploy the project with
- `npx truffle --network rsk migrate` (Make sure `truffle.js` is correctly configured)
- `yarn run dev`

### 3.2. Test <a id="c03.2"></a>

- To run all the tests:

`./run-tests`

Note: It takes time, the script will run an RSK node in regtest, and then run all the tests.

- To run an specific test:

Once the project is built, we can test it with truffle
`yarn generate && npx truffle test --network rsk test/Flows.test.ts` (with [truffle](https://www.trufflesuite.com/))

### 3.3 Create a Smart Wallet <a id="c03.3"></a>

As mentioned before, the moment we need to use the Enveloping system, we have to deploy a Smart Wallet (SW). 

1. **Use your address to deploy a Smart Wallet (SW)**
```typescript
      const trxData: GsnTransactionDetails = {
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

## 4. Run a Relay Server <a id="c04"></a>

### 4.1. Regtest <a id="c04.1"></a>

In order to run an Enveloping instance in Regtest, clone the project then run the following from the project's root directory:

1. `yarn install && yarn prepare`
2. On the jsrelay directory `npx webpack`
3. On the project's root directory, run `docker-compose build` (Optional)
4. Run `docker-compose up -d rskj` (Optional: it runs an RSK node in regtest)
5. Run '`node dist/src/cli/commands/gsn.js boot-test -n rsk-regtest`

For checking if it's working, run `curl http://localhost:8090/getaddr` (The port 8090 should be changed by the relay's port).

### 4.2. Testnet <a id="c04.2"></a>

In order to run an Enveloping instance in Testnet, clone the project then run the following from the project's root directory:

1. Create the project home folder, in this folder the jsrelay databases will be placed: mkdir enveloping_relay
2. In a terminal run `node dist/src/cli/commands/gsn.js relayer-run  --rskNodeUrl "http://localhost:4444" --relayHubAddress=<RELAY_HUB_CONTRACT_ADDRESS> --url <RELAY_URL> --port 8090 --workdir enveloping_relay --checkInterval 30000` where `<RELAY_HUB_CONTRACT_ADDRESS>` is the address for the relayHub you are using in the current network [(see Testnet Contracts section)](#c02.1), `<RELAY_URL>` in most cases will be `http://localhost`, and the server will be reachable in `<RELAY_URL>:port` unless `<RELAY_URL>` already defines a port (e.g, if `<RELAY_URL>` is `http://localhost:8091/jsrelay`)
3. In another terminal run `curl http://localhost:8090/getaddr` which will return a JSON with information of the running jsRelay Server, for example:
```json
{"relayWorkerAddress":"0xe722143177fe9c7c58057dc3d98d87f6c414dc95","relayManagerAddress":"0xe0820002dfaa69cbf8add6a738171e8eb0a5ee54",
"relayHubAddress":"0x38bebd507aBC3D76B10d61f5C95668e1240D087F", "minGasPrice":"6000000000",
"maxAcceptanceBudget":"200000","chainId":"31", "networkId":"31","ready":false,"version":"2.0.1"}
```
4. Send to relayManagerAddress at least 0.1 tRBTC to set it up
5. Send to relayWorkerAddress at least 0.1 tRBTC to set it up
6. Once both addresses have been funded, run `node dist/src/cli/commands/gsn.js relayer-register --network <RSKJ_NODE_URL> --hub <RELAY_HUB_CONTRACT_ADDRESS> -m secret_mnemonic --from <ADDRESS>  --funds 1e17 --stake 3e17 --relayUrl <RELAY_URL>` where `secret_mnemonic` contains the path to a file with the mnemonic of the account to use during the relay server registration, `<ADDRESS>` is the account address associated to that mnemonic
7.  Wait until the relay server prints a message saying `RELAY: READY`.

## 5. Use MetaCoin <a id="c05"></a>

Mint and send tokens without requiring RBTC for gas. Works on Regtest. 

Try it: https://github.com/rsksmart/enveloping-metacoin

## 6. Documentation <a id="c06"></a>

For more detailed documentation, go [here](https://docs.google.com/document/d/1kan8xUFYgjWNozBfpkopn35P9E6IuRjC-PNhwcrQLN4/edit)

## 7. Troubleshooting <a id="c07"></a>

### 7.1. Running on macOS <a id="c07.1"></a>
To run the project using Docker on a Mac, you must follow these steps or the scripts and web apps won't work.

- Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So you must patch `readlink`. This can be done as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this step, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can do it with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.

### 7.2. Common errors when testing <a id="c07.2"></a>

#### Running a test throws the Error: Cannot find module 'directory-to-the-project/enveloping/rsknode/test/Flows.test.ts'

Ensure that you are in the project's root directory and that the test's name has no typos

#### Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

Stop the running node and delete the db used by the node.

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`

## 7. Gas Station Network <a id="c07"></a>

This project is based on GSN and expands its capabilities and security model while reducing gas costs. It does this by:
- Securely deploying counterfactual SmartWallet proxies for each user account: this eliminates the need for relying on _msgSender() and _msgData() functions.
- Elimination of interaction with Uniswap: relay providers accumulate tokens on a Verifier under their control to later on decide what to do with funds.

Code here is based on [Gas Stations Network](https://github.com/opengsn/gsn) (GSN). In a nutshell, GSN abstracts away gas to minimize onboarding & UX friction for dapps. With GSN, gasless clients can interact with Ethereum contracts without users needing ETH for transaction fees. The GSN is a decentralized system that improves dapp usability without sacrificing security. 

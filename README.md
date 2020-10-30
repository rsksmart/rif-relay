# RSK Enveloping

System for users to pay for transactions in ERC-20 tokens.

[![Build Status](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=svg)](https://circleci.com/gh/rsksmart/enveloping/tree/master)

## Table of Contents

1. [Description](#c01)
2. [Technical Overview](#c02)<br>
  2.1 [Testnet Contracts](#c02.1)<br>
3. [Building project](#c03)<br>
  3.1 [Testing](#c03.1)<br>
  3.2 [Use Enveloping](#c03.2)<br>
  3.3 [Create a Smart Wallet](#c03.3)
4. [Use MetaCoin](#c04)
5. [Documentation](#c05)
6. [Troubleshooting](#c06)<br>
  6.1 [Running on macOS](#c06.1)<br>
  6.2 [Common errors when testing](#c06.2)
7. [Gas Station Network](#c07)

## 1. Description <a id="c01"></a>


The main objective of the Enveloping System is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to transact without RBTC. The system allows RSK users to pay transaction fees (gas) with tokens instead of RBTC, while maintaining their accounts as  transaction senders. This is enabled by service providers who use their accounts to pay gas costs for transactions sent by "gas-less" users.

## 2. Technical Overview <a id="c02"></a>

The system is designed to achieve deployments at low cost. The cost of the relay provided by "sponsors" is agreed among the parties off-chain. The low cost of transactions on RSK contributes to keeping overall service costs low as well.

The core enveloping architecture is defined by the following components:

- **Relay Request** - a structure that wraps the transaction sent by an end-user including the required data for the relay (e.g. address of the payer, address of the original requester, token payment data).
- **Relay Hub** - a core contract on the blockchain which serves as the interface for the on-chain system. It manages the balances of the accounts involved and forwards Relay Requests to the rest of the contracts. 
- **Paymaster** - an abstract contract that authorizes a specific relay request.
- **Smart Wallet** - a contract that verifies forwarded data and invokes the receipient contract of the transaction. The smart wallet is created *counterfactually* at the moment it is needed. This happens, for instance, when a user with some token balances wants to move those tokens without spending gas, i.e. using the enveloping system.
- **Relay Server** - a relay service daemon, running as a  HTTP service.  Advertises itself (through the RelayHub) and waits for client requests.
- **Relay Client** - a typescript library for a client to access the blockchain through a relay. Provides APIs to find a good relay, and to send transactions through it. The library hooks the local web3, so that any loade. Id contract API will go through the relay.

## 2.1 Testnet Contracts <a id="c02.1"></a>

Pending..

## 3. Building project <a id="c03"></a>

Clone the project. Then run the following from the project's root directory
-  `yarn install` (for instruction to install yarn [here](https://classic.yarnpkg.com/en/))
- `./rsknode/rskj.sh` (local) or `./rsknode/run.sh` (with [docker](https://www.docker.com/) )

### 3.1. Test <a id="c03.1"></a>

Once the project is built, we can test it with truffle
- `yarn generate && npx truffle test --network rsk test/Flows.test.ts` (with [truffle](https://www.trufflesuite.com/))

### 3.2. Deploy <a id="c03.2"></a>

We can deploy the project with
- `npx truffle --network rsk migrate`
- `yarn run dev`

### 3.3 Create a Smart Wallet <a id="c03.3"></a>

As mentioned before, the moment we need to use the Enveloping system, we have to deploy a Smart Wallet.

Pending..



## 4. Use MetaCoin <a id="c04"></a>

Mint and send tokens without requiring RBTC for gas. Works on Regtest. 

Try it: https://github.com/rsksmart/enveloping-metacoin

## 5. Documentation <a id="c05"></a>

For more detailed documentation, go [here](https://drive.google.com/file/d/1SVzgazN_FmKWlYiQ9_J98LKBB5ul_aa5/view?usp=sharing)

## 6. Troubleshooting <a id="c06"></a>

### 6.1 Running on macOS <a id="c06.1"></a>
To run the project using Docker on a Mac, you must follow these steps or the scripts and web apps won't work.

- Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So you must patch `readlink`. This can be done as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this step, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can do it with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.


### 6.2 Common errors when testing

#### Running a test throws the Error: Cannot find module 'directory-to-the-project/enveloping/rsknode/test/Flows.test.ts'

Ensure that you are in the project's root directory and that the test's name has no typos


#### Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

Stop the running node and delete the db used by the node.

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`

#### Changes to the RSKJ node or changes in the `run.sh` script

If you are using Docker, you should delete the old image using `docker image rm rsknode`

Then delete the directory `rsknode/home/` and finally run `rsknode/run.sh` again (before this step you must download all the new changes).


## 7. Gas Station Network <a id="c07"></a>

This project is based on GSN and expands its capabilities and security model while reducing gas costs. It does this by:
- Securely deploying counterfactual SmartWallet proxies for each user account: this eliminates the need for relying on _msgSender() and _msgData() functions.
- Elimination of interaction with Uniswap: relay providers accumulate tokens on a paymaster under their control to later on decide what to do with funds.

Code here is based on [Gas Stations Network](https://github.com/opengsn/gsn) (GSN). In a nutshell, GSN abstracts away gas to minimize onboarding & UX friction for dapps. With GSN, gasless clients can interact with Ethereum contracts without users needing ETH for transaction fees. The GSN is a decentralized system that improves dapp usability without sacrificing security. 
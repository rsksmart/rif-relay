# RSK Enveloping

System for users to pay for transactions in ERC-20 tokens.

[![Build Status][ci-badge]][ci-url]


## Table of Contents

1. [Description](#c01)
2. [Technical Overview](#c02)
3. [Building project](#c03)<br>
  3.1 [Testing](#c03.1)<br>
  3.2 [Use Enveloping](#c03.2)<br>
  3.3 [Create a Smart Wallet](#c03.3)
4. [Use MetaCoin](#c04)
5. [Documentation](#c05)
6. [Troubleshooting](#c06)<br>
  6.1 [Running on MacOS](#c06.1)<br>
  6.2 [Common errors when testing](#c06.2)
7. [Gas Station Network](#c07)

## 1. Description <a id="c01"></a>


The main objective is to provide to the RSK ecosystem means to allow blockchain applications and end-users (wallet-apps) to transact without needing RBTC. The system should allow RSK users to pay transaction fees with tokens other than RBTC, while maintaining their accounts as  transaction senders. For this, there are accounts that pay for the transactions sent by gas-less users.  

## 2. Technical Overview <a id="c02"></a>

Enveloping system was designed to achieve a cheap cost for deployment. The costs of the service of Enveloping provided by "sponsors" is agreed between parties. In addition with the low cost of transaction in RSK, it results in a cost-effective design.

Enveloping core architecture is defined by the following components:

- **Relay Request** - a structure that wraps the transaction sent by an end-user including the required data for the relay (e.g. address of the payer, address of the original requester, token payment data).
- **Relay Hub** - core contract on the blockchain. It's the interface of the on-chain system, manages the balances of the accounts involved and forwards the Relay Request to the rest of the contracts. 
- **Paymaster** - abstract contract that authorizes a specific relay request.
- **Smart Wallet** - a contract that verifies the forwarded data and invokes the receipient contract of the transaction. The smart wallet is created counterfactual, in other words, a user receives tokens in a wallet. At the moment the user wants to move the tokens, can decide to not spend gas and for that, creates a Smart Wallet.
- **Relay Server** - a relay service daemon, running as a  HTTP service.  Advertises itself (through the RelayHub) and waits for client requests.
- **Relay Client** - a typescript library for a client to access the blockchain through a relay. Provides APIs to find a good relay, and to send transactions through it. The library hooks the local web3, so that any loade. Id contract API will go through the relay.

For a full techincal description, see [Tabookey's EIP draft](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1613.md) and [Open GSN documentation](https://docs.opengsn.org/learn/index.html).

## 3. Building project <a id="c03"></a>

In order to build the project:

- Download Enveloping project and stand in the root directory.
-  `yarn install` (for instruction to install yarn see [here](https://classic.yarnpkg.com/en/))
- `./rsknode/rskj.sh` (local) or `./rsknode/run.sh` (with [docker](https://www.docker.com/) )

### 3.1. Testing <a id="c03.1"></a>

With the project built:

- `yarn generate && npx truffle test --network rsk test/Flows.test.ts` (with [truffle](https://www.trufflesuite.com/))

### 3.2. Use Enveloping <a id="c03.2"></a>

With the project built
- `npx truffle --network rsk migrate`
- `yarn run dev`

### 3.3 Create a Smart Wallet <a id="c03.3"></a>

As was mentioned before, at the moment the user needs to use the Enveloping system, requires to deploy Smart Wallet.


## 4. Use MetaCoin <a id="c04"></a>

Mint and send tokens without requiring RBTC for gas. Works on Regtest. 

Try it: 

## 5. Documentation <a id="c05"></a>

For more detail documentation, go [here](documentation)

## 6. Troubleshooting <a id="c06"></a>

### 6.1 Running on MacOS <a id="c06.1"></a>
If you intend to execute using Docker on a Mac, you must follow these steps or the scripts and web apps won't work.

- Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So you must patch `readlink`. You can do it as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can do it with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.


### 6.2 Common errors when testing

#### Running a test, it throws the Error: Cannot find module 'directory-to-the-project/enveloping/rsknode/test/Flows.test.ts'

You should check you're standing in the project's root directory and the test's name is well written without typos

#### Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

You should stop the running node and delete the db used by the node. Run it again and test.

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

This is the relay server running background. To solve it, you should run the bash file `scripts/kill-relay-server.sh`

#### Changes to the RSKJ node or changes in the `run.sh` script

If you are using Docker, you should delete the old image using `docker image rm rsknode`.
Then delete the folder `rsknode/home/` and finally run `rsknode/run.sh` again (before this step you must download all the new changes).


## 7. Gas Station Network <a id="c07"></a>

This project is based on GSN and expands it capabilities and security model while reducing gas costs by:
- Securely deploying counterfactual SmartWallet proxies for each user account: this eliminates the need of relying in _msgSender() and _msgData() functions.
- Elimination of interaction with Uniswap: relay providers accumulate tokens on a paymaster under their control to later on decide what to do with funds.

Code here is based on [Gas Stations Network](https://github.com/opengsn/gsn) (GSN). In a nutshell, GSN abstracts away gas to minimize onboarding & UX friction for dapps. With GSN, gasless clients can interact with Ethereum contracts without users needing ETH for transaction fees. The GSN is a decentralized system that improves dapp usability without sacrificing security. 
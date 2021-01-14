# RSK Enveloping

System for users to pay for transactions in ERC-20 tokens.

[![CircleCI](https://circleci.com/gh/rsksmart/enveloping/tree/master.svg?style=shield)](https://circleci.com/gh/rsksmart/enveloping/tree/master)

## Table of Contents

1. [Description](#c01)
2. [Technical Overview](#c02)<br>
  2.1 [Testnet Contracts](#c02.1)<br>
3. [Building project](#c03)<br>
  3.1 [Testing](#c03.1)<br>
  3.2 [Use Enveloping](#c03.2)<br>
  3.3 [Create a Smart Wallet](#c03.3)<br>
4. [Run a Javascript Client](#c04)
5. [Use MetaCoin](#c05)
6. [Documentation](#c06)
7. [Troubleshooting](#c07)<br>
  6.1 [Running on macOS](#c07.1)<br>
  6.2 [Common errors when testing](#c07.2)
8. [Gas Station Network](#c08)

## 1. Description <a id="c01"></a>


The main objective of the Enveloping System is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to transact without RBTC.

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

| Contract          | Address                                    |
|-------------------|--------------------------------------------|
| [RelayHub](https://explorer.testnet.rsk.co/address/0x38bebd507abc3d76b10d61f5c95668e1240d087f)        | 0x38bebd507aBC3D76B10d61f5C95668e1240D087F |
| [StakeManager](https://explorer.testnet.rsk.co/address/0xc9673765e7EcFAA091e025aB5f3559a5312735B2)   | 0xc9673765e7EcFAA091e025aB5f3559a5312735B2 |
| [Penalizer](https://explorer.testnet.rsk.co/address/0xCe0624C8f4baa8a285cdc663480a59d7DCfA86Ea)   | 0xCe0624C8f4baa8a285cdc663480a59d7DCfA86Ea |
| [VersionRegistry](https://explorer.testnet.rsk.co/address/0x45BE444a2C64E9FC135DF82F10232215976385db) | 0x45BE444a2C64E9FC135DF82F10232215976385db |
| [SmartWallet](https://explorer.testnet.rsk.co/address/0xFe4511C3618e11BE8F0deacF9a274ebD8B461EDc)    | 0xFe4511C3618e11BE8F0deacF9a274ebD8B461EDc |
| [ProxyFactory](https://explorer.testnet.rsk.co/address/0x73890478E6D9Cf789Bc582A1e5F95769672e4a06)    | 0x73890478E6D9Cf789Bc582A1e5F95769672e4a06 |
| [DeployPaymaster](https://explorer.testnet.rsk.co/address/0x690c8A864487C586dfbB63d2AAe9aF2a55A30336) | 0x690C8A864487c586DFBB63d2aae9aF2A55A30336 |
| [RelayPaymaster](https://explorer.testnet.rsk.co/address/0xb4a86E32b39f86b203220D559A78ac68a0144b34)  | 0xb4A86E32B39f86b203220D559A78AC68A0144B34 |
| [TRIF ](https://explorer.testnet.rsk.co/address/0x19f64674d8a5b4e652319f5e239efd3bc969a1fe)  | 0x19f64674D8a5b4e652319F5e239EFd3bc969a1FE |

## 3. Building project <a id="c03"></a>

Clone the project. Then run the following from the project's root directory
-  `yarn install` (for instruction to install yarn [here](https://classic.yarnpkg.com/en/))
- Move [here](rsknode/README.md) (optional: it runs an RSK client)

### 3.1. Deploy <a id="c03.2"></a>

We can deploy the project with
- `npx truffle --network rsk migrate`
- `yarn run dev`

### 3.2. Test <a id="c03.1"></a>

Once the project is built, we can test it with truffle
- `yarn generate && npx truffle test --network rsk test/Flows.test.ts` (with [truffle](https://www.trufflesuite.com/))

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

### 4 Run a Relay Server on Regtest <a id="c04"></a>

In order to run an Enveloping instance in Regtest, clone the project then run the following from the project's root directory:

1. `yarn install`
2. On the jsrelay directory `npx webpack`
3. `npm link`
4. On the project's root directory, run `docker-compose build`
5. Run `docker-compose up -d rskj`
6. On a new terminal run `npx gsn start --network http://localhost:4444/`. Keeping the Relay Hub address.
7. Set the Relay Hub on the Paymaster contracts.
8. Create an account from a mnemonic, and store the mnemonic in a file. After that, add funds to the newly created account.
9. In the jsrelay directory in the file `gsn-relay-register` add the Relay Hub address.
10. On the project's root directory, run `docker-compose up -d jsrelay`
11. Finally, run `gsn relayer-register -n http://localhost:4444 -m <PATH.TO.MNEM> -f <0xADDRESS CREATED IN STEP 8>`

For checking if it's working, run `curl http://localhost:8090/getaddr`

To run a jsrelay on Testnet visit [this](https://docs.google.com/document/d/1_4u7yNrMNjf7LoqpUf5GYaiKeRmqOQJtXoFlHSdn2C8/edit?usp=sharing)

## 5. Use MetaCoin <a id="c05"></a>

Mint and send tokens without requiring RBTC for gas. Works on Regtest. 

Try it: https://github.com/rsksmart/enveloping-metacoin

## 6. Documentation <a id="c06"></a>

For more detailed documentation, go [here](https://docs.google.com/document/d/1kan8xUFYgjWNozBfpkopn35P9E6IuRjC-PNhwcrQLN4/edit)

## 7. Troubleshooting <a id="c07"></a>

### 7.1 Running on macOS <a id="c07.1"></a>
To run the project using Docker on a Mac, you must follow these steps or the scripts and web apps won't work.

- Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So you must patch `readlink`. This can be done as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this step, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can do it with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.


### 7.2 Common errors when testing <a id="c07.2"></a>

#### Running a test throws the Error: Cannot find module 'directory-to-the-project/enveloping/rsknode/test/Flows.test.ts'

Ensure that you are in the project's root directory and that the test's name has no typos


#### Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

Stop the running node and delete the db used by the node.

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`

## 8. Gas Station Network <a id="c08"></a>

This project is based on GSN and expands its capabilities and security model while reducing gas costs. It does this by:
- Securely deploying counterfactual SmartWallet proxies for each user account: this eliminates the need for relying on _msgSender() and _msgData() functions.
- Elimination of interaction with Uniswap: relay providers accumulate tokens on a paymaster under their control to later on decide what to do with funds.

Code here is based on [Gas Stations Network](https://github.com/opengsn/gsn) (GSN). In a nutshell, GSN abstracts away gas to minimize onboarding & UX friction for dapps. With GSN, gasless clients can interact with Ethereum contracts without users needing ETH for transaction fees. The GSN is a decentralized system that improves dapp usability without sacrificing security. 

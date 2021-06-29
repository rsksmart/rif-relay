# Launching

## Building the project

Clone the project. Then run the following from the Enveloping project's root directory to build it.

`yarn install`
`yarn prepare`

## Deploy contracts

### Locally

Use `truffle` for deploying contracts.

Having an RSK node up and running in regtest mode:

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

You need to copy that summary and save it in some place to retrieve it later.

### On Testnet


Use `truffle` for deploying contracts.

`npx truffle migrate --network rsktestnet` (disclaimer: to use testnet, you should have an unlocked account with funds or configure it in `truffle.js`).

We have already deployed these contracts on Testnet. See [here](#testnet-contracts)

## Run the Relay Server
Now you need to start the relay server, to do so you need to configure a 
json config file located at `<PROJECT_ROOT>/jsrelay/config/relay-config.json` that has this structure:
   
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
  "workdir": "/home/jonathan/workspace/enveloping/environment"
}
```

Where:

* **url**: is the url where the relay server will be deployed, it could be localhost or the ip of the host machine
* **port**: as url is the port where the relay server will be hosted.
* **relayHubAddress**: is the relay hub contract address, you can retrieve this from the contract summary.
* **relayVerifierAddress**: is the relay verifier contract address, you can retrieve this from the contract summary.
* **deployVerifierAddress**: is the deploy verifier contract address, you can retrieve this from the contract summary.
* **gasPriceFactor**: is the gas price factor used to calculate the gas on the server, you can leave it as 1.
* **rskNodeUrl**: is the RSK node endpoint url, where the RSK node is located.
* **devMode**: it indicates to the server if we are in development mode or not.
* **customReplenish**: (Pending documentation)
* **logLevel**: is the log level for the relay server.
* **workdir**: is the absolute path to the folder where the server will store the database and all it's data.

3. Now we can use the command `yarn relay` (on the root of the enveloping project) to start the relay server.
After running that command you will see a log saying that the relay server is not ready and that some values are wrong, that's ok you just need to register this relay server into the relay hub in order to be usable by the clients.

## Register the Relay Server

### On Regtest

The relay server is running, now you need to register this server in order to be usable, to do so you
first need to configure the script located on `<PROJECT_ROOT>/scripts/registerRelayServer` and replace the 
   values as you consider, the script contains something like this:

```
node dist/src/cli/commands/enveloping.js relayer-register --funds 100 --stake 200 --network http://rsk-node:4444/ --hub "0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701"
```

Where:

* **--fund**: indicates the amount of rbtc that you will transfer from accounts[0] to the worker manager account.
* **--stake**: (Pending documentation) this should be twice the value of funds.
* **--hub**: is the relay hub contract address, you can retrieve this from the contract summary.

After doing that you need to open another terminal and run this command `yarn registerRelay` \
(on the root of the enveloping project) in order to register the relay. After running that command you will
be seeing some logs saying that everything executes correctly. Then if you go to the relay server
logs you will be seing a lot of interaction but you need to see this log to be sure the server is ready:

```
Relayer state: READY
```

### On Testnet

1. Send to relayManagerAddress at least 0.001 tRBTC to set it up
2. Send to relayWorkerAddress at least 0.001 tRBTC to set it up
3. Once both addresses have been funded, run `node dist/src/cli/commands/enveloping.js relayer-register --network <RSKJ_NODE_URL> --hub <RELAY_HUB_CONTRACT_ADDRESS> -m <secret_mnemonic> --from <ADDRESS>  --funds <FUNDS> --stake <STAKE> --relayUrl <RELAY_URL>` where `<secret_mnemonic>` contains the path to a file with the mnemonic of a funded account to use during the relay server registration, `<ADDRESS>` is the account address associated to that mnemonic.

## Custom worker replenish function in the Relay Server

Each relayed transaction is signed by a Relay Worker account. The worker accounts are controlled by the Relay Manager. When a relay worker signs and relays a transaction, the cost for that transaction is paid using the funds in that worker's account. If the transaction is not subsidized, then the worker is compensated with tokens. Worker accounts must always have some minimum balance to pay gas for the transaction. These balances can be managed by implementing a replenishment strategy. The Relay Manager can use the strategy to top off a relay worker's account when the balance gets too low. We provide a default implementation for a replenishment strategy.  Enveloping solution integrators can implement their own replenish strategy.

To implement and use your own replenish strategy:

1. In the folder `src/relayserver`, open `ReplenishFunction.ts` with a text editor.
2. On the function `replenishStrategy` write your replenish strategy on the then branch.
3. Re build the project `yarn && yarn prepare`
4. Add the command `--customReplenish` when running a Relay Server or change the config json file to set `customReplenish` on true.

## Troubleshooting

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`

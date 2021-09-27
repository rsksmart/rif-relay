# Launching

## Prerequisites

Prepare the environment by following the instructions in [docs/basic_requirements](docs/basic_requirements.md)

## Building the project

Clone the project. Then run the following from the Enveloping project's root directory

-   `yarn install && yarn prepare`.
-   Move [here](../rsknode/README.md) (optional: it runs an RSK node)

## Deploy contracts locally

We use `truffle` for deploying contracts.

`npx truffle migrate --network rsk` (disclaimer: rsk network is for [Regtest](https://developers.rsk.co/quick-start/step1-install-rsk-local-node/) network).

## Run a Relay Server locally

In order to run an instance of Enveloping in Regtest:

1. From the jsrelay directory `npx webpack`.
2. Configure the server, to do it just edit the config file located at `jsrelay/config/relay-config.json`. You
   need to specify some parameters there like this:
    ```json5
    {
        url: 'localhost', // the interface where the relay server will be exposed
        port: 8090, // the port where it will be running
        relayHubAddress: '0x3bA95e1cccd397b5124BcdCC5bf0952114E6A701', // the relay hub contract address (can be retrieved from the summary of the deployment).
        relayVerifierAddress: '0x74Dc4471FA8C8fBE09c7a0C400a0852b0A9d04b2', // the relay verifier contract address (can be retrieved from the summary of the deployment).
        deployVerifierAddress: '0x1938517B0762103d52590Ca21d459968c25c9E67', // the deploy verifier contract address (can be retrieved from the summary of the deployment).
        gasPriceFactor: 1, // a gas price factor to use on gas price calculation, the price will be multiplied by this factor
        rskNodeUrl: 'http://localhost:4444', // endpoint where the RSK node is running
        devMode: true, // a flag to set development mode
        customReplenish: false, // set if the server uses a custom replenish function or not
        logLevel: 1, // the log level
        workdir: '/some/absolute/path' // an absolute path to the working directory of the server, the server will store all the information there
    }
    ```
3. From the root directory run `node dist/src/cli/commands/enveloping.js relayer-run --config test/server-config.json`.
4. To check if it is working, run `curl http://localhost:8090/getaddr`.

## Deploy contracts on testnet

We use `truffle` for deploying contracts.

`npx truffle migrate --network rsktestnet` (disclaimer: to use testnet, you should have an unlocked account with funds or configure it in `truffle.js`).

We have already deployed these contracts on Testnet. See [here](#testnet-contracts)

## Custom worker replenish function in the Relay Server

Each relayed transaction is signed by a Relay Worker account. The worker accounts are controlled by the Relay Manager. When a relay worker signs and relays a transaction, the cost for that transaction is paid using the funds in that worker's account. If the transaction is not subsidized, then the worker is compensated with tokens. Worker accounts must always have some minimum balance to pay gas for the transaction. These balances can be managed by implementing a replenishment strategy. The Relay Manager can use the strategy to top off a relay worker's account when the balance gets too low. We provide a default implementation for a replenishment strategy. Enveloping solution integrators can implement their own replenish strategy.

To implement and use your own replenish strategy:

1. In the folder `src/relayserver`, open `ReplenishFunction.ts` with a text editor.
2. On the function `replenishStrategy` write your replenish strategy on the then branch.
3. Re build the project `yarn && yarn prepare`
4. Add the command `--customReplenish` when running a Relay Server or change the config json file to set `customReplenish` on true.

## Run a Relay Server on testnet

In order to run an Enveloping instance in Testnet, clone the project then run the following from the project's root directory:

1. Create the project home folder, in this folder the jsrelay databases will be placed: `mkdir enveloping_relay`
2. In a terminal run `node dist/src/cli/commands/enveloping.js relayer-run --rskNodeUrl "http://localhost:4444" --relayHubAddress=<RELAY_HUB_CONTRACT_ADDRESS> --deployVerifierAddress=<DEPLOY_VERIFIER_CONTRACT_ADDRESS> --relayVerifierAddress=<RELAY_VERIFIER_CONTRACT_ADDRESS> --versionRegistryAddress=<VERSION_REGISTRY_CONTRACT_ADDRESS> --url <RELAY_URL> --port 8090 --workdir enveloping_relay --checkInterval 30000` where `<RELAY_HUB_CONTRACT_ADDRESS>` is the address for the relayHub you are using in the current network [(see Testnet Contracts section)](#c02.1), `<RELAY_URL>` in most cases will be `http://localhost`, and the server will be reachable in `<RELAY_URL>:port` unless `<RELAY_URL>` already defines a port (e.g, if `<RELAY_URL>` is `http://localhost:8090/jsrelay`)
3. In another terminal run `curl http://localhost:8090/getaddr` which will return some JSON with information of the running jsRelay Server, for example:

```json
{
    "relayWorkerAddress": "0xe722143177fe9c7c58057dc3d98d87f6c414dc95",
    "relayManagerAddress": "0xe0820002dfaa69cbf8add6a738171e8eb0a5ee54",
    "relayHubAddress": "0x38bebd507aBC3D76B10d61f5C95668e1240D087F",
    "minGasPrice": "6000000000",
    "chainId": "31",
    "networkId": "31",
    "ready": false,
    "version": "2.0.1"
}
```

4. Send to relayManagerAddress at least 0.001 tRBTC to set it up
5. Send to relayWorkerAddress at least 0.001 tRBTC to set it up
6. Once both addresses have been funded, run `node dist/src/cli/commands/enveloping.js relayer-register --network <RSKJ_NODE_URL> --hub <RELAY_HUB_CONTRACT_ADDRESS> -m secret_mnemonic --from <ADDRESS> --funds <FUNDS> --stake <STAKE> --relayUrl <RELAY_URL>` where `secret_mnemonic` contains the path to a file with the mnemonic of the account to use during the relay server registration, `<ADDRESS>` is the account address associated to that mnemonic
7. Wait until the relay server prints a message saying `RELAY: READY`.

## Troubleshooting

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`

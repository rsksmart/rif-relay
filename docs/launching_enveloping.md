# Launching

## Prerequisites

Prepare environment by following instructions in [docs/basic_requirements](docs/basic_requirements.md)

## Building the project

Clone the project. Then run the following from the Enveloping's root directory
-  `yarn install && yarn prepare`.
- Move [here](../rsknode/README.md) (optional: it runs an RSK client)

## Deploy contracts locally

We use `truffle` for deploying contracts.

`npx truffle migrate --network rsk` (disclaimer: rsk network is for [Regtest](https://developers.rsk.co/quick-start/step1-install-rsk-local-node/) network).

## Run a Relay Server locally

In order to run an Enveloping instance in Regtest:

1. On the jsrelay directory `npx webpack`
2. On the root directory run `node dist/src/cli/commands/gsn.js start --network http://localhost:4444/`. (With localhost:4444 a port to an RSK regtest node).
3. For checking if it's working, run `curl http://localhost:8090/getaddr`

## Deploy contracts on testnet

We use `truffle` for deploying contracts.

`npx truffle migrate --network rsktestnet` (disclaimer: to use testnet, you should have an unlocked account with funds or configure it in `truffle.js`).

We already have our own contracts deployed in Testnet. See [here](docs/launch.md##Testnetcontracts)

## Run a Relay Server on testnet

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
6. Once both addresses have been funded, run `node dist/src/cli/commands/gsn.js relayer-register --network <RSKJ_NODE_URL> --hub <RELAY_HUB_CONTRACT_ADDRESS> -m secret_mnemonic --from <ADDRESS>  --funds <FUNDS> --stake <STAKE> --relayUrl <RELAY_URL>` where `secret_mnemonic` contains the path to a file with the mnemonic of the account to use during the relay server registration, `<ADDRESS>` is the account address associated to that mnemonic
7.  Wait until the relay server prints a message saying `RELAY: READY`.

## Troubleshooting

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`
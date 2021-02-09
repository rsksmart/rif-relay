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

## 

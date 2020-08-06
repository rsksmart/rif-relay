# Demo Dapp Setup Guide

## Prerequisites

- Docker

## Setup

All of the commands below must be run in the root directory of the repository.

1. Start a local RSK node:

There's a separate docker image for this purpose. Just run:

```
./rsknode/run.sh
```

Wait for the node to be up and running (this can take a while). In the output right before the node starts up, you will see something like:

```
******************** STARTING NODE *********************
************* RPC TO BE SET ON IP 172.17.0.2 *************
```

Copy the IP address, in this case `172.17.0.2`.

2. Configure truffle:

Edit the file `truffle.js`. Find the network entry that looks like this:

```
rsk: {
    verbose: process.env.VERBOSE,
    host: "172.17.0.1",
    port: 4444,
    network_id: "*",
}
```

Replace the `host` value with the IP address you found on the previous step.

3. Install the dependencies:

```
./dock/run.sh yarn
```

4. Check that truffle can access your RSK node:

Run:

```
./dock/run.sh npx truffle console --network rsk
```

When the prompt appears (`truffle(rsk)>`), run:

```
web3.eth.getBlockNumber()
```

you should get the current block number as a result.

## Running the demo

With the RSK node running (see step 1) and on a separate terminal in the root directory, run:

```
./dock/run.sh ./start-demo.sh
```

After a while, you should get the following:

```
┌────────────────────────────────────────────────┐
│                                                │
│   Serving!                                     │
│                                                │
│   - Local:            http://localhost:5555    │
│   - On Your Network:  http://172.17.0.2:5555   │
│                                                │
└────────────────────────────────────────────────┘
```

To access the demo web app, click on the second link from the top (reason being the app is hosted on the docker container).

## Redeploying the contracts

In case you want to re-run the demo with a fresh set of contracts, run:

```
./dock/run.sh ./start-demo.sh reset
```

## Running the demo in development mode

In case you want to make changes to the app and be able to test them right away, run:

```
./dock/run.sh ./start-demo.sh dev
```

The app will automatically rebundle and refresh upon changes.

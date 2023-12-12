# RIF Relay

A secure transaction relay system to enable users to pay fees using ERC-20 tokens.

## Description

RIF Relay takes its inspiration from the [Gas Station Network (GSN) project](https://github.com/opengsn/gsn). GSN is a decentralized system that improves dApp usability without sacrificing security. In a nutshell, GSN abstracts away gas (used to pay transaction fees) to minimize onboarding and UX friction for dApps. With GSN, “gasless clients” can interact with smart contracts paying for gas with tokens instead of native-currency.

Our main objective is to provide the RSK ecosystem with the means to enable blockchain applications and end-users (wallet-apps) to pay for transaction fees using tokens (e.g. RIF tokens), and thereby remove the need to acquire RBTC in advance.

It is important to recall that - as a security measure - the version 1 contracts deployed on Mainnet have limits on the staked amounts to operate, these limits were removed in version 2.

## Modules

RIF Relay is built in modules, the entire system is made up by 3 modules.

1. [RIF Relay Contracts](https://github.com/rsksmart/rif-relay-contracts) contains all the contracts used by the RIF Relay System.
2. [RIF Relay Client](https://github.com/rsksmart/rif-relay-client) contains a library to interact with the relay server.
3. [RIF Relay Server](https://github.com/rsksmart/rif-relay-server) has all the relay server code. You can run the server directly from there.

Each module has instructions for development and usage.

## Getting Started

## 1. Running the Rootstock node

- this can be done either by using the [JAR package](https://dev.rootstock.io/rsk/node/install/operating-systems/java/) or the [docker](https://dev.rootstock.io/rsk/node/install/operating-systems/) container
- see devportal documentation: [https://dev.rootstock.io/rsk/node/install/](https://dev.rootstock.io/rsk/node/install/)
- in either case, a specific `node.conf` file must be used: [https://github.com/rsksmart/rif-relay/blob/develop/docker/node.conf](https://github.com/rsksmart/rif-relay/blob/develop/docker/node.conf)

### Using the JAR file

To run the Rootstock node using the [JAR file](https://github.com/rsksmart/rskj/releases), see the instructions for how to **[Install the node using a JAR file](https://dev.rootstock.io/rsk/node/install/operating-systems/java/).**

- Create the directory for the node:

```jsx
mkdir rskj-node-jar
cd ~/rskj-node-jar
```

- Move or copy the just downloaded jar file to the directory

```jsx
mv ~/Downloads/rskj-core-5.3.0-FINGERROOT-all.jar SHA256SUMS.asc /Users/{user}/rskj-node-jar/
```

- Create another directory inside `~/rskj-node-jar/config`

```jsx
mkdir config
```

- Download this config file: [https://github.com/rsksmart/rif-relay/blob/develop/docker/node.conf](https://github.com/rsksmart/rif-relay/blob/develop/docker/node.conf)
- Copy or move the `node.conf` file just downloaded into the config directory
- CD into the folder containing the jar file

Run the following command in the terminal:

```bash
arch -x86_64 /usr/local/opt/openjdk@8/bin/java -Drsk.conf.file=./config/node.conf -cp ./rskj-core-5.3.0-FINGERROOT-all.jar co.rsk.Start --regtest
```

OR

```jsx
java -Drsk.conf.file=./config/node.conf \
cp ./<PATH-TO-JAR-FILE> co.rsk.Start \
-regtest
```

---

Leave the terminal running.

Now let’s check that the node is running

Open another terminal and enter the command below:

```jsx
curl http://localhost:4444 \
 -s \
 -X POST \
 -H "Content-Type: application/json" \
 --data '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":67}'
```

It should output a response like this:

```jsx
{"jsonrpc":"2.0","id":67,"result":"RskJ/5.3.0/Mac OS X/Java1.8/FINGERROOT-202f1c5"}
```

Check the blockNumber:

```jsx
curl -X POST http://localhost:4444/ \
-H "Content-Type: application/json" \
--data '{"jsonrpc":"2.0", "method":"eth_blockNumber","params":[],"id":1}'
```

You should see the below output:

```jsx
{"jsonrpc":"2.0","id":1,"result":"0x0"}
```

Now, you have successfully setup a Rootstock node using the jar file.

### Using Docker

### 

- developer’s portal instructions
    
    Follow the instructions in [How to setup a Rootstock node using Docker](https://dev.rootstock.io/rsk/node/install/operating-systems/).
    
    In this guide, we will run the node using the **[Dockerfile.RegTest](https://github.com/rsksmart/artifacts/blob/master/Dockerfiles/RSK-Node/Dockerfile.RegTest).** This means a node connected to a private `RegTest` network.
    
    Note that If you get the error:
    
    ```jsx
    => ERROR [6/6] COPY supervisord.conf /etc/supervisor/conf.d/supervisord.  0.0s
    ------
     > [6/6] COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf:
    ------
    failed to compute cache key: "/supervisord.conf" not found: not found
    ```
    
    Ensure that supervisord.conf is in the same folder as the dockerfile.
    
    When the build finishes, you should see an output similar to this:
    
    ```jsx
    [+] Building 158.0s (11/11) FINISHED                                            
     => [internal] load build definition from Dockerfile.RegTest               0.0s
     => => transferring dockerfile: 293B
    ....
    => => exporting layers                                                    3.8s 
     => => writing image sha256:d73739affdbe3f82a8ba9c686d34c04f48ac510568522  0.0s 
     => => naming to docker.io/library/regtest                                 0.0s
    
    Use 'docker scan' to run Snyk tests against images to find vulnerabilities and learn how to fix them
    ```
    
    Now you have a container ready to run Rootstock!
    

To run the RegTest node, you should execute:

Pull the RSKj Docker Image

```jsx
docker pull rsksmart/rskj
```

Run the Node

```jsx
docker run -d --name rsk-node -p 4444:4444 -p 50505:50505 rsksmart/rskj node --regtest
```

If successful, the node should be running.

Interacting with the Node

```jsx
curl -X POST -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"method\":\"net_version\",\"params\":[],\"id\":1}" http://127.0.0.1:4444
```

---

---

You should see the below output:

```bash
{"jsonrpc":"2.0","id":1,"result":"33"}
```

To check that the node running, see section on Using the JAR file

Now, you have successfully setup a Rootstock node using the docker image.

## Testing

This repository contains all the integration tests. These tests verify the behavior of the entire system.
You have two ways to run tests:

1. Executing `npm test` will run all the test suite and verify all the system. This could take 
   a few hours since executing the entire test suite is a heavy task.
2. Running `npm run testOnly <TEST_FILE>` where `<TEST_FILE>` it’s the typescript file
that contains the test code inside will execute only that test and make the verifications inside it. An example could be `npm run testOnly ./test/relayserver/RelayServer.test.ts`.

**Important Note**: when you run the tests you will see folders like `contracts`, `migrations` and some other files
appearing during the tests and disappearing after, that’s because we need to have the contracts
on the same context as this repository during tests, this is a normal behavior. 

## Scripts

This repository contains a script that analyzes gas consumption for relay and deploy transactions. It prints different metrics related to gas usage when relaying a transaction or deploying a smart wallet.
To run it, execute the command:

`npm run analyze:gas <NETWORK_NAME>`

where:
- `<NETWORK_NAME>` is a required parameter for the network name, taken from the `hardhat.config.ts`, and must correspond to a valid RSK Node (commonly, regtest is used). Do not use this with the default network (hardhat) as it will fail.

Example: 
`npm run analyze:gas regtest`

[Deprecated Doc](docs/README.md)

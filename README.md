# RSK Enveloping

Support for Metatransactions in RSK. Code here inherits heavily from [RSK's fork from Gas Station Network](https://github.com/rsksmart/tabookey-gasless), in the sense that it's based on an architecture defining the following components:

- **RelayHub** - master contract on the blockchain, to manage all relays, and help clients find them.
- **RelayServer** - a relay service daemon, running as a geth module or standalone HTTP service.  Advertises itself (through the RelayHub) and waits for client requests.
- **RelayClient** - a javascript library for a client to access the blockchain through a relay. Provides APIs to find a good relay, and to send transactions through it. The library hooks the local web3, so that any loaded contract API will go through the relay.

For a full techincal description, see [Tabookey's EIP draft](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1613.md).


## Usage:
You need to be able to run an RSK node hosting the RelayHub contracts, and to compile + execute the Relay server. You can either install everything yourself or use Docker (recommended).

### Running on Your Host
In a nutshell, you must install in your machine:
  - node, yarn
  - abigen, solc
  - Truffle
  - Java 8

Then you must execute [rsknode/rskj.sh](rsknode/rskj.sh) to run the node. In order to deploy the RelayHub contracts and start up the relay server, you can follow the steps used to startup the demo: [start-demo.sh](start-demo.sh).

### Running using Docker (Recommended)
See [demo-setup.md](demo-setup.md) for an explanation about running a simple "Counter" contract along with a sample web app that uses a test relay network to send gasless transactions. Such sample showcases how the different components are setup and executed, and how they interact with each other.

**NOTE:** If you are a Mac User, keep reading.

### Note to MacOS Users
If you intend to execute using Docker on a Mac, you must follow these steps or the scripts and web apps won't work.

#### Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So you must patch `readlink`. You can do it as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can do it with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.

#### Enable SOCKS Server
The demo web app (or any web app acting as a front end) must be able to send requests to the node's RPC API, which is hosted in a container. Therefore, the MacOS host must be able to reach a Docker container. While this works out of the box in Linux, it doesn't in MacOS. We can fix this by enabling a SOCKS server. This requires a new enough Docker version (Docker desktop v2.3.0.3 works).

Start by telling Docker where the SOCKS port will be hosted:
```
cd ~/Library/Group\ Containers/group.com.docker/
mv settings.json settings.json.backup
cat settings.json.backup | jq '.["socksProxyPort"]=8888' > settings.json
```

(If you don't have `jq` and don't want to install it, you can edit `settings.json` directly).

Then enable the SOCKS proxy server on your system: go to `Apple System Preferences → Network → Advanced → Proxies`, and enable "SOCKS Proxy" using "localhost:8888", hit OK and then Apply.

<img src="socks.png" width=600 align=center>

### RelayClient options:

- `force_gasLimit`: use specific gas limit for all transactions. if not set, the user must supply gas limit for each transaction.
- `force_gasprice`: if not set, then the client will use `web3.eth.gasPrice` with the factor (below)
- `gaspriceFactorPercent`: how much above default `gasPrice` to use. default is 20% which means we use gasPrice*1.2
- `minStake`: ignore relays with lower stake
- `minDelay`: ignore relays with lower stake delay
- `verbose`: show logs of client requests/responses


## RSK Specifics

The following changes were implemented in order to get the Relay Network working on top of the RSK network.

On the `RelayServer`:

- Forcing usage of a single outstanding request for JSON-RPC requests
- Patched `go-ethereum` to allow for hexadecimal numbers with leading zeroes on JSON-RPC responses
- Patched `go-ethereum`'s `GetPendingCodeAt` to use `latest` (`pending` hasn't yet been implemented on RSK's latest version)
- Removed the `logsBloom` field from transaction receipts

On the `RelayClient`:

- Added compatibility with RSK's pending transaction error message

Also, js tests were modified in order to allow for them to also run on a regtest RSK node (this was part of the compatibilization process). To run such tests, just configure the truffle network with the name `rsk` to point to a local regtest RSK node and execute:

```
./dock/run.sh npm run test-js-rsk
```

Last but not least, some bugs were fixed:

- On the `RelayServer`: only look at the last relayer registration event
- On the `RelayClient`: upon relaying failure, fix the error status setting

## Some useful tools:

- [Solidity decompiler](https://ethervm.io/decompile)
- [EVM Simulator] (https://github.com/tanmaster/EVM-Simulator)

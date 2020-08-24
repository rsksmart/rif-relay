# Gas Stations Network

GSN abstracts away gas to minimize onboarding & UX friction for dapps. With GSN, gasless clients can interact with Ethereum contracts without users needing ETH for transaction fees. The GSN is a decentralized system that improves dapp usability without sacrificing security.

## Demo

Try it: https://metacoin.opengsn.org/

Mint and send tokens without requiring ETH for gas. Works on Ropsten and Kovan testnets.

GitHub: https://github.com/opengsn/metacoin

## Documentation

https://docs.opengsn.org/


## How to use (from the project's root directory)

- yarn install
- ./rsknode/run.sh
- yarn generate && yarn tsc && npx truffle test --network rsk test/Flows.test.ts

## Troubleshooting

- A block header must have 16/17 elements or 19/20 including merged-mining fields but it had 19

Check the folder in enveloping/rsknode/, on the `node.conf` file should have:

```
blockchain.config {
    name = regtest
    hardforkActivationHeights = {
        bahamas = 10,
        afterBridgeSync = -1,
        orchid = 10,
        orchid060 = 10,
        wasabi100 = 10,
        twoToThree = 10,
        papyrus200 = 10
    },
    consensusRules = {
        rskip97 = -1 # disable orchid difficulty drop
    }
}
```

- Running a test, it throw Error: Cannot find module 'directory-to-the-project/enveloping/rsknode/test/Flows.test.ts'

You should check you're standing in the project's root directory, the test name is well written without typos

- Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

You should stop the running node, delete the db used by the node. Run it again and test.

- Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

You should stop the running node, delete the db used by the node. Run it again and test.

- Running some test, one of them throws: Error: listen EADDRINUSE: address already in use :::8090

This is the relay server running background. To solve it, you should run the bash file `scripts/kill-relay-server.sh`

- There is a new commit in the rskj project that we need to use or there is a change in the `run.sh` script

If you are using Docker, you should delete the old image using `docker image rm rsknode`.
Then delete the folder `rsknode/home/` and finally run `rsknode/run.sh` again (before this step you must download all the new changes).


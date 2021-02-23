# Development guide

## Initializing the project

To use Enveloping, we explained [here](docs/launching_enveloping.md) the basic steps to build the project.

## Project structure

The project has on-chain and off-chain components.

- In the `contracts` folder on the root directory, you can find all the smart contracts involved in Enveloping.
    - Those could be compiled with `yarn prepare` and it changes will be reflected in the `build/contracts` folder.
    - If a new contract is created, it's important to add it in `migrations/2_deploy_contracts.js` for deploying it.
    - The current solidity version is `^0.6.12`.
- In `src` you can find off-chain components such as `cli`, `relayclient` and `relayserver`. Everything here is coded in `typescript`.
    - To compile typescript, you should use `yarn tsc` and the changes will be in the `dist` folder.
- In the `jsrelay`, there are all related to run a Relay Server. You can see [here](docs/launching_enveloping.md) for more details.
- In `test` is all the suit of testing. You can read below for knowing how to test Enveloping.

## Testing

When a new test is added before running the tests you should run `yarn tsc` for compiling.

- To run all the tests:

`./run-tests`

Note: It takes time, the script will run an RSK node in regtest, and then run all the tests.

- To run a specific test:

Once the project is built, we can test it with truffle
`yarn generate && npx truffle test --network rsk test/Flows.test.ts` (with [truffle](https://www.trufflesuite.com/))
## Committing changes

For contributing to the project, you should create a branch with the name of the new feature you are implementing (e.g. `gas-optimization`). When you commit to git, a hook is executed. The hook executes a linter and all the tests.
## Troubleshooting <a id="c07"></a>
### Common errors when testing
#### Running a test throws the Error: Cannot find module 'directory-to-the-project/enveloping/rsknode/test/Flows.test.ts'

Ensure that you are in the project's root directory and that the test's name has no typos

#### Running Flows.test.ts test throws the error: http://localhost:8090 => Error: local view call to 'relayCall()' reverted: view call to 'relayCall'..

Stop the running node and delete the db used by the node.

#### Running some test and one of them throws: Error: listen EADDRINUSE: address already in use :::8090

The relay server running in the background. Run the bash file `scripts/kill-relay-server.sh`
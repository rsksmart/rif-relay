#!/bin/sh
run_batch()
{
    cid=$(sudo docker run --rm -d rsknode --reset)
    for test; do
        sudo docker exec -it "$TEST_EXECUTOR_CID" \
            npx truffle test --network rsk "$test"
    done
    sudo docker stop "$cid"
}
TEST_EXECUTOR_CID=$(sudo docker run --init --rm -d node:14-alpine)
# Test_Group_1
run_batch test/RelayHubPenalizations.test.ts test/RelayHubRegistrationsManagement.test.ts test/TxStoreManager.test.ts test/common/VersionManager.test.ts test/regressions/PayableWithEmit.test.ts test/relayclient/AccountManager.test.ts test/relayclient/ContractInteractor.test.ts test/relayclient/GSNConfigurator.test.ts  

# Test_Group_2
run_batch test/relayclient/RelaySelectionManager.test.ts

run_batch test/relayserver/RelayServerRequestsProfiling.test.ts

run_batch test/relayserver/ServerConfigParams.test.ts

run_batch test/relayserver/TransactionManager.test.ts

run_batch test/relayclient/KnownRelaysManager.test.ts

run_batch test/smartwallet/SmartWallet.test.ts

run_batch test/RelayHubGasCalculations.test.ts

run_batch test/SampleRecipient.test.ts

run_batch test/StakeManager.test.ts

run_batch test/RSKAddressValidator.test.ts

# Test_Group_3
run_batch test/Flows.test.ts test/GsnTestEnvironment.test.ts test/HttpWrapper.test.ts test/KeyManager.test.ts test/PaymasterCommitment.test.ts test/ProxyFactory.test.ts

# Test_Group_4
run_batch test/relayclient/RelayClient.test.ts test/relayserver/NetworkSimulation.test.ts test/relayserver/RegistrationManager.test.ts test/relayserver/RelayServer.test.ts test/relayserver/RelayServer.webpack.test.ts

# Test_Group_5
run_batch test/RelayHub.test.ts

run_batch test/VersionRegistry.test.ts

run_batch test/relayclient/RelayProvider.test.ts

run_batch test/relayclient/RelaySelectionManager.test.ts

sudo docker stop "$TEST_EXECUTOR_CID"

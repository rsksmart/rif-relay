#!/bin/bash

./scripts/execute-test \
    test/RelayHubPenalizations.test.ts \
    test/RelayHubRegistrationsManagement.test.ts \
    test/TxStoreManager.test.ts \
    test/common/VersionManager.test.ts \
    test/regressions/PayableWithEmit.test.ts \
    test/relayclient/AccountManager.test.ts \
    test/relayclient/ContractInteractor.test.ts \
    test/relayclient/Configurator.test.ts  

# Test_Group_2
./scripts/execute-test test/relayclient/RelaySelectionManager.test.ts \
    test/relayserver/RelayServerRequestsProfiling.test.ts \
    test/relayserver/ServerConfigParams.test.ts \
    test/relayserver/TransactionManager.test.ts \
    test/relayclient/KnownRelaysManager.test.ts \
    test/smartwallet/SmartWallet.test.ts \
    test/SampleRecipient.test.ts \
    test/StakeManagement.test.ts \
    test/RSKAddressValidator.test.ts \
    test/EnvelopingUtils.test.ts \
    test/relayclient/SmartWalletDiscovery.test.ts

# Test_Group_3
./scripts/execute-test \
    test/Flows.test.ts \
    test/TestEnvironment.test.ts \
    test/HttpWrapper.test.ts \
    test/KeyManager.test.ts \
    test/PaymasterCommitment.test.ts \
    test/WalletFactory.test.ts

# Test_Group_4
./scripts/execute-test \
    test/relayclient/RelayClient.test.ts \
    test/relayserver/NetworkSimulation.test.ts \
    test/relayserver/RegistrationManager.test.ts \
    test/relayserver/RelayServer.test.ts \
    test/relayserver/RelayServer.webpack.test.ts

# Test_Group_5
./scripts/execute-test test/RelayHub.test.ts \
    test/VersionRegistry.test.ts \
    test/relayclient/RelayProvider.test.ts \
    test/relayclient/RelaySelectionManager.test.ts

./scripts/execute-test test/smartwallet/CustomSmartWallet.test.ts
#!/bin/sh
run_batch()
{
	cid=$(docker run --init --network "$TEST_NETWORK" \
	    --expose 4444 -p 127.0.0.1:4444:4444 \
		--expose 4445 -p 127.0.0.1:4445:4445 \
	    --rm -itd --name enveloping-rskj rsknode --regtest)

	_i=0
	while [ $_i -lt 30 ]; do
		curl -Ss -H "Content-type: application/json" \
		    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":"boot-test"}' \
		    http://127.0.0.1:4444/ 2>/dev/null | grep -q result && break
		sleep 1
		_i=$((_i + 1))
	done
	if [ $_i -eq 30 ]; then
		echo "No response from rskj after 30 seconds; aborting..." >&2
		exit 1
	fi
	sleep 5

	for test; do
		docker exec -it "$TEST_RUNNER_CID" \
		    npx truffle test --network rskdocker "$test"
	done

	docker stop "$cid"
}

setup_containers()
{
	printf "Creating Docker network..." >&2
	TEST_NETWORK=enveloping-tests-net
	docker network create -d bridge "$TEST_NETWORK"
	if [ $? -ne 0 ]; then
		printf "ERROR! Couldn't create the network; aborting\n" >&2
		exit 1
	fi
	printf " OK\n" >&2

	printf "Building containers..." >&2
	docker build -t rsknode rsknode/ &&
	    docker build -t tests-runner .
	if [ $? -ne 0 ]; then
		printf "ERROR! Couldn't build containers; aborting\n" >&2
		exit 1
	fi

	printf "Creating tests runner container..." >&2
	TEST_RUNNER_CID=$(docker run -e NODE_OPTIONS=--max_old_space_size=4096 --init --network "$TEST_NETWORK" \
	    -itd --rm tests-runner cat)
	if [ $? -ne 0 ]; then
		printf "ERROR! Couldn't create tests runner; aborting\n" >&2
		exit 1
	fi
	printf " OK\n" >&2
}

cleanup()
{
	docker stop enveloping-rskj 2>/dev/null || true
	[ -n "$TEST_RUNNER_CID" ] && docker stop "$TEST_RUNNER_CID" || true
	[ -n "$TEST_NETWORK" ] && docker network rm "$TEST_NETWORK" || true
}

TEST_NETWORK=
TEST_RUNNER_CID=

trap 'cleanup' EXIT INT QUIT TERM

setup_containers

set -e

# Test_Group_1
run_batch \
    test/RelayHubPenalizations.test.ts \
    test/RelayHubRegistrationsManagement.test.ts \
    test/TxStoreManager.test.ts \
    test/common/VersionManager.test.ts \
    test/regressions/PayableWithEmit.test.ts \
    test/relayclient/AccountManager.test.ts \
    test/relayclient/ContractInteractor.test.ts \
    test/relayclient/Configurator.test.ts  

# Test_Group_2
run_batch test/relayclient/RelaySelectionManager.test.ts
run_batch test/relayserver/RelayServerRequestsProfiling.test.ts
run_batch test/relayserver/ServerConfigParams.test.ts
run_batch test/relayserver/TransactionManager.test.ts
run_batch test/relayclient/KnownRelaysManager.test.ts
run_batch test/smartwallet/SmartWallet.test.ts
run_batch test/smartwallet/CustomSmartWallet.test.ts
run_batch test/SampleRecipient.test.ts
run_batch test/StakeManagement.test.ts
run_batch test/RSKAddressValidator.test.ts
run_batch test/EnvelopingUtils.test.ts
run_batch test/relayclient/SmartWalletDiscovery.test.ts

# Test_Group_3
run_batch \
    test/Flows.test.ts \
    test/TestEnvironment.test.ts \
    test/HttpWrapper.test.ts \
    test/KeyManager.test.ts \
    test/WalletFactory.test.ts

# Test_Group_4
run_batch \
    test/relayclient/RelayClient.test.ts \
    test/relayserver/NetworkSimulation.test.ts \
    test/relayserver/RegistrationManager.test.ts \
    test/relayserver/RelayServer.test.ts \
    test/relayserver/RelayServer.webpack.test.ts

# Test_Group_5
run_batch test/RelayHub.test.ts
run_batch test/VersionRegistry.test.ts
run_batch test/relayclient/RelayProvider.test.ts
run_batch test/relayclient/RelaySelectionManager.test.ts

# Test_Group_6
run_batch test/enveloping/EnvelopingArbiter.test.ts

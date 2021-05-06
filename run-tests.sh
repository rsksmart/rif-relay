#!/bin/sh
run_batch()
{
	cid=$(docker run --init --network "$TEST_NETWORK" \
	    --expose 4444 -p 127.0.0.1:4444:4444 \
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

run_batch test/smartwallet/CustomSmartWallet.test.ts
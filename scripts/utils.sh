#! /bin/bash


TEST_SUITE_BATCH="batch"
TEST_SUITE_SEQUENTIAL="sequential"
STOP_ON_FAIL=${FAIL_FAST:-1}

function wait_rsk_node() {
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
}

function run_batch() {
  TESTS=("$@")
  unset TESTS[0]
  BATCH_NAME=$1

  echo "#################################################################################### Starting Batch ${BATCH_NAME} ####################################################################################"
  
  cp -r node_modules/@rsksmart/rif-relay-contracts/contracts .
  cp -r node_modules/@rsksmart/rif-relay-contracts/migrations .

  echo "#################################################################################### START BATCH TESTS ####################################################################################"
  
  TEST_FAIL=0
  npx truffle test --network regtest "${TESTS[@]}" || TEST_FAIL=1
  
  echo "#################################################################################### END BATCH TESTS ####################################################################################"
  
  rm -rf contracts
  rm -rf migrations
  rm -rf contract-addresses.json
  
  echo "#################################################################################### Ending Batch ${BATCH_NAME} ####################################################################################"

  if [ "${TEST_FAIL}" == "1" ]; then
    exit 1
  fi
}

# It requires two env variables:
# HARD_FORK = the RSKj node hard fork
# RSKJ_VERSION = the RSKj node version
function run_batch_on_ci() {
  rskj_hard_fork=${RSKJ_HARD_FORK:?"RSKj hardfork is required"}
  rskj_version=${RSKJ_VERSION:?"RSKj version is required"}
  java -Dminer.client.autoMine=true -Drpc.providers.web.ws.enabled=true -Drsk.conf.file=~/gls/rsknode/node.conf -Dminer.minGasPrice=1 $rskj_hard_fork -cp ~/rsksmart/rskj/rskj-core/build/libs/rskj-core-${rskj_version}-all.jar co.rsk.Start --regtest --reset nohup &
  rskj_pid=$!

  wait_rsk_node

  run_batch $@

  kill -TERM $rskj_pid
  sleep 5
}

function run_test_suite_on_ci() {
  TESTS=("$@")
  unset TESTS[0]
  TEST_TYPE=$1
  unset TESTS[1]
  TEST_NAME=$2
  
  TEST_FAIL=0
  if [ "$TEST_TYPE" = "$TEST_SUITE_BATCH" ]
  then
    run_batch_on_ci "${TEST_NAME} ${TESTS[@]}"|| TEST_FAIL=1
  elif [ "$TEST_TYPE" = "$TEST_SUITE_SEQUENTIAL" ]
  then
    for test_case in "${TESTS[@]}"
    do
      run_batch_on_ci "${TEST_NAME} ${test_case}" || TEST_FAIL=1
      if [[ "${TEST_FAIL}" == "1" && "${STOP_ON_FAIL}" == "1" ]]; then
        break
      fi
    done
    
  else
    echo "Unsupported test type: accepted values are ${TEST_SUITE_BATCH} or ${TEST_SUITE_SEQUENTIAL}"
    exit 1
  fi

  if [ "${TEST_FAIL}" == "1" ]; then
    exit 1
  fi
}


function run_batch_against_docker() {
  docker-compose -f docker/docker-compose.yml build
  docker-compose -f docker/docker-compose.yml up -d

  wait_rsk_node
  
  run_batch $@

  docker-compose -f docker/docker-compose.yml down
}

function run_test_suite_against_docker() {
  TESTS=("$@")
  unset TESTS[0]
  TEST_TYPE=$1
  unset TESTS[1]
  TEST_NAME=$2

  if [ "$TEST_TYPE" = "$TEST_SUITE_BATCH" ]
  then
    run_batch_against_docker "${TEST_NAME} ${TESTS[@]}"
  elif [ "$TEST_TYPE" = "$TEST_SUITE_SEQUENTIAL" ]
  then
    for test_case in "${TESTS[@]}"
    do
      run_batch_against_docker "${TEST_NAME} ${test_case}" || TEST_FAIL=1
      if [[ "${TEST_FAIL}" == "1" && "${STOP_ON_FAIL}" == "1" ]]; then
        exit 1
      fi
    done
  else
    echo "Unsupported test type: accepted values are ${TEST_SUITE_BATCH} or ${TEST_SUITE_SEQUENTIAL}"
    exit 1
  fi
}

# Test suite format: "<sequential|batch> <test_name> test_file_1 test_file_2 ... test_file_n"
TEST_SUITE_1="${TEST_SUITE_BATCH} \
  Test_Group_1 \
  test/Verifiers.test.ts \
  test/RelayHubPenalizations.test.ts \
  test/RelayHubRegistrationsManagement.test.ts \
  test/TxStoreManager.test.ts \
  test/Utils.test.ts \
  test/common/VersionManager.test.ts \
  test/regressions/PayableWithEmit.test.ts \
  test/relayclient/AccountManager.test.ts \
  test/relayclient/ContractInteractor.test.ts \
  test/relayclient/Configurator.test.ts"

TEST_SUITE_2="${TEST_SUITE_SEQUENTIAL} \
  RelaySelectionManager|RelayServerRequestsProfiling|ServerConfigParams|TransactionManager|KnownRelaysManager|SmartWallet|SampleRecipient|StakeManagement|RSKAddressValidator|EnvelopingUtils|SmartWalletDiscovery|CustomSmartWallet \
  test/relayclient/RelaySelectionManager.test.ts \
  test/relayserver/RelayServerRequestsProfiling.test.ts \
  test/relayserver/ServerConfigParams.test.ts \
  test/relayserver/TransactionManager.test.ts \
  test/relayclient/KnownRelaysManager.test.ts \
  test/smartwallet/SmartWallet.test.ts \
  test/SampleRecipient.test.ts \
  test/StakeManagement.test.ts \
  test/RSKAddressValidator.test.ts \
  test/EnvelopingUtils.test.ts \
  test/relayclient/SmartWalletDiscovery.test.ts \
  test/smartwallet/CustomSmartWallet.test.ts"

TEST_SUITE_3="${TEST_SUITE_BATCH} \
  Test_Group_3 \
  test/Flows.test.ts \
  test/TestEnvironment.test.ts \
  test/HttpWrapper.test.ts \
  test/KeyManager.test.ts \
  test/WalletFactory.test.ts"

TEST_SUITE_4="${TEST_SUITE_BATCH} \
  Test_Group_4 \
  test/relayclient/RelayClient.test.ts \
  test/relayserver/NetworkSimulation.test.ts \
  test/relayserver/RegistrationManager.test.ts \
  test/relayserver/RelayServer.test.ts"

TEST_SUITE_5="${TEST_SUITE_SEQUENTIAL} \
  RelayHub|VersionRegistry|RelayProvider|RelaySelectionManager \
  test/RelayHub.test.ts
  test/VersionRegistry.test.ts
  test/relayclient/RelayProvider.test.ts"
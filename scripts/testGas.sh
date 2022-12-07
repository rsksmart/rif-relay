#!/bin/bash

# uncomment this if you want to generate logs on a file instead of print out to console
#TEST_LOG=tests.log
#exec 3>&1 4>&2
#trap 'exec 2>&4 1>&3' 0 1 2 3
#exec 1>${TEST_LOG} 2>&1

source "scripts/utils.sh"

trap ctrl_c INT

function ctrl_c() {
  docker-compose -f docker/docker-compose.yml down
  exit 1
}

NETWORK=$(docker network ls --filter name=rif-relay-testing -q)
if [ -z "${NETWORK}" ]; then
        echo "Creating network rif-relay-testing"
        docker network create rif-relay-testing
fi

run_test_suite_against_docker $TEST_SUITE_6
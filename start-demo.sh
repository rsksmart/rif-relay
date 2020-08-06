#!/bin/bash -e

PORT=2222
WEB_PORT=5555

if [ "$1" == "help" ]; then

echo Usage:
echo "  $0 [reset|dev] - start HttpRelayServer and Counter demo web app. With reset: deploy fresh contracts. With dev: start in development mode."
exit 1

else
	echo "use '$0 help' for usage."
fi

# Shutdown the relay server on exit
function onexit() {
	echo onexit
	pkill -f RelayHttpServer
}

trap onexit EXIT

# Working dir
dir=`dirname $0`
root=`cd $dir;pwd`

# Build the relay server
cd $root
gobin=$root/build/server/bin/
export GOPATH=$root/server/:$root/build/server
echo "Using GOPATH=" $GOPATH
./scripts/extract_abi.js
make -C server

# Kill any existing relay server instances
pkill -f RelayHttpServer && echo kill old relayserver

# Need fresh contracts?
if [ "$1" == "reset" ]; then
	rm -f $root/src/js/demo/app/config.json
fi

# Migrate / acquire existing contracts and find the RPC node url
cd $root/src/js/demo/scripts/
migration=`npx truffle exec migrate.js --network rsk | tee /dev/stderr`
relayhubaddress=`echo $migration | grep -o "RelayHub address - 0x[0-9A-Fa-f]*" | grep -o "0x.*"`
counteraddress=`echo $migration | grep -o "Counter address - 0x[0-9A-Fa-f]*" | grep -o "0x.*"`
noderpc=`echo $migration | grep -o "Node RPC host - http://[^ ]*" | grep -o "http://.*"`
cd $root

# Find the local ip address
localhost=`ip a | grep eth | grep -o 'inet \([0-9]\{0,3\}\.\)\{3\}[0-9]\{0,3\}' | grep -o [0-9].*`

# Set the demo app config
echo "{ \"rpcHost\": \"$noderpc\", \"contractAddress\": \"$counteraddress\" }" > $root/src/js/demo/app/config.json

# Build the demo app (only when not in development mode)
if [ "$1" != "dev" ]; then
	cd $root/src/js/demo
	npx webpack-cli --config webpack.config.js
	cd $root
fi

if [ -z "$relayhubaddress" ]; then
echo "FATAL: failed to detect RelayHub address"
exit 1
fi

if [ -z "$counteraddress" ]; then
echo "FATAL: failed to detect Counter address"
exit 1
fi

relayurl=http://$localhost:$PORT

startrelay="$gobin/RelayHttpServer --Url $relayurl --Port $PORT --RelayHubAddress $relayhubaddress --EthereumNodeUrl $noderpc --Workdir $root/build/server"

$startrelay > /dev/null 2> /dev/null &

sleep 1

./scripts/fundrelay.js $relayhubaddress $relayurl 0 $noderpc
./scripts/fundcontract.js $relayhubaddress $counteraddress 0 $noderpc

if [ "$1" != "dev" ]; then
	npx serve $root/src/js/demo/public -l $WEB_PORT
else
	npx webpack-dev-server --context src/js/demo/ --config src/js/demo/webpack.config.js --content-base src/js/demo/public/ --host 0.0.0.0 --port $WEB_PORT --watch --progress --watch-poll 1000
fi

exit 0

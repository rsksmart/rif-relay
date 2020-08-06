#!/bin/bash

localhost=111.111.111.111 # Public facing IP of relay goes here
port=2222

relayhubaddress=0xXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX # Replace this with relayhub address

nodeip=34.246.194.91 # Replace this with RSK node's IP address
nodeport=4444 # Replace this with RSK node's JSON-RPC port

# From here, everything should remain as is

relayurl=http://$localhost:$port
noderpc=http://$nodeip:$nodeport

workdir=`readlink -f $0`
workdir=`dirname $workdir`

$workdir/RelayHttpServer --Url $relayurl --Port $port --RelayHubAddress $relayhubaddress --EthereumNodeUrl $noderpc --Workdir $workdir >> $workdir/relay.log 2>&1 &

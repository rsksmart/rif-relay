#!/bin/bash -e

ROOTDIR=`dirname $0`
ROOTDIR=`readlink -f $ROOTDIR`
REPO="https://github.com/rsksmart/rskj.git"
SRCDIR="`pwd`/src"
TAG="PAPYRUS-2.1.0"

cd $ROOTDIR

if [ ! -d "$SRCDIR" ]; then
	git clone $REPO $SRCDIR
	cd $SRCDIR
	git checkout $TAG
	./configure.sh
	mkdir -p ~/.gradle
	export GRADLE_USER_HOME=`readlink -f ~/.gradle`
	./gradlew build -x test
	cd $ROOTDIR
fi

JARPATH="$SRCDIR/rskj-core/build/libs"
JAR=`ls $JARPATH | grep all\\.jar`

mkdir -p db

IFACE="eth0"
LOCALIP=`ip a | grep $IFACE | grep inet | sed 's/ *inet \(.*\)\/.*$/\1/'`

echo ""
echo "******************** STARTING NODE *********************"
echo "************* RPC TO BE SET ON IP $LOCALIP *************"

java -Drsk.conf.file=./node.conf -Dlogback.configurationFile=./log.conf.xml \
	-Ddatabase.dir=./db \
	-Drpc.providers.web.http.hosts.0=localhost \
	-Drpc.providers.web.http.hosts.1=$LOCALIP \
	-jar $JARPATH/$JAR co.rsk.Start --regtest

#java -Drsk.conf.file=./node.conf \
#	-Ddatabase.dir=./db \
#	-Drpc.providers.web.http.hosts.0=localhost \
#	-Drpc.providers.web.http.hosts.1=$LOCALIP \
#	-jar $JARPATH/$JAR co.rsk.Start --regtest

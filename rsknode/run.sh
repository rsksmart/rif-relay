#!/bin/bash -e

DOCKNAME=rsknode

# Silence the output of build if image already exists (and no VERBOSE=1)
# since long build is usually the first one
if [ -z "$VERBOSE" ]; then docker images|grep -q $DOCKNAME && BQUIET=-q; fi

DOCK=`dirname $0`

test -n "$BQUIET" && printf "\r Rebuilding docker image (VERBOSE=1 to show).. \r"
docker build $BQUIET -t $DOCKNAME $DOCK
test -n "$BQUIET" && printf "\r                                               \r"

TMP_PASSWD=`readlink -f $DOCK/tmp.passwd`
echo $USER:x:$UID:$UID:$USER:/:/bin/bash > $TMP_PASSWD

FOLDERS=""
FOLDERS+=" -v `readlink -f $DOCK/home`:$HOME"
mkdir -p $DOCK/home

ENVVARS="-e HOME=$HOME -e USER=$USER"
TTY="-ti"
DOCK_PORTS="-p 4444:4444"

RSKJSCRIPT=`readlink -f $DOCK/rskj.sh`
NODECONF=`readlink -f $DOCK/node.conf`
LOGCONF=`readlink -f $DOCK/log.conf.xml`

function onexit() {
	rm -f $TMP_PASSWD
}

trap onexit EXIT

docker run -u $UID:$GID  \
	--name $DOCKNAME \
	$DOCK_PORTS \
	$ENVVARS --rm $TTY -v $TMP_PASSWD:/etc/passwd \
	-v $RSKJSCRIPT:$HOME/rskj.sh \
	-v $NODECONF:$HOME/node.conf \
	-v $LOGCONF:$HOME/log.conf.xml \
	$FOLDERS \
	-w $HOME $DOCKNAME ./rskj.sh

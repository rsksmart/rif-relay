# Running

To run the RSKj container please use the following command:

```bash
docker run -p 127.0.0.1:4444:4444 -p 127.0.0.1:4445:4445  --name enveloping-rskj -it -v $PWD/logback.xml:/etc/rsk/logback.xml -v $PWD/node.conf:/etc/rsk/node.conf rsksmart/rskj:IRIS-3 --regtest
```

You could also use docker-compose:

```
docker-compose up -d
```

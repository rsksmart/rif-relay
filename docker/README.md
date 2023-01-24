# Running

To run the RSKj container please use the following command:

```bash
docker run -d -p 127.0.0.1:4444:4444 -p 127.0.0.1:4445:4445  --name enveloping-rskj-hop-4.1.1 -it -v $PWD/docker/logback.xml:/etc/rsk/logback.xml -v $PWD/docker/node.conf:/etc/rsk/node.conf rsksmart/rskj:HOP-4.1.1 --regtest
```

You could also use docker-compose:

```
docker-compose up --build -d
```


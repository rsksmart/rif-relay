# Running

To run the RSKj container please use the following command:

```bash
docker run -d -p 127.0.0.1:4444:4444 -p 127.0.0.1:4445:4445  --name relay-rskj-vetiver-9.0.4 -it -v $PWD/docker/logback.xml:/etc/rsk/logback.xml -v $PWD/docker/node.conf:/etc/rsk/node.conf rsksmart/rskj:VETIVER-9.0.4 --regtest
```

You could also use docker-compose:

```
docker-compose up --build -d
```


# Building

To build the default `PAPYRUS-2.1.0`, run

```
docker build -t rskj:2.1.0-PAPYRUS .
```

To build a different version, say `LOREMIPSUM-42.0.0`, use instead

```
docker build \
    --build-arg rskj_version=42.0.0 \
    --build-arg rskj_codename=LOREMIPSUM \
    -t rskj:42.0.0-LOREMIPSUM .
```

# Running

To run, use the recently generated tag (`-t` parameter for `docker
build`):

```
docker run -p 127.0.0.1:4444:4444 rskj:2.1.0-PAPYRUS --regtest
```

`--regtest` can be modified to any other of the networks or parameters
supported by the rskj binary.

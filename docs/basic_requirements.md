# Basic requirements
## Typescript

One of the main programming languages in the project is `typescript`. [Here](https://www.typescriptlang.org/#installation) are the instructions for installing it.

## Yarn

As package manager, we are using `yarn` version `v1.22.0`.

For installing it, you can follow the instructions in the Yarn's [site](https://yarnpkg.com/getting-started/install) and check if it is installed by running `yarn version`.

## Node & NPM

The current version of `Node` is `v12.18.3`.

For installing it, you can follow the instructions in the Node's [site](https://nodejs.org/en/) and check if it is installed by running `node -v`.

The `Node package manager` or `NPM` we use for managing node packages is NPM version `6.14.6`.

## Npx & Truffle

An important tool we use for interacting with blockchain is `Truffle` version `v5.0.33`.

You can follow the installation guide in the official [site](https://www.trufflesuite.com/truffle)

All the command we run with truffle use the prefix `npx`. This is to execute node packages using the project's version of `NPM`.

For checking if it's installed run `npx truffle version`

The configuration we use is in the `truffle.js` file. For details about this file and how to use it, please redirect to the Truffle's site.

## Docker

We recommend following the official [site](https://docs.docker.com/get-docker/) for installing Docker and keeping upgrade it.

You need to install `docker` and `docker-compose`

### Running on macOS
To run the project using Docker on a Mac, you must follow these steps or the scripts and web apps won't work.

- Patch `readlink`
The startup scripts assume that GNU's `readlink` command is available. But MacOS ships with BSD's `readlink`, which is incompatible with GNU's version. So you must patch `readlink`. This can be done as follows:

```
brew install coreutils
ln -s /usr/local/bin/greadlink /usr/local/bin/readlink
```

After this step, you must make sure that your `PATH` variable gives priority to `/usr/local/bin` over `/usr/bin`. You can do it with `which readlink`, which should output `/usr/local/bin/readlink`. Alternatively try executing `readlink -f .`, if it works you're ok.
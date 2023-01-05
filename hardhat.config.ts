import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import { HttpNetworkUserConfig } from 'hardhat/types';
import '@nomiclabs/hardhat-ethers';

const DEFAULT_MNEMONIC =
  'stuff slice staff easily soup parent arm payment cotton trade scatter struggle';
const { PK, MNEMONIC } = process.env;
const sharedNetworkConfig: HttpNetworkUserConfig = {};
if (PK) {
  sharedNetworkConfig.accounts = [PK];
} else {
  sharedNetworkConfig.accounts = {
    mnemonic: MNEMONIC || DEFAULT_MNEMONIC,
  };
}

const config: HardhatUserConfig = {
  // paths: {
  //   sources: './node_modules/@rsksmart/rif-relay-contracts/contracts'
  // },
  solidity: {
    compilers: [
      {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          outputSelection: {
            '*': {
              '*': ['storageLayout'],
            },
          },
        },
      },
    ],
  },
  networks: {
    regtest: {
      url: 'http://localhost:4444',
      chainId: 33,
    },
    testnet: {
      ...sharedNetworkConfig,
      url: 'https://public-node.testnet.rsk.co',
      chainId: 31,
    },
  },
  typechain: {
    target: 'ethers-v5',
    outDir: 'typechain-types',
  },
  /* contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: false,
  }*/
  mocha: {
    timeout: 20000,
  },
};

export default config;

import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-ethers';
import nodeConfig from 'config';

const CONFIG_BLOCKCHAIN = 'blockchain';
const CONFIG_RSK_URL = 'rskNodeUrl';

const getRskNodeUrl = () =>
  nodeConfig.get<string>(`${CONFIG_BLOCKCHAIN}.${CONFIG_RSK_URL}`);

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
      url: getRskNodeUrl(),
      chainId: 33,
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

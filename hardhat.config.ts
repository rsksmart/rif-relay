import { HardhatUserConfig, subtask } from 'hardhat/config';
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names';
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
      gasPrice: 1, //RSKj on startup returns 0 gasPrice on first tx.
    },
  },
  typechain: {
    target: 'ethers-v5',
    outDir: 'typechain-types',
  },
};

// Apple Silicon without Rosetta cannot run the native solc 0.6.12 binary.
// Point SOLCJS_PATH at a solc-js 0.6.12 soljson.js to compile with it instead.
const solcJsPath = process.env['SOLCJS_PATH'];
if (solcJsPath) {
  subtask(
    TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
    async (args: { solcVersion: string }, _hre, runSuper) =>
      args.solcVersion === '0.6.12'
        ? {
            compilerPath: solcJsPath,
            isSolcJs: true,
            version: '0.6.12',
            longVersion: '0.6.12+commit.27d51765',
          }
        : runSuper(args)
  );
}

export default config;

require('ts-node/register/transpile-only')

var HDWalletProvider = require('@truffle/hdwallet-provider')
var mnemonic = 'digital unknown jealous mother legal hedgehog save glory december universe spread figure custom found six'

const secretMnemonicFile = './secret_mnemonic'
const fs = require('fs')
let secretMnemonic
if (fs.existsSync(secretMnemonicFile)) {
  secretMnemonic = fs.readFileSync(secretMnemonicFile, { encoding: 'utf8' })
}

module.exports = {
  networks: {
    coverage: { // coverage/trace provider. note that it currently can't run extrnal-process relay.
      provider: require('./coverage-prov.js'),
      verbose: process.env.VERBOSE,
      network_id: '*'
    },
    development: {
      verbose: process.env.VERBOSE,
      host: '127.0.0.1',
      port: 4444,
      network_id: 33,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    },
    rskdocker: {
      verbose: process.env.VERBOSE,
      host: 'enveloping-rskj',
      port: 4444,
      network_id: 33,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    },
    rsk: {
      verbose: process.env.VERBOSE,
      host: 'rsk-node',
      port: 4444,
      network_id: 33,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    },
    rsktestnet: {
      provider: function () {
        return new HDWalletProvider(mnemonic, 'https://public-node.testnet.rsk.co')
      },
      network_id: 31,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    },
    rskmainnet: {
      provider: function () {
        return new HDWalletProvider(secretMnemonic, 'https://public-node.rsk.co')
      },
      network_id: 30,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    }
  },
  mocha: {
    slow: 1000,
    reporter: 'eth-gas-reporter',
    reporterOptions: {
      currency: 'USD',
      onlyCalledMethods: true,
      showTimeSpent: true,
      excludeContracts: []
    }
  },
  compilers: {
    solc: {
      version: '0.6.12',
      settings: {
        evmVersion: 'istanbul',
        optimizer: {
          enabled: true,
          runs: 200 // Optimize for how many times you intend to run the code
        }
      }
    }
  }
}

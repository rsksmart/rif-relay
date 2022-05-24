require('ts-node/register/transpile-only');

var HDWalletProvider = require('@truffle/hdwallet-provider');
var mnemonic =
    'digital unknown jealous mother legal hedgehog save glory december universe spread figure custom found six';

const secretMnemonicFile = './secret_mnemonic';
const fs = require('fs');
let secretMnemonic;
if (fs.existsSync(secretMnemonicFile)) {
    secretMnemonic = fs.readFileSync(secretMnemonicFile, { encoding: 'utf8' });
}

module.exports = {
    contracts_directory: 'node_modules/@rsksmart/rif-relay-contracts/contracts',
    migrations_directory:
        'node_modules/@rsksmart/rif-relay-contracts/migrations',
    networks: {
        development: {
            verbose: process.env.VERBOSE,
            host: '127.0.0.1',
            port: 4444,
            network_id: 33,
            gas: 6300000,
            gasPrice: 60000000 // 0.06 gwei
        },
        regtest: {
            verbose: process.env.VERBOSE,
            host: '127.0.0.1',
            port: 4444,
            network_id: 33,
            gas: 6300000,
            gasPrice: 60000000 // 0.06 gwei
        },
        testnet: {
            provider: function () {
                return new HDWalletProvider(
                    mnemonic,
                    'https://public-node.testnet.rsk.co'
                );
            },
            network_id: 31,
            gas: 6300000,
            gasPrice: 60000000 // 0.06 gwei
        },
        mainnet: {
            provider: function () {
                return new HDWalletProvider(
                    secretMnemonic,
                    'https://public-node.rsk.co'
                );
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
            src: 'node_modules/@rsksmart/rif-relay-contracts/contracts',
            currency: 'USD',
            onlyCalledMethods: true,
            showTimeSpent: true,
            excludeContracts: []
        },
        // value in ms 1_800_000 (= 1000 * 60 * 30 = 30 minutes), since that the default value 300_000 (= 5 mins) isn't enough
        before_timeout: 1800000, // for before and before_all methods
        timeout: 1800000 // for the tests
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
};

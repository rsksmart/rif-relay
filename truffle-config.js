require('ts-node/register/transpile-only')

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  networks: {
    testing: {
      verbose: process.env.VERBOSE,
      host: 'rsk-node',
      port: 4444,
      network_id: 33,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    },
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

import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (args, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
export default {
  solidity: {
    version: '0.6.12',
    settings: {
      evmVersion: 'istanbul',
      optimizer: {
        enabled: true,
        runs: 200 // Optimize for how many times you intend to run the code
      }
    }
  },
  networks: {
    rsk: {
      verbose: process.env.VERBOSE,
      url: 'http://localhost:4444',
      network_id: 33,
      gas: 6300000,
      gasPrice: 60000000 // 0.06 gwei
    }
  },
  mocha: {
    slow: 1000
    // reporter: 'eth-gas-reporter',
    // reporterOptions: {
    //   currency: 'USD',
    //   onlyCalledMethods: true,
    //   showTimeSpent: true,
    //   excludeContracts: []
    // }
  }
}

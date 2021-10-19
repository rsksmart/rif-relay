// Primary contracts
const RelayHub = artifacts.require('RelayHub')
const Penalizer = artifacts.require('Penalizer')
const SmartWallet = artifacts.require('SmartWallet')
const SmartWalletFactory = artifacts.require('SmartWalletFactory')
const DeployVerifier = artifacts.require('DeployVerifier')
const RelayVerifier = artifacts.require('RelayVerifier')
const TestToken = artifacts.require('TestToken')

// For testing purposes
const SampleRecipient = artifacts.require('TestRecipient')

// For CustomSmartWallet support
const CustomSmartWallet = artifacts.require('CustomSmartWallet')
const CustomSmartWalletFactory = artifacts.require('CustomSmartWalletFactory')
const CustomSmartWalletDeployVerifier = artifacts.require('CustomSmartWalletDeployVerifier')

module.exports = async function (deployer) {
  await deployer.deploy(RelayHub, 4, 4, 4, 4)
  await deployer.deploy(Penalizer, RelayHub.address)

  const relayHub = await new web3.eth.Contract(RelayHub.abi, RelayHub.address)
  await relayHub.methods.setPenalizer(Penalizer.address).send({ from: await relayHub.methods.owner().call() })

  await deployer.deploy(SmartWallet)
  await deployer.deploy(SmartWalletFactory, SmartWallet.address)
  await deployer.deploy(DeployVerifier, SmartWalletFactory.address)
  await deployer.deploy(RelayVerifier, SmartWalletFactory.address)

  const smartWalletRelayVerifierAddress = RelayVerifier.address

  await deployer.deploy(CustomSmartWallet)
  await deployer.deploy(CustomSmartWalletFactory, CustomSmartWallet.address)
  await deployer.deploy(CustomSmartWalletDeployVerifier, CustomSmartWalletFactory.address)
  await deployer.deploy(RelayVerifier, CustomSmartWalletFactory.address)

  const customSmartWalletRelayVerifierAddress = RelayVerifier.address

  await deployer.deploy(TestToken)
  await deployer.deploy(SampleRecipient)

  console.log('Done! Summary:')

  console.log('|===================================|============================================|')
  console.log('| Contract                          | Address                                    |')
  console.log('|===================================|============================================|')
  console.log(`| RelayHub                          | ${RelayHub.address} |`)
  console.log(`| Penalizer                         | ${Penalizer.address} |`)
  console.log('| Smart Wallet Contracts ========================================================|')
  console.log(`| SmartWallet                       | ${SmartWallet.address} |`)
  console.log(`| SmartWalletFactory                | ${SmartWalletFactory.address} |`)
  console.log(`| SmartWalletDeployVerifier         | ${DeployVerifier.address} |`)
  console.log(`| SmartWalletRelayVerifier          | ${smartWalletRelayVerifierAddress} |`)
  console.log('| Custom Smart Wallet Contracts =================================================|')
  console.log(`| CustomSmartWallet                 | ${CustomSmartWallet.address} |`)
  console.log(`| CustomSmartWalletFactory          | ${CustomSmartWalletFactory.address} |`)
  console.log(`| CustomSmartWalletDeployVerifier   | ${CustomSmartWalletDeployVerifier.address} |`)
  console.log(`| CustomSmartWalletRelayVerifier    | ${customSmartWalletRelayVerifierAddress} |`)
  console.log('| Testing Contracts =============================================================|')
  console.log(`| SampleRecipient                   | ${SampleRecipient.address} |`)
  console.log(`| TestToken                         | ${TestToken.address} |`)
  console.log('|===================================|============================================|\n')
}

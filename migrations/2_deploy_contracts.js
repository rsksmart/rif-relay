const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const SampleRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')
const ProxyFactory = artifacts.require('ProxyFactory')
const DeployPaymaster = artifacts.require('DeployPaymaster')
const RelayPaymaster = artifacts.require('RelayPaymaster')

module.exports = async function (deployer) {
  await deployer.deploy(StakeManager)
  await deployer.deploy(Penalizer)
  await deployer.deploy(RelayHub, StakeManager.address, Penalizer.address, 0, 0, 0, 0, 0, 0, 0)
  await deployer.deploy(SampleRecipient)
  // Template of the smart wallets to create with the factory
  await deployer.deploy(SmartWallet)
  // Factory to create Smart Wallets
  await deployer.deploy(ProxyFactory, SmartWallet.address)
  await deployer.deploy(DeployPaymaster, ProxyFactory.address)
  await deployer.deploy(RelayPaymaster)
}

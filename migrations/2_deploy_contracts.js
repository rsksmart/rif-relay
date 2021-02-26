const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const SampleRecipient = artifacts.require('TestRecipient')
const SmartWallet = artifacts.require('SmartWallet')
const ProxyFactory = artifacts.require('ProxyFactory')
const SimpleSmartWallet = artifacts.require('SimpleSmartWallet')
const SimpleProxyFactory = artifacts.require('SimpleProxyFactory')
const DeployVerifier = artifacts.require('DeployVerifier')
const RelayVerifier = artifacts.require('RelayVerifier')

module.exports = async function (deployer) {
  await deployer.deploy(StakeManager, 0)
  await deployer.deploy(Penalizer)
  await deployer.deploy(RelayHub, StakeManager.address, Penalizer.address, 0, 0, 0, 0, 0)
  await deployer.deploy(SampleRecipient)
  // Template of the smart wallets to create with the factory
  await deployer.deploy(SmartWallet)
  // Factory to create Smart Wallets
  await deployer.deploy(ProxyFactory, SmartWallet.address)
  await deployer.deploy(SimpleSmartWallet)
  await deployer.deploy(SimpleProxyFactory, SimpleSmartWallet.address)
  await deployer.deploy(DeployVerifier, ProxyFactory.address)
  await deployer.deploy(RelayVerifier, ProxyFactory.address)
}

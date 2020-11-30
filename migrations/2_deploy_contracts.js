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
  await deployer.deploy(StakeManager)
  await deployer.deploy(Penalizer)
  await deployer.deploy(RelayHub, StakeManager.address, Penalizer.address, 0, 0, 0, 0, 0)
  await deployer.deploy(SampleRecipient)
  // Template of the smart wallets to create with the factory
  await deployer.deploy(SmartWallet)
  // Factory to create Smart Wallets
  // keccak256('2') = ad7c5bef027816a800da1736444fb58a807ef4c9603b7848673f7e3a68eb14a5
  // ProxyFactory(SmartWalletTemplate:address, versionHash:bytes32)
  await deployer.deploy(ProxyFactory, SmartWallet.address, '0xad7c5bef027816a800da1736444fb58a807ef4c9603b7848673f7e3a68eb14a5')
  await deployer.deploy(SimpleSmartWallet)
  await deployer.deploy(SimpleProxyFactory, SimpleSmartWallet.address, '0xad7c5bef027816a800da1736444fb58a807ef4c9603b7848673f7e3a68eb14a5')
  await deployer.deploy(DeployVerifier, ProxyFactory.address)
  await deployer.deploy(RelayVerifier, ProxyFactory.address)
}

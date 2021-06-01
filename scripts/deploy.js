// We require the Hardhat Runtime Environment explicitly here. This is optional 
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );

  console.log("Account balance:", (await deployer.getBalance()).toString());



  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile 
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const Penalizer = await hre.ethers.getContractFactory("Penalizer");
  const penalizer = await Penalizer.deploy();
  await penalizer.deployed();
  console.log("Penalizer deployed to:", penalizer.address);
  console.log('Transaction Hash:', penalizer.deployTransaction.hash);

  const RelayHub = await hre.ethers.getContractFactory("RelayHub");
  const relayHub = await RelayHub.deploy(penalizer.address, 1, 1, 1, 1, 1);
  await relayHub.deployed();
  console.log("RelayHub deployed to:", relayHub.address);
  console.log('Transaction Hash:', relayHub.deployTransaction.hash);

  const SmartWallet = await hre.ethers.getContractFactory("SmartWallet");
  const smartWallet = await SmartWallet.deploy();
  await smartWallet.deployed();
  console.log("SmartWallet deployed to:", smartWallet.address);
  console.log('Transaction Hash:', smartWallet.deployTransaction.hash);

  const SmartWalletFactory = await hre.ethers.getContractFactory("SmartWalletFactory");
  const smartWalletFactory = await SmartWalletFactory.deploy(smartWallet.address);
  await smartWalletFactory.deployed();
  console.log("SmartWalletFactory deployed to:", smartWalletFactory.address);
  console.log('Transaction Hash:', smartWalletFactory.deployTransaction.hash);

  const DeployVerifier = await hre.ethers.getContractFactory("DeployVerifier");
  const deployVerifier = await DeployVerifier.deploy(smartWalletFactory.address);
  await deployVerifier.deployed();
  console.log("DeployVerifier deployed to:", deployVerifier.address);
  console.log('Transaction Hash:', deployVerifier.deployTransaction.hash);

  const RelayVerifier = await hre.ethers.getContractFactory("RelayVerifier");
  const relayVerifier = await RelayVerifier.deploy(smartWalletFactory.address);
  await relayVerifier.deployed();
  console.log("RelayVerifier deployed to:", relayVerifier.address);
  console.log('Transaction Hash:', relayVerifier.deployTransaction.hash);

  const CustomSmartWallet = await hre.ethers.getContractFactory("CustomSmartWallet");
  const customSmartWallet = await CustomSmartWallet.deploy();
  await customSmartWallet.deployed();
  console.log("CustomSmartWallet deployed to:", customSmartWallet.address);
  console.log('Transaction Hash:', customSmartWallet.deployTransaction.hash);

  const CustomSmartWalletFactory = await hre.ethers.getContractFactory("CustomSmartWalletFactory");
  const customSmartWalletFactory = await CustomSmartWalletFactory.deploy(customSmartWallet.address);
  await customSmartWalletFactory.deployed();
  console.log("CustomSmartWalletFactory deployed to:", customSmartWalletFactory.address);
  console.log('Transaction Hash:', customSmartWalletFactory.deployTransaction.hash);

  const CustomSmartWalletDeployVerifier = await hre.ethers.getContractFactory("CustomSmartWalletDeployVerifier");
  const customSmartWalletDeployVerifier = await CustomSmartWalletDeployVerifier.deploy(customSmartWalletFactory.address);
  await customSmartWalletDeployVerifier.deployed();
  console.log("CustomSmartWalletDeployVerifier deployed to:", customSmartWalletDeployVerifier.address);
  console.log('Transaction Hash:', customSmartWalletDeployVerifier.deployTransaction.hash);

  const CustomRelayVerifier = await hre.ethers.getContractFactory("RelayVerifier");
  const customRelayVerifier = await CustomRelayVerifier.deploy(customSmartWalletFactory.address);
  await customRelayVerifier.deployed();
  console.log("RelayVerifier deployed to:", customRelayVerifier.address);
  console.log('Transaction Hash:', customRelayVerifier.deployTransaction.hash);

  const SampleRecipient = await hre.ethers.getContractFactory("TestRecipient");
  const sampleRecipient = await SampleRecipient.deploy();
  await sampleRecipient.deployed();
  console.log("SampleRecipient deployed to:", sampleRecipient.address);
  console.log('Transaction Hash:', sampleRecipient.deployTransaction.hash);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });


//   import {HardhatRuntimeEnvironment} from 'hardhat/types'; // this add the type from hardhat runtime environment
// import {DeployFunction} from 'hardhat-deploy/types'; // this add the type that a deploy function is expected to fullfil

// const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) { // the deploy function receive the hardhat runtime env as argument
//   const {deployments, getNamedAccounts} = hre; // we get the deployments and getNamedAccounts which are provided by hardhat-deploy
//   const {deploy} = deployments; // the deployments field itself contains the deploy function

//   const {deployer, tokenOwner} = await getNamedAccounts(); // we fetch the accounts. These can be configured in hardhat.config.ts as explained above

//   await deploy('Token', { // this will create a deployment called 'Token'. By default it will look for an artifact with the same name. the contract option allows you to use a different artifact
//     from: deployer, // deployer will be performing the deployment transaction
//     args: [tokenOwner], // tokenOwner is the address used as the first argument to the Token contract's constructor
//     log: true, // display the address and gas used in the console (not when run in test though)
//   });
// };
// export default func;
// func.tags = ['Token']; // this setup a tag so you can execute the script on its own (and its dependencies)
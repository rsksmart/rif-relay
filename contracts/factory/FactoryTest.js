const { expect } = require("chai");
const { ethers } = require("@nomiclabs/buidler");

describe("ProxyFactory", function() {
  it("Should deploy the Smart Wallet", async function() {

    const ForwarderTemplate = await ethers.getContractFactory("ForwarderTemplate");
    const forwarderInstance = await ForwarderTemplate.deploy();
    await forwarderInstance.deployed();

    const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
    const factory = await ProxyFactory.deploy(forwarderInstance.address);
    await factory.deployed();


    const PaymentToken = await ethers.getContractFactory("TutorialToken");
    const token = await PaymentToken.deploy();
    await token.deployed();
    const accounts = await ethers.getSigners();
    const owner = await accounts[0].getAddress();
    const recipient = await accounts[1].getAddress();
    const tokenAddr = token.address;
    const deployPrice = "1"; //1 token
    const logic = "0x0000000000000000000000000000000000000000";
    const initParams = "0xA598";
    const logicInitGas = ethers.utils.defaultAbiCoder.encode(["uint256"], ["0x0186A0"]);//100000
    let chargeEncoded = ethers.utils.defaultAbiCoder.encode(["uint256"], [deployPrice]);
    let tokenMint = "200";
    const swAddress = await factory.getSmartWalletAddress(owner, logic, initParams);
    const recipientCoins = await token.balanceOf(owner);
    console.log("Transfering tokens to undeployed Smart Wallet");
    await token.transfer(swAddress,tokenMint);
    const swTokens = await token.balanceOf(swAddress);

    console.log("");
    console.log("////////////////TEST PARAMS///////////////////////");
    console.log("//////////////////////////////////////////////////");
    console.log(`Forwarder library: ${await factory.masterCopy()}`);
    console.log(`Factory instance: ${factory.address}`);
    console.log(`Smart Wallet to create: ${swAddress}`);
    console.log(`owner: ${owner}`);
    console.log(`logic: ${logic}`);
    console.log(`token: ${tokenAddr}`);
    console.log(`recipient: ${recipient}`);
    console.log(`deployPrice: ${chargeEncoded}`);
    console.log(`initParams: ${initParams}`);
    console.log(`initGas: ${logicInitGas}`);
    console.log(`Initial Tokens of recipient: ${recipientCoins}`);
    console.log(`Initial Tokens of Smart Wallet: ${swTokens}`);
    console.log("//////////////////////////////////////////////////");
    console.log("//////////////////////////////////////////////////");

    let packedParams = "0x1910" + owner.slice(2, owner.length) + logic.slice(2, logic.length) +
    tokenAddr.slice(2, tokenAddr.length) + recipient.slice(2, recipient.length) +
    chargeEncoded.slice(2, chargeEncoded.length)+ logicInitGas.slice(2, logicInitGas.length)+
    initParams.slice(2, initParams.length);

    const toSign = ethers.utils.keccak256(packedParams);
    const toSignAsBinaryArray = ethers.utils.arrayify(toSign);

    //PrivateKey of owner
    const ownerPrivKey=  accounts[0].provider._buidlerProvider._genesisAccounts[0].privateKey;
    const signingKey = new ethers.utils.SigningKey(ownerPrivKey);
    const signature = signingKey.signDigest(toSignAsBinaryArray);
    const signatureCollapsed = ethers.utils.joinSignature(signature);

    let execution = await factory.connect(accounts[0]).delegateUserSmartWalletCreation(owner, logic, tokenAddr, recipient, deployPrice, logicInitGas,initParams, signatureCollapsed);
    //console.log(execution);

  });

  it("Should fail on second try of deploying same Smart Wallet", async function() {

    const ForwarderTemplate = await ethers.getContractFactory("Forwarder");
    const forwarderInstance = await ForwarderTemplate.deploy();
    await forwarderInstance.deployed();

    const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
    const factory = await ProxyFactory.deploy(forwarderInstance.address);
    await factory.deployed();


    const PaymentToken = await ethers.getContractFactory("TutorialToken");
    const token = await PaymentToken.deploy();
    await token.deployed();
    const accounts = await ethers.getSigners();
    const owner = await accounts[0].getAddress();
    const recipient = await accounts[1].getAddress();
    const tokenAddr = token.address;
    const deployPrice = "1"; //1 token
    const logic = "0x0000000000000000000000000000000000000000";
    const initParams = "0xA598";
    const logicInitGas = ethers.utils.defaultAbiCoder.encode(["uint256"], ["0x0186A0"]);//100000
    let chargeEncoded = ethers.utils.defaultAbiCoder.encode(["uint256"], [deployPrice]);
    let tokenMint = "200";
    const swAddress = await factory.getSmartWalletAddress(owner, logic, initParams);
    const recipientCoins = await token.balanceOf(owner);
    console.log("Transfering tokens to undeployed Smart Wallet");
    await token.transfer(swAddress,tokenMint);
    const swTokens = await token.balanceOf(swAddress);

    console.log("");
    console.log("////////////////TEST PARAMS///////////////////////");
    console.log("//////////////////////////////////////////////////");
    console.log(`Forwarder library: ${await factory.masterCopy()}`);
    console.log(`Factory instance: ${factory.address}`);
    console.log(`Smart Wallet to create: ${swAddress}`);
    console.log(`owner: ${owner}`);
    console.log(`logic: ${logic}`);
    console.log(`token: ${tokenAddr}`);
    console.log(`recipient: ${recipient}`);
    console.log(`deployPrice: ${chargeEncoded}`);
    console.log(`initParams: ${initParams}`);
    console.log(`initGas: ${logicInitGas}`);
    console.log(`Initial Tokens of recipient: ${recipientCoins}`);
    console.log(`Initial Tokens of Smart Wallet: ${swTokens}`);
    console.log("//////////////////////////////////////////////////");
    console.log("//////////////////////////////////////////////////");

    let packedParams = "0x1910" + owner.slice(2, owner.length) + logic.slice(2, logic.length) +
    tokenAddr.slice(2, tokenAddr.length) + recipient.slice(2, recipient.length) +
    chargeEncoded.slice(2, chargeEncoded.length)+ logicInitGas.slice(2, logicInitGas.length)+
    initParams.slice(2, initParams.length);

    const toSign = ethers.utils.keccak256(packedParams);
    const toSignAsBinaryArray = ethers.utils.arrayify(toSign);

    //PrivateKey of owner
    const ownerPrivKey=  accounts[0].provider._buidlerProvider._genesisAccounts[0].privateKey;
    const signingKey = new ethers.utils.SigningKey(ownerPrivKey);
    const signature = signingKey.signDigest(toSignAsBinaryArray);
    const signatureCollapsed = ethers.utils.joinSignature(signature);

    let execution = await factory.connect(accounts[0]).delegateUserSmartWalletCreation(owner, logic, tokenAddr, recipient, deployPrice, logicInitGas,initParams, signatureCollapsed);
    console.log("Attempting second deployment");
    let error= null;
    //expect to trhow doesnt work

    try{
      await factory.delegateUserSmartWalletCreation(owner, logic, tokenAddr, recipient, deployPrice, logicInitGas,initParams, signatureCollapsed);
    }
    catch(err){
      error = err;
    }

    expect(error).not.to.be.null;
    

    //console.log(execution);

  });
});

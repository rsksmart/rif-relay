const { expect } = require("chai");
const { ethers } = require("@nomiclabs/buidler");

describe("ProxyFactory", function() {
  it("Should return the new greeting once it's changed", async function() {

    const ForwarderTemplate = await ethers.getContractFactory("ForwarderTemplate");
    const forwarderInstance = await ForwarderTemplate.deploy();
    await forwarderInstance.deployed();

    const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
    console.log(`Template instance: ${forwarderInstance.address}`);
    const factory = await ProxyFactory.deploy(forwarderInstance.address);
    await factory.deployed();
    console.log(`Master copy: ${await factory.masterCopy()}`);


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

    console.log(`owner: ${owner}`);
    console.log(`logic: ${logic}`);
    console.log(`token: ${tokenAddr}`);
    console.log(`recipient: ${recipient}`);
    console.log(`deployPrice: ${chargeEncoded}`);
    console.log(`initParams: ${initParams}`);
    console.log(`initGas: ${logicInitGas}`);

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

    const ownerCoins = await token.balanceOf(owner);
    console.log(`Tokens of owner: ${ownerCoins}`);
    const recipientCoins = await token.balanceOf(owner);
    console.log(`Tokens of recipient: ${recipientCoins}`);
    await token.transfer("0xe74f913deae28b251a0c9cb757c28f7d94f20e6c",tokenMint );
    const SWTOkens = await token.balanceOf("0xe74f913deae28b251a0c9cb757c28f7d94f20e6c");
    console.log(`Tokens of SWallet: ${SWTOkens}`);
    console.log("CALLING CONTRACT");
    let execution = await factory.connect(accounts[0]).delegateUserSmartWalletCreation(owner, logic, tokenAddr, recipient, deployPrice, logicInitGas,initParams, signatureCollapsed);
   // console.log(execution);

  });
});

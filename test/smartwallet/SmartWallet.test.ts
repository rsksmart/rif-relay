import { BaseProvider } from '@ethersproject/providers';
import { SmartWallet, SmartWalletFactory } from '@rsksmart/rif-relay-contracts';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { constants, Wallet } from 'ethers';
import { ethers as hardhat } from 'hardhat';
chai.use(chaiAsPromised);

//FIXME: This test is supposed to show that the setup works as expected.

describe('SmartWallet contract', function () {
  let smartWalletFactory: SmartWalletFactory;
  let provider: BaseProvider;
  let owner: Wallet;
  let smartWallet: SmartWallet;

  async function createSmartWalletFactory(owner: Wallet) {
    const smartWalletTemplateFactory = await hardhat.getContractFactory(
      'SmartWallet'
    );

    const smartWalletTemplate = await smartWalletTemplateFactory.deploy();

    const smartWalletFactoryFactory = await hardhat.getContractFactory(
      'SmartWalletFactory'
    );

    smartWalletFactory = await smartWalletFactoryFactory
      .connect(owner)
      .deploy(smartWalletTemplate.address);
  }

  function signData(
    dataTypesToSign: Array<string>,
    valuesToSign: Array<string | number>
  ) {
    const privateKey = Buffer.from(owner.privateKey.substring(2, 66), 'hex');
    const toSign = hardhat.utils.solidityKeccak256(
      dataTypesToSign,
      valuesToSign
    );
    const toSignAsBinaryArray = hardhat.utils.arrayify(toSign);
    const signingKey = new hardhat.utils.SigningKey(privateKey);
    const signature = signingKey.signDigest(toSignAsBinaryArray);

    return hardhat.utils.joinSignature(signature);
  }

  async function getAlreadyDeployedSmartWallet() {
    const smartWalletAddress = await smartWalletFactory.getSmartWalletAddress(
      owner.address,
      constants.AddressZero,
      0
    );

    return await hardhat.getContractAt('SmartWallet', smartWalletAddress);
  }

  beforeEach(async function () {
    const [, fundedAccount] = await hardhat.getSigners();

    provider = hardhat.provider;
    owner = hardhat.Wallet.createRandom().connect(provider);

    //Fund the owner
    await fundedAccount?.sendTransaction({
      to: owner.address,
      value: hardhat.utils.parseEther('1'),
    });
    await createSmartWalletFactory(owner);

    const dataTypesToSign = ['bytes2', 'address', 'address', 'uint256'];
    const valuesToSign = ['0x1910', owner.address, constants.AddressZero, 0];

    const signature = signData(dataTypesToSign, valuesToSign);

    await smartWalletFactory.createUserSmartWallet(
      owner.address,
      constants.AddressZero,
      '0',
      signature
    );

    smartWallet = await getAlreadyDeployedSmartWallet();
  });

  it('Should initialize a SmartWallet', async function () {
    expect(await smartWallet.isInitialized()).to.be.true;
  });
});

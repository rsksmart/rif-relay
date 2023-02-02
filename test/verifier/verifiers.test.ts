import { BaseProvider } from '@ethersproject/providers';
import { DeployVerifier } from '@rsksmart/rif-relay-contracts';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers as hardhat } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
// import { TestForwarder, TestTarget } from 'typechain-types';
import { Wallet, providers, constants } from 'ethers';
import {
  //   TEST_TOKEN_NAME,
  //   NON_REVERT_TEST_TOKEN_NAME,
  //   TETHER_TOKEN_NAME,
  //   INITIAL_SMART_WALLET_TOKEN_AMOUNT,
  //   TokenToTest,
  prepareToken,
  //   mintTokens,
  //   getLogArguments,
  //   TokenName,
} from '../smartwallet/utils';
import {
  //   createSmartWalletFactory,
  //   createSupportedSmartWallet,
  createEnvelopingRequest,
  //   getSuffixDataAndSignature,
  //   getSuffixData,
  //   SupportedSmartWallet,
  RSK_URL,
} from '../utils/TestUtils';
import {
  // RelayRequest,
  DeployRequest,
  //   INTERNAL_TRANSACTION_ESTIMATED_CORRECTION,
} from '@rsksmart/rif-relay-client';
// import {
//   getLocalEip712Signature,
//   TypedRequestData,
// } from '../utils/EIP712Utils';
import { SmartWalletFactory, TestToken } from 'typechain-types';

// const IS_DEPLOY_REQUEST = false;
const TOKEN_AMOUNT_TO_TRANSFER = 1;

chai.use(chaiAsPromised);

describe.only('Verifiers tests', function () {
  describe('Deploy verifier', function () {
    let provider: BaseProvider;
    let deployVerifier: DeployVerifier;
    let owner: Wallet;
    let testToken: TestToken;
    let relayHub: SignerWithAddress;
    let smartWalletFactory: SmartWalletFactory;

    before(function () {
      provider = new providers.JsonRpcProvider(RSK_URL);
    });

    beforeEach(async function () {
      console.log('test60');
      const [, /*fundedAccount,*/ localRelayHub] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = Wallet.createRandom().connect(provider);

      const hardHatSmartWalletFactory = await hardhat.getContractFactory(
        'SmartWallet'
      );
      const smartWalletTemplate = await hardHatSmartWalletFactory.deploy();

      console.log('test69');
      const hardHatWalletFactory = await hardhat.getContractFactory(
        'SmartWalletFactory'
      );
      console.log('test75');

      smartWalletFactory = await hardHatWalletFactory
        // .connect(owner)
        .deploy(smartWalletTemplate.address);

      console.log('test81');
      testToken = (await prepareToken('TestToken')) as TestToken;

      console.log('test84');
      const expectedAddress = await smartWalletFactory.getSmartWalletAddress(
        owner.address,
        constants.AddressZero,
        '0'
      );
      console.log('test85');
      await testToken.mint(TOKEN_AMOUNT_TO_TRANSFER + 10, expectedAddress);

      console.log('test88');

      const deployVerifierFactory = await hardhat.getContractFactory(
        'DeployVerifier'
      );
      deployVerifier = await deployVerifierFactory.deploy(
        smartWalletFactory.address
      );

      await deployVerifier.acceptToken(testToken.address);
    });

    it('Should succeed when the deploy is correct', async function () {
      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: 50000,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      console.log('deployRequest: ', deployRequest);

      const signature = '0x00';

      // await deployVerifier.verifyRelayedCall(deployRequest, signature);

      await expect(deployVerifier.verifyRelayedCall(deployRequest, signature))
        .not.to.be.rejected;
    });

    it.skip('Should fail if there is an  smartWallet already deployed at that address', async function () {
      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: 50000,
        },
        {
          callForwarder: smartWalletFactory.address,
        }
      ) as DeployRequest;

      console.log('deployRequest: ', deployRequest);

      const signature = '0x00';

      // await deployVerifier.verifyRelayedCall(deployRequest, signature);

      // await expect(deployVerifier.verifyRelayedCall(deployRequest, signature))
      //   .not.to.be.rejected;
      await deployVerifier.verifyRelayedCall(deployRequest, signature);
      await deployVerifier.verifyRelayedCall(deployRequest, signature);
    });

    it('Should fail if the balance is too low', async function () {
      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER + 100,
          tokenContract: testToken.address,
          tokenGas: 50000,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      console.log('deployRequest: ', deployRequest);

      const signature = '0x00';

      // await deployVerifier.verifyRelayedCall(deployRequest, signature);

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('revert balance too low');
    });

    it('Should fail if the token is not allowed', async function () {
      await deployVerifier.removeToken(testToken.address, 0);

      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: 50000,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      console.log('deployRequest: ', deployRequest);

      const signature = '0x00';

      // await deployVerifier.verifyRelayedCall(deployRequest, signature);

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Token contract not allowed');
    });

    it('Should fail if the factory is incorrect', async function () {
      const wrongFactory = constants.AddressZero;

      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: 50000,
        },
        {
          callForwarder: wrongFactory,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      console.log('deployRequest: ', deployRequest);

      const signature = '0x00';

      // await deployVerifier.verifyRelayedCall(deployRequest, signature);

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Invalid factory');
    });
  });
});

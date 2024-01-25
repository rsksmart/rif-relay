import { BaseProvider } from '@ethersproject/providers';
import { DeployVerifier, RelayVerifier } from '@rsksmart/rif-relay-contracts';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers as hardhat } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Wallet, providers, constants } from 'ethers';
import { prepareToken } from '../smartwallet/utils';
import {
  createEnvelopingRequest,
  createSupportedSmartWallet,
  deployContract,
  RSK_URL,
} from '../utils/TestUtils';
import { RelayRequest, DeployRequest } from '@rsksmart/rif-relay-client';
import {
  BoltzDeployVerifier,
  SmartWallet,
  SmartWalletFactory,
  TestSwap,
  TestToken,
} from 'typechain-types';

const TOKEN_AMOUNT_TO_TRANSFER = 1;
const SMART_WALLET_INDEX = '0';
const TOKEN_GAS = 50000;

chai.use(chaiAsPromised);

describe('Verifiers tests', function () {
  let rskProvider: BaseProvider;

  before(function () {
    rskProvider = new providers.JsonRpcProvider(RSK_URL);
  });

  describe('Deploy verifier', function () {
    let deployVerifier: DeployVerifier;
    let owner: Wallet;
    let testToken: TestToken;
    let relayHub: SignerWithAddress;
    let smartWalletFactory: SmartWalletFactory;

    beforeEach(async function () {
      const [, localRelayHub] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = Wallet.createRandom().connect(rskProvider);

      const hardHatSmartWalletFactory = await hardhat.getContractFactory(
        'SmartWallet'
      );
      const smartWalletTemplate = await hardHatSmartWalletFactory.deploy();

      const hardHatWalletFactory = await hardhat.getContractFactory(
        'SmartWalletFactory'
      );

      smartWalletFactory = await hardHatWalletFactory.deploy(
        smartWalletTemplate.address
      );

      testToken = (await prepareToken('TestToken')) as TestToken;

      const expectedAddress = await smartWalletFactory.getSmartWalletAddress(
        owner.address,
        constants.AddressZero,
        SMART_WALLET_INDEX
      );

      await testToken.mint(TOKEN_AMOUNT_TO_TRANSFER + 10, expectedAddress);

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
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(deployVerifier.verifyRelayedCall(deployRequest, signature))
        .not.to.be.rejected;
    });

    it('Should fail if there is a smartWallet already deployed at that address', async function () {
      await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        tokenContract: testToken.address,
        isCustomSmartWallet: false,
      });

      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Address already created');
    });

    it('Should fail if the token balance is too low', async function () {
      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER + 100,
          tokenContract: testToken.address,
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('balance too low');
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
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

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
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: wrongFactory,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Invalid factory');
    });
  });

  describe('Relay verifier', function () {
    let relayVerifier: RelayVerifier;
    let owner: Wallet;
    let testToken: TestToken;
    let relayHub: SignerWithAddress;
    let smartWalletFactory: SmartWalletFactory;
    let smartWallet: SmartWallet;

    async function prepareSmartWallet(testToken: TestToken) {
      const hardHatSmartWalletFactory = await hardhat.getContractFactory(
        'SmartWallet'
      );
      const smartWalletTemplate = await hardHatSmartWalletFactory.deploy();

      const hardHatSmartWalletFactoryFactory = await hardhat.getContractFactory(
        'SmartWalletFactory'
      );
      smartWalletFactory = await hardHatSmartWalletFactoryFactory.deploy(
        smartWalletTemplate.address
      );

      smartWallet = (await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        tokenContract: testToken.address,
        isCustomSmartWallet: false,
      })) as SmartWallet;

      await testToken.mint(TOKEN_AMOUNT_TO_TRANSFER + 10, smartWallet.address);

      return smartWallet;
    }

    beforeEach(async function () {
      const [, localRelayHub] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = Wallet.createRandom().connect(rskProvider);

      testToken = (await prepareToken('TestToken')) as TestToken;

      smartWallet = await prepareSmartWallet(testToken);

      const relayVerifierFactory = await hardhat.getContractFactory(
        'RelayVerifier'
      );
      relayVerifier = await relayVerifierFactory.deploy(
        smartWalletFactory.address
      );

      await relayVerifier.acceptToken(testToken.address);
    });

    it('Should succeed when the relay is correct', async function () {
      const relayRequest = createEnvelopingRequest(
        false,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWallet.address,
          callVerifier: relayVerifier.address,
        }
      ) as RelayRequest;

      const signature = '0x00';

      await expect(relayVerifier.verifyRelayedCall(relayRequest, signature)).not
        .to.be.rejected;
    });

    it('Should fail if the token balance is too low', async function () {
      const relayRequest = createEnvelopingRequest(
        false,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER + 100,
          tokenContract: testToken.address,
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWallet.address,
          callVerifier: relayVerifier.address,
        }
      ) as RelayRequest;

      const signature = '0x00';

      await expect(
        relayVerifier.verifyRelayedCall(relayRequest, signature)
      ).to.be.rejectedWith('balance too low');
    });

    it('Should fail if the token is not allowed', async function () {
      await relayVerifier.removeToken(testToken.address, 0);

      const relayRequest = createEnvelopingRequest(
        false,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: smartWallet.address,
          callVerifier: relayVerifier.address,
        }
      ) as RelayRequest;

      const signature = '0x00';

      await expect(
        relayVerifier.verifyRelayedCall(relayRequest, signature)
      ).to.be.rejectedWith('Token contract not allowed');
    });

    it('Should fail if the factory is incorrect', async function () {
      const wrongSmartWallet = await prepareSmartWallet(testToken);

      const relayRequest = createEnvelopingRequest(
        false,
        {
          relayHub: relayHub.address,
          from: owner.address,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
          tokenContract: testToken.address,
          tokenGas: TOKEN_GAS,
        },
        {
          callForwarder: wrongSmartWallet.address,
          callVerifier: relayVerifier.address,
        }
      ) as RelayRequest;

      const signature = '0x00';

      await expect(
        relayVerifier.verifyRelayedCall(relayRequest, signature)
      ).to.be.rejectedWith('SW different to template');
    });
  });

  describe('Boltz deploy verifier', function () {
    let deployVerifier: BoltzDeployVerifier;
    let owner: Wallet;
    let relayHub: SignerWithAddress;
    let smartWalletFactory: SmartWalletFactory;

    beforeEach(async function () {
      const [, localRelayHub] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = Wallet.createRandom().connect(rskProvider);

      const hardHatSmartWalletFactory = await hardhat.getContractFactory(
        'SmartWallet'
      );
      const smartWalletTemplate = await hardHatSmartWalletFactory.deploy();

      const hardHatWalletFactory = await hardhat.getContractFactory(
        'SmartWalletFactory'
      );

      smartWalletFactory = await hardHatWalletFactory.deploy(
        smartWalletTemplate.address
      );

      const deployVerifierFactory = await hardhat.getContractFactory(
        'BoltzDeployVerifier'
      );
      deployVerifier = await deployVerifierFactory.deploy(
        smartWalletFactory.address
      );
    });

    it('Should fail if there is a smartWallet already deployed at that address', async function () {
      await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        isCustomSmartWallet: false,
      });

      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Address already created');
    });

    it('Should fail if the factory is incorrect', async function () {
      const wrongFactory = constants.AddressZero;

      const deployRequest = createEnvelopingRequest(
        true,
        {
          relayHub: relayHub.address,
          from: owner.address,
        },
        {
          callForwarder: wrongFactory,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Invalid factory');
    });

    describe('Token', function () {
      let testToken: TestToken;

      beforeEach(async function () {
        const expectedAddress = await smartWalletFactory.getSmartWalletAddress(
          owner.address,
          constants.AddressZero,
          SMART_WALLET_INDEX
        );

        testToken = (await prepareToken('TestToken')) as TestToken;
        await testToken.mint(TOKEN_AMOUNT_TO_TRANSFER + 10, expectedAddress);
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
            tokenGas: TOKEN_GAS,
          },
          {
            callForwarder: smartWalletFactory.address,
            callVerifier: deployVerifier.address,
          }
        ) as DeployRequest;

        const signature = '0x00';

        await expect(deployVerifier.verifyRelayedCall(deployRequest, signature))
          .not.to.be.rejected;
      });

      it('Should fail if the token balance is too low', async function () {
        const deployRequest = createEnvelopingRequest(
          true,
          {
            relayHub: relayHub.address,
            from: owner.address,
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER + 100,
            tokenContract: testToken.address,
            tokenGas: TOKEN_GAS,
          },
          {
            callForwarder: smartWalletFactory.address,
            callVerifier: deployVerifier.address,
          }
        ) as DeployRequest;

        const signature = '0x00';

        await expect(
          deployVerifier.verifyRelayedCall(deployRequest, signature)
        ).to.be.rejectedWith('Token balance too low');
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
            tokenGas: TOKEN_GAS,
          },
          {
            callForwarder: smartWalletFactory.address,
            callVerifier: deployVerifier.address,
          }
        ) as DeployRequest;

        const signature = '0x00';

        await expect(
          deployVerifier.verifyRelayedCall(deployRequest, signature)
        ).to.be.rejectedWith('Token contract not allowed');
      });
    });

    describe('Native token', function () {
      let swap: TestSwap;
      let data: string;

      beforeEach(async function () {
        swap = await deployContract('TestSwap');
        data = swap.interface.encodeFunctionData('claim', [
          constants.HashZero,
          TOKEN_AMOUNT_TO_TRANSFER,
          constants.AddressZero,
          500,
        ]);
      });

      it('Should succeed when the deploy is correct', async function () {
        const deployRequest = createEnvelopingRequest(
          true,
          {
            relayHub: relayHub.address,
            from: owner.address,
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
            tokenGas: TOKEN_GAS,
            to: swap.address,
            data,
          },
          {
            callForwarder: smartWalletFactory.address,
            callVerifier: deployVerifier.address,
          }
        ) as DeployRequest;

        const signature = '0x00';

        await expect(deployVerifier.verifyRelayedCall(deployRequest, signature))
          .not.to.be.rejected;
      });

      it('Should fail if the token balance is too low', async function () {
        const deployRequest = createEnvelopingRequest(
          true,
          {
            relayHub: relayHub.address,
            from: owner.address,
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
            tokenGas: TOKEN_GAS,
          },
          {
            callForwarder: smartWalletFactory.address,
            callVerifier: deployVerifier.address,
          }
        ) as DeployRequest;

        const signature = '0x00';

        await expect(
          deployVerifier.verifyRelayedCall(deployRequest, signature)
        ).to.be.rejectedWith('Native balance too low');
      });

      it('Should fail if the token balance is too low (claim)', async function () {
        const deployRequest = createEnvelopingRequest(
          true,
          {
            relayHub: relayHub.address,
            from: owner.address,
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER + 10,
            tokenGas: TOKEN_GAS,
            to: swap.address,
            data,
          },
          {
            callForwarder: smartWalletFactory.address,
            callVerifier: deployVerifier.address,
          }
        ) as DeployRequest;

        const signature = '0x00';

        await expect(
          deployVerifier.verifyRelayedCall(deployRequest, signature)
        ).to.be.rejectedWith('Native balance too low');
      });
    });
  });
});

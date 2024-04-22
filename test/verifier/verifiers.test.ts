import { BaseProvider } from '@ethersproject/providers';
import {
  BoltzSmartWallet,
  BoltzSmartWalletFactory,
  DeployVerifier,
  MinimalBoltzDeployVerifier,
  MinimalBoltzRelayVerifier,
  MinimalBoltzSmartWalletFactory,
  RelayVerifier,
} from '@rsksmart/rif-relay-contracts';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers as hardhat } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Wallet, providers, constants } from 'ethers';
import { prepareToken } from '../smartwallet/utils';
import {
  addSwapHash,
  createDeployEnvelopingRequest,
  createRelayEnvelopingRequest,
  createSupportedSmartWallet,
  deployContract,
  RSK_URL,
} from '../utils/TestUtils';
import { RelayRequest, DeployRequest } from '@rsksmart/rif-relay-client';
import {
  BoltzDeployVerifier,
  MinimalBoltzSmartWallet,
  SmartWallet,
  SmartWalletFactory,
  TestSwap,
  TestToken,
} from 'typechain-types';

const TOKEN_AMOUNT_TO_TRANSFER = 1000000;
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

      const smartWalletTemplate = await deployContract<SmartWallet>(
        'SmartWallet'
      );

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
      const deployRequest = createDeployEnvelopingRequest(
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
        type: 'Default',
      });

      const deployRequest = createDeployEnvelopingRequest(
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
      const deployRequest = createDeployEnvelopingRequest(
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

      const deployRequest = createDeployEnvelopingRequest(
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

      const deployRequest = createDeployEnvelopingRequest(
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
      const smartWalletTemplate = await deployContract<SmartWallet>(
        'SmartWallet'
      );

      const hardHatSmartWalletFactoryFactory = await hardhat.getContractFactory(
        'SmartWalletFactory'
      );
      smartWalletFactory = await hardHatSmartWalletFactoryFactory.deploy(
        smartWalletTemplate.address
      );

      smartWallet = await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        tokenContract: testToken.address,
        type: 'Default',
      });

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
      const relayRequest = createRelayEnvelopingRequest(
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
      const relayRequest = createRelayEnvelopingRequest(
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

      const relayRequest = createRelayEnvelopingRequest(
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

      const relayRequest = createRelayEnvelopingRequest(
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
    let smartWalletFactory: BoltzSmartWalletFactory;
    let smartWalletAddress: string;

    beforeEach(async function () {
      const [, localRelayHub, funder] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = Wallet.createRandom().connect(rskProvider);

      const smartWalletTemplate = await deployContract<BoltzSmartWallet>(
        'BoltzSmartWallet'
      );

      const hardHatWalletFactory = await hardhat.getContractFactory(
        'BoltzSmartWalletFactory'
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

      smartWalletAddress = await smartWalletFactory.getSmartWalletAddress(
        owner.address,
        constants.AddressZero,
        SMART_WALLET_INDEX
      );
      await funder?.sendTransaction({
        to: smartWalletAddress,
        value: TOKEN_AMOUNT_TO_TRANSFER,
      });
      await deployVerifier.acceptContract(constants.AddressZero);
    });

    it('Should fail if there is a smartWallet already deployed at that address', async function () {
      await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        type: 'Default',
      });

      const deployRequest = createDeployEnvelopingRequest(
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

      const deployRequest = createDeployEnvelopingRequest(
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

    it('Should succeed if sponsored', async function () {
      const deployRequest = createDeployEnvelopingRequest(
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

      await expect(deployVerifier.verifyRelayedCall(deployRequest, signature))
        .not.to.be.rejected;
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
        const deployRequest = createDeployEnvelopingRequest(
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
        const deployRequest = createDeployEnvelopingRequest(
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

        const deployRequest = createDeployEnvelopingRequest(
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
        data = await addSwapHash({
          swap,
          amount: TOKEN_AMOUNT_TO_TRANSFER,
          claimAddress: smartWalletAddress,
          refundAddress: Wallet.createRandom().address,
          timelock: 500,
        });

        await deployVerifier.acceptContract(swap.address);
      });

      it('Should succeed when the deploy is correct', async function () {
        const deployRequest = createDeployEnvelopingRequest(
          {
            relayHub: relayHub.address,
            from: owner.address,
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER,
            tokenContract: constants.AddressZero,
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

      it('Should fail if the destination contract is not allowed', async function () {
        await deployVerifier.removeContract(swap.address, 1);

        const deployRequest = createDeployEnvelopingRequest(
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

        await expect(
          deployVerifier.verifyRelayedCall(deployRequest, signature)
        ).to.be.rejectedWith('Destination contract not allowed');
      });

      it('Should fail if the token balance is too low', async function () {
        const deployRequest = createDeployEnvelopingRequest(
          {
            relayHub: relayHub.address,
            from: owner.address,
            tokenAmount: TOKEN_AMOUNT_TO_TRANSFER * 2,
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
    });
  });

  describe('Minimal boltz deploy verifier', function () {
    let swap: TestSwap;
    let data: string;
    let owner: Wallet;
    let relayHub: SignerWithAddress;
    let deployVerifier: MinimalBoltzDeployVerifier;
    let smartWalletFactory: MinimalBoltzSmartWalletFactory;
    let refundAddress: string;
    const timelock = 500;

    beforeEach(async function () {
      const [, localRelayHub, funder] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      swap = await deployContract('TestSwap');

      await funder?.sendTransaction({
        to: swap.address,
        value: TOKEN_AMOUNT_TO_TRANSFER,
      });

      owner = Wallet.createRandom().connect(rskProvider);

      const smartWalletTemplate = await deployContract<MinimalBoltzSmartWallet>(
        'MinimalBoltzSmartWallet'
      );

      const hardHatWalletFactory = await hardhat.getContractFactory(
        'MinimalBoltzSmartWalletFactory'
      );

      smartWalletFactory = await hardHatWalletFactory.deploy(
        smartWalletTemplate.address
      );

      const deployVerifierFactory = await hardhat.getContractFactory(
        'MinimalBoltzDeployVerifier'
      );
      deployVerifier = await deployVerifierFactory.deploy(
        smartWalletFactory.address
      );
      const smartWalletAddress = await smartWalletFactory.getSmartWalletAddress(
        owner.address,
        constants.AddressZero,
        SMART_WALLET_INDEX
      );
      refundAddress = Wallet.createRandom().address;
      data = await addSwapHash({
        swap,
        amount: TOKEN_AMOUNT_TO_TRANSFER,
        claimAddress: smartWalletAddress,
        refundAddress,
        timelock,
      });

      await deployVerifier.acceptContract(swap.address);
    });

    it('Should fail if there is a smartWallet already deployed at that address', async function () {
      await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        type: 'MinimalBoltz',
        logicAddr: swap.address,
        initParams: data,
      });

      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
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
      ).to.be.rejectedWith('Address already created');
    });

    it('Should fail if the factory is incorrect', async function () {
      const wrongFactory = constants.AddressZero;

      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
          to: swap.address,
          data,
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

    it('Should fail if payment is with ERC20 token', async function () {
      const fakeToken = Wallet.createRandom();

      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
          to: swap.address,
          data,
          tokenContract: fakeToken.address,
          tokenAmount: 10000,
        },
        {
          callForwarder: smartWalletFactory.address,
          callVerifier: deployVerifier.address,
        }
      ) as DeployRequest;

      const signature = '0x00';

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('RBTC necessary for payment');
    });

    it('Should fail if not enough native token for payment', async function () {
      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
          to: swap.address,
          data,
          tokenAmount: TOKEN_AMOUNT_TO_TRANSFER + 3,
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

    it('Should fail if the destination contract is not allowed', async function () {
      await deployVerifier.removeContract(swap.address, 0);

      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
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
      ).to.be.rejectedWith('Destination contract not allowed');
    });

    it('Should succeed in sponsored transactions', async function () {
      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
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

    it('Should fail if the method is not allowed', async function () {
      data = swap.interface.encodeFunctionData('addSwap', [constants.HashZero]);

      const deployRequest = createDeployEnvelopingRequest(
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

      await expect(
        deployVerifier.verifyRelayedCall(deployRequest, signature)
      ).to.be.rejectedWith('Signature not allowed');
    });

    it('Should succeed destination contract provide enough balance (public method)', async function () {
      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
          to: swap.address,
          data,
          tokenAmount: 1,
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

    it('Should succeed destination contract provide enough balance (external method)', async function () {
      data = swap.interface.encodeFunctionData(
        'claim(bytes32,uint256,address,uint256)',
        [constants.HashZero, TOKEN_AMOUNT_TO_TRANSFER, refundAddress, timelock]
      );

      const deployRequest = createDeployEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
          to: swap.address,
          data,
          tokenAmount: 1,
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
  });

  describe('Minimal boltz relay verifier', function () {
    let owner: Wallet;
    let relayHub: SignerWithAddress;
    let relayVerifier: MinimalBoltzRelayVerifier;
    let smartWallet: BoltzSmartWallet;

    beforeEach(async function () {
      const [, localRelayHub] = await hardhat.getSigners();
      relayHub = localRelayHub as SignerWithAddress;

      owner = Wallet.createRandom().connect(rskProvider);

      const smartWalletTemplate = await deployContract<BoltzSmartWallet>(
        'BoltzSmartWallet'
      );

      const hardHatWalletFactory = await hardhat.getContractFactory(
        'BoltzSmartWalletFactory'
      );

      const smartWalletFactory = await hardHatWalletFactory.deploy(
        smartWalletTemplate.address
      );

      const relayVerifierFactory = await hardhat.getContractFactory(
        'MinimalBoltzRelayVerifier'
      );

      relayVerifier = await relayVerifierFactory.deploy(
        smartWalletFactory.address
      );

      smartWallet = await createSupportedSmartWallet({
        relayHub: relayHub.address,
        sender: relayHub,
        owner,
        factory: smartWalletFactory,
        type: 'Default',
      });
    });

    it('Should always fail', async function () {
      const relayRequest = createRelayEnvelopingRequest(
        {
          relayHub: relayHub.address,
          from: owner.address,
        },
        {
          callForwarder: smartWallet.address,
          callVerifier: relayVerifier.address,
        }
      ) as RelayRequest;

      const signature = '0x00';

      await expect(
        relayVerifier.verifyRelayedCall(relayRequest, signature)
      ).to.be.rejectedWith('Deploy request accepted only');
    });
  });
});

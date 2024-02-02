import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Wallet, constants, providers } from 'ethers';
import {
  UtilToken,
  SmartWalletFactory,
  Penalizer,
  RelayHub,
  SmartWallet,
  BoltzSmartWalletFactory,
  BoltzSmartWallet,
} from '@rsksmart/rif-relay-contracts';
import {
  CommonEnvelopingRequestBody,
  DeployRequest,
  DeployRequestBody,
  EnvelopingRequest,
  EnvelopingRequestData,
  RelayRequest,
  RelayRequestBody,
} from '@rsksmart/rif-relay-client';
import {
  TestDeployVerifierConfigurableMisbehavior,
  TestDeployVerifierEverythingAccepted,
  TestRecipient,
  TestSwap,
  TestVerifierConfigurableMisbehavior,
  TestVerifierEverythingAccepted,
} from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  getSuffixDataAndSignature,
  createSmartWalletFactory,
  createSupportedSmartWallet,
  RSK_URL,
  signEnvelopingRequest,
  evmMineMany,
  deployRelayHub,
  deployContract,
} from './utils/TestUtils';
import { RelayWorkersAddedEvent } from 'typechain-types/@rsksmart/rif-relay-contracts/contracts/RelayHub';

const stripHex = (s: string): string => {
  return s.slice(2, s.length);
};

describe('RelayHub', function () {
  let penalizer: Penalizer;
  let relayHub: RelayHub;
  let verifier: TestVerifierEverythingAccepted;
  let recipient: TestRecipient;
  let token: UtilToken;
  let factory: SmartWalletFactory;
  let relayWorker: SignerWithAddress;
  let relayManager: SignerWithAddress;
  let relayOwner: SignerWithAddress;
  let fundedAccount: SignerWithAddress;
  let relayHubSigner: SignerWithAddress;
  let owner: Wallet;
  let incorrectWorker: SignerWithAddress;
  let provider: providers.JsonRpcProvider;
  const gasPrice = 1;
  const gasLimit = 4e6;

  const cloneEnvelopingRequest = (
    envelopingRequest: EnvelopingRequest,
    override: {
      request?: Partial<CommonEnvelopingRequestBody>;
      relayData?: Partial<EnvelopingRequestData>;
    }
  ): EnvelopingRequest => {
    return {
      request: { ...envelopingRequest.request, ...override.request },
      relayData: { ...envelopingRequest.relayData, ...override.relayData },
    };
  };

  beforeEach(async function () {
    provider = new ethers.providers.JsonRpcProvider(RSK_URL);
    owner = ethers.Wallet.createRandom().connect(provider);
    [
      relayWorker,
      relayManager,
      relayOwner,
      fundedAccount,
      relayHubSigner,
      incorrectWorker,
    ] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress
    ];

    penalizer = await deployContract('Penalizer');
    verifier = await deployContract('TestVerifierEverythingAccepted');
    recipient = await deployContract('TestRecipient');
    token = await deployContract('UtilToken');
    const smartWalletTemplate = await deployContract<SmartWallet>(
      'SmartWallet'
    );

    relayHub = await deployRelayHub(penalizer.address);

    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    });

    factory = (await createSmartWalletFactory(
      smartWalletTemplate,
      'Default',
      owner
    )) as SmartWalletFactory;
  });
  describe('#add/disable relay workers', function () {
    const expectRelayWorkersAddedEvent = (
      relayWorkersAddedEvent?: RelayWorkersAddedEvent
    ) => {
      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.relayManager.toLowerCase()
      );
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.newRelayWorkers[0]?.toLowerCase()
      );
      expect(BigNumber.from(1)).to.equal(
        relayWorkersAddedEvent?.args.workersCount
      );
    };

    beforeEach(async function () {
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      });
    });

    it('should allow to disable new relay workers', async function () {
      await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);

      const relayWorkersAddedFilter = relayHub.filters.RelayWorkersAdded();
      const [relayWorkersAddedEvent] = await relayHub.queryFilter(
        relayWorkersAddedFilter
      );

      expectRelayWorkersAddedEvent(relayWorkersAddedEvent);

      const relayWorkersAfter = await relayHub.workerCount(
        relayManager.address
      );
      expect(relayWorkersAfter.toNumber()).to.equal(1, 'Workers must be one');

      const manager = await relayHub.workerToManager(relayWorker.address);

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      const expectedManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1'))
      );

      expect(manager.toLowerCase()).to.equal(
        expectedManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`
      );

      await relayHub
        .connect(relayManager)
        .disableRelayWorkers([relayWorker.address]);

      const disableWorkerFilter = relayHub.filters.RelayWorkersDisabled();
      const [relayWorkersDisabledEvent] = await relayHub.queryFilter(
        disableWorkerFilter
      );

      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersDisabledEvent?.args.relayManager.toLowerCase()
      );
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersDisabledEvent?.args.relayWorkers[0]?.toLowerCase()
      );
      expect(BigNumber.from(0)).to.equal(
        relayWorkersDisabledEvent?.args.workersCount
      );

      const workersCountAfterDisable = await relayHub.workerCount(
        relayManager.address
      );
      expect(workersCountAfterDisable.toNumber()).equal(
        0,
        'Workers must be zero'
      );

      const disabledManager = await relayHub.workerToManager(
        relayWorker.address
      );
      const expectedInvalidManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('0'))
      );
      expect(disabledManager.toLowerCase()).to.equal(
        expectedInvalidManager.toLowerCase(),
        `Incorrect relay manager: ${disabledManager}`
      );
    });

    it('should fail to disable more relay workers than available', async function () {
      const relayWorkersBefore = await relayHub.workerCount(
        relayManager.address
      );

      expect(relayWorkersBefore.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`
      );

      await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);

      const relayWorkersAddedFilter = relayHub.filters.RelayWorkersAdded();
      const [relayWorkersAddedEvent] = await relayHub.queryFilter(
        relayWorkersAddedFilter
      );

      expectRelayWorkersAddedEvent(relayWorkersAddedEvent);

      const relayWorkersAfter = await relayHub.workerCount(
        relayManager.address
      );
      expect(relayWorkersAfter.toNumber()).to.equal(1, 'Workers must be one');

      const manager = await relayHub.workerToManager(relayWorker.address);

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      const expectedManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1'))
      );

      expect(manager.toLowerCase()).to.equal(
        expectedManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`
      );

      const disableWorkerTrx = relayHub
        .connect(relayManager)
        .disableRelayWorkers([relayWorker.address, relayWorker.address]);

      await expect(disableWorkerTrx).to.be.rejectedWith(
        'invalid quantity of workers'
      );

      const workersCountAfterDisable = await relayHub.workerCount(
        relayManager.address
      );
      expect(workersCountAfterDisable.toNumber()).equal(1, 'Workers must be 1');

      const disabledManager = await relayHub.workerToManager(
        relayWorker.address
      );
      const expectedInvalidManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1'))
      );
      expect(disabledManager.toLowerCase()).to.equal(
        expectedInvalidManager.toLowerCase(),
        `Incorrect relay manager: ${disabledManager}`
      );
    });

    it('should only allow the corresponding relay manager to disable their respective relay workers', async function () {
      const [incorrectRelayManager, incorrectWorker] =
        (await ethers.getSigners()) as [SignerWithAddress, SignerWithAddress];

      await relayHub
        .connect(relayOwner)
        .stakeForAddress(incorrectRelayManager.address, 1000, {
          value: ethers.utils.parseEther('1'),
        });

      await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);

      await relayHub
        .connect(incorrectRelayManager)
        .addRelayWorkers([incorrectWorker.address]);

      const workersAfterAdd = await relayHub.workerCount(relayManager.address);

      const workersIncorrectAfterAdd = await relayHub.workerCount(
        incorrectRelayManager.address
      );

      expect(workersAfterAdd.toNumber()).equal(1, 'Workers must be 1');

      expect(workersIncorrectAfterAdd.toNumber()).equal(1, 'Workers must be 1');

      const manager = await relayHub.workerToManager(relayWorker.address);

      const managerIncorrectWorker = await relayHub.workerToManager(
        incorrectWorker.address
      );

      // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
      const expectedManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1'))
      );
      const expectedIncorrectManager = '0x00000000000000000000000'.concat(
        stripHex(incorrectRelayManager.address.concat('1'))
      );

      expect(manager.toLowerCase()).to.equal(
        expectedManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`
      );

      expect(managerIncorrectWorker.toLowerCase()).to.equal(
        expectedIncorrectManager.toLowerCase(),
        `Incorrect relay manager: ${managerIncorrectWorker}`
      );

      const disableWorkerTrx = relayHub
        .connect(incorrectRelayManager)
        .disableRelayWorkers([relayWorker.address]);

      await expect(disableWorkerTrx).to.be.rejectedWith('Incorrect Manager');

      const workersAfterDisable = await relayHub.workerCount(
        incorrectRelayManager.address
      );

      expect(workersAfterDisable.toNumber()).to.equal(
        1,
        "Workers shouldn't have changed"
      );

      const queriedManager = await relayHub.workerToManager(
        relayWorker.address
      );

      const expectedRelayManager = '0x00000000000000000000000'.concat(
        stripHex(relayManager.address.concat('1'))
      );

      expect(queriedManager.toLowerCase()).to.equal(
        expectedRelayManager.toLowerCase(),
        `Incorrect relay manager: ${manager}`
      );

      const queriedManagerIncorrectWorker = await relayHub.workerToManager(
        incorrectWorker.address
      );

      expect(queriedManagerIncorrectWorker.toLowerCase()).to.equal(
        expectedIncorrectManager.toLowerCase(),
        `Incorrect relay manager: ${queriedManagerIncorrectWorker}`
      );
    });
  });

  describe('relayCall', function () {
    let relayRequest: RelayRequest;
    let forwarder: SmartWallet;

    beforeEach(async function () {
      forwarder = (await createSupportedSmartWallet({
        relayHub: relayHubSigner.address,
        factory,
        owner,
        sender: relayHubSigner,
      })) as SmartWallet;

      await token.mint('1000', forwarder.address);

      relayRequest = {
        request: {
          relayHub: relayHub.address,
          to: recipient.address,
          data: '0xdeadbeef',
          from: owner.address,
          nonce: (await forwarder.nonce()).toString(),
          value: '0',
          gas: '3000000',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000',
          validUntilTime: '0',
        },
        relayData: {
          gasPrice,
          feesReceiver: relayWorker.address,
          callForwarder: forwarder.address,
          callVerifier: verifier.address,
        },
      };
    });

    const cloneRelayRequest = (override: {
      request?: Partial<RelayRequestBody>;
      relayData?: Partial<EnvelopingRequestData>;
    }) => {
      return cloneEnvelopingRequest(relayRequest, override) as RelayRequest;
    };

    it('should retrieve version number', async function () {
      const version = await relayHub.versionHub();
      expect(version).to.match(/2\.\d*\.\d*-?.*\+enveloping\.hub\.irelayhub/);
    });

    context('with unknown worker', function () {
      it('should not accept a relay call coming from an unknown worker', async function () {
        const [unknownWorker] = (await ethers.getSigners()) as [
          SignerWithAddress
        ];

        relayRequest.relayData.feesReceiver = unknownWorker.address;

        const { signature } = await getSuffixDataAndSignature(
          forwarder,
          relayRequest,
          owner
        );

        const relayCall = relayHub
          .connect(unknownWorker)
          .relayCall(relayRequest, signature, {
            gasPrice,
          });

        await expect(relayCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with manager stake unlocked', function () {
      let signature: string;

      beforeEach(async function () {
        ({ signature } = await getSuffixDataAndSignature(
          forwarder,
          relayRequest,
          owner
        ));

        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('1'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
      });

      it('should not accept a relay call', async function () {
        await relayHub.connect(relayOwner).unlockStake(relayManager.address);

        const relayCall = relayHub
          .connect(relayWorker)
          .relayCall(relayRequest, signature, {
            gasPrice,
          });

        await expect(relayCall).to.be.rejectedWith('RelayManager not staked');
      });

      it('should not accept a relay call with a disabled worker', async function () {
        await relayHub
          .connect(relayManager)
          .disableRelayWorkers([relayWorker.address]);

        const relayCall = relayHub
          .connect(relayWorker)
          .relayCall(relayRequest, signature, {
            gasPrice,
          });

        await expect(relayCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with staked and registered relay', function () {
      const url = 'http://relay.com';
      const message = 'Enveloping RelayHub';
      const messageWithNoParams = 'Method with no parameters';

      let relayRequestEncodedFn: RelayRequest;
      let signatureWithPermissiveVerifier: string;
      let misbehavingVerifier: TestVerifierConfigurableMisbehavior;

      beforeEach(async function () {
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('2'),
          });

        const encodedFunction = recipient.interface.encodeFunctionData(
          'emitMessage',
          [message]
        );

        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
        await relayHub.connect(relayManager).registerRelayServer(url);

        relayRequestEncodedFn = cloneRelayRequest({
          request: { data: encodedFunction },
        });
        ({ signature: signatureWithPermissiveVerifier } =
          await getSuffixDataAndSignature(
            forwarder,
            relayRequestEncodedFn,
            owner
          ));

        misbehavingVerifier = await deployContract(
          'TestVerifierConfigurableMisbehavior'
        );
      });

      context('with relay worker that is not an EOA', function () {
        it('should not accept relay requests', async function () {
          const signature = '0xdeadbeef';

          const testRelayWorkerContract = await ethers
            .getContractFactory('TestRelayWorkerContract')
            .then((contract) => contract.deploy());
          await relayHub
            .connect(relayManager)
            .addRelayWorkers([testRelayWorkerContract.address]);

          const relayCall = testRelayWorkerContract.relayCall(
            relayHub.address,
            relayRequestEncodedFn,
            signature,
            {
              gasPrice,
            }
          );

          await expect(relayCall).to.be.rejectedWith(
            'RelayWorker cannot be a contract'
          );
        });
      });

      context('with funded verifier', function () {
        let signatureWithMisbehavingVerifier: string;
        let relayRequestMisbehavingVerifier: RelayRequest;

        beforeEach(async function () {
          relayRequestMisbehavingVerifier = cloneRelayRequest({
            relayData: { callVerifier: misbehavingVerifier.address },
          });
          ({ signature: signatureWithMisbehavingVerifier } =
            await getSuffixDataAndSignature(
              forwarder,
              relayRequestMisbehavingVerifier,
              owner
            ));
        });

        it('should fail to relay if the worker has been disabled', async function () {
          let manager = await relayHub.workerToManager(relayWorker.address);
          // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
          let expectedManager = '0x00000000000000000000000'.concat(
            stripHex(relayManager.address.concat('1'))
          );

          expect(manager.toLowerCase()).to.equal(
            expectedManager.toLowerCase(),
            `Incorrect relay manager: ${manager}`
          );

          await relayHub
            .connect(relayManager)
            .disableRelayWorkers([relayWorker.address]);

          manager = await relayHub.workerToManager(relayWorker.address);
          expectedManager = '0x00000000000000000000000'.concat(
            stripHex(relayManager.address.concat('0'))
          );
          expect(manager.toLowerCase()).to.equal(
            expectedManager.toLowerCase(),
            `Incorrect relay manager: ${manager}`
          );

          const relayCall = relayHub
            .connect(relayWorker)
            .relayCall(relayRequest, signatureWithPermissiveVerifier, {
              gasLimit,
              gasPrice,
            });

          await expect(relayCall).to.be.rejectedWith('Not an enabled worker');
        });

        it('should execute the transaction and increase sender nonce on hub', async function () {
          const nonceBefore = await forwarder.nonce();

          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequestEncodedFn, signatureWithPermissiveVerifier, {
              gasLimit,
              gasPrice,
            });

          const nonceAfter = await forwarder.nonce();
          expect(nonceBefore.add(1).toNumber()).to.equal(nonceAfter.toNumber());

          const recipientEmittedFilter =
            recipient.filters.SampleRecipientEmitted();
          const sampleRecipientEmittedEvent = await recipient.queryFilter(
            recipientEmittedFilter
          );

          expect(message).to.equal(
            sampleRecipientEmittedEvent[0]?.args.message
          );
          expect(forwarder.address.toLowerCase()).to.equal(
            sampleRecipientEmittedEvent[0]?.args.msgSender.toLowerCase()
          );
          expect(relayWorker.address.toLowerCase()).to.equal(
            sampleRecipientEmittedEvent[0]?.args.origin.toLowerCase()
          );

          const transactionRelayedFilter =
            relayHub.filters.TransactionRelayed();
          const transactionRelayedEvent = await relayHub.queryFilter(
            transactionRelayedFilter
          );

          expect(transactionRelayedEvent.length).to.equal(1);
        });

        it('should refuse to re-send transaction with same nonce', async function () {
          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequestEncodedFn, signatureWithPermissiveVerifier, {
              gasLimit,
              gasPrice,
            });

          const recipientEmittedFilter =
            recipient.filters.SampleRecipientEmitted();
          const sampleRecipientEmittedEvent = await recipient.queryFilter(
            recipientEmittedFilter
          );

          expect(sampleRecipientEmittedEvent.length).to.equal(1);

          const relayCall = relayHub
            .connect(relayWorker)
            .relayCall(relayRequestEncodedFn, signatureWithPermissiveVerifier, {
              gasLimit,
              gasPrice,
            });

          await expect(relayCall).to.be.rejectedWith('nonce mismatch');
        });

        // This test is added due to a regression that almost slipped to production.
        it('should execute the transaction with no parameters', async function () {
          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessageNoParams'
          );
          const relayRequestNoCallData = cloneRelayRequest({
            request: { data: encodedFunction },
          });

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequestNoCallData,
            owner
          );

          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequestNoCallData, signature, {
              gasLimit,
              gasPrice,
            });

          const sampleRecipientEmittedFilter =
            recipient.filters.SampleRecipientEmitted();
          const sampleRecipientEmittedEvent = await recipient.queryFilter(
            sampleRecipientEmittedFilter
          );

          expect(messageWithNoParams).to.equal(
            sampleRecipientEmittedEvent[0]?.args.message
          );
          expect(forwarder.address.toLowerCase()).to.equal(
            sampleRecipientEmittedEvent[0]?.args.msgSender.toLowerCase()
          );
          expect(relayWorker.address.toLowerCase()).to.equal(
            sampleRecipientEmittedEvent[0]?.args.origin.toLowerCase()
          );
        });

        it('should execute a transaction even if recipient call reverts', async function () {
          const encodedFunction =
            recipient.interface.encodeFunctionData('testRevert');

          const relayRequestRevert = cloneRelayRequest({
            request: { data: encodedFunction },
          });

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequestRevert,
            owner
          );

          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequestRevert, signature, {
              gasLimit,
              gasPrice,
            });

          const reason =
            '0x08c379a0' +
            ethers.utils.defaultAbiCoder
              .encode(['string'], ['always fail'])
              .substring(2);

          const recipientRevertedFilter =
            relayHub.filters.TransactionRelayedButRevertedByRecipient();
          const transactionRelayedButRevertedByRecipientEvent =
            await relayHub.queryFilter(recipientRevertedFilter);

          expect(relayWorker.address.toLowerCase()).to.equal(
            transactionRelayedButRevertedByRecipientEvent[0]?.args.relayWorker.toLowerCase()
          );
          expect(reason.toLowerCase()).to.equal(
            transactionRelayedButRevertedByRecipientEvent[0]?.args.reason.toLowerCase()
          );
        });

        it('should not accept relay requests if passed gas is too low for a relayed transaction', async function () {
          const relayCall = relayHub
            .connect(relayWorker)
            .relayCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasPrice,
                gasLimit: '60000',
              }
            );

          await expect(relayCall).to.be.rejectedWith('transaction reverted');
        });

        it('should not accept relay requests with gas price lower than user specified', async function () {
          const relayRequestMisbehavingVerifier = cloneRelayRequest({
            relayData: {
              callVerifier: misbehavingVerifier.address,
              gasPrice: BigInt(2).toString(),
            },
          });

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequestMisbehavingVerifier,
            owner
          );

          const relayCall = relayHub
            .connect(relayWorker)
            .relayCall(relayRequestMisbehavingVerifier, signature, {
              gasLimit,
              gasPrice,
            });

          await expect(relayCall).to.be.rejectedWith('Invalid gas price');
        });

        it('should accept relay requests with incorrect relay worker', async function () {
          await relayHub
            .connect(relayManager)
            .addRelayWorkers([incorrectWorker.address]);
          await relayHub
            .connect(relayWorker)
            .relayCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice,
              }
            );

          const transactionRelayedRevertedFilter =
            relayHub.filters.TransactionRelayedButRevertedByRecipient();
          const transactionRelayedRevertedEvent = await relayHub.queryFilter(
            transactionRelayedRevertedFilter
          );

          expect(transactionRelayedRevertedEvent.length).to.equal(1);
        });
      });
    });
  });

  describe('deployCall', function () {
    const minIndex = 0;
    const maxIndex = 1000000000;
    let nextWalletIndex: number;
    let deployRequest: DeployRequest;
    let deployVerifier: TestDeployVerifierEverythingAccepted;
    let unknownWorker: SignerWithAddress;

    beforeEach(async function () {
      nextWalletIndex = Math.floor(
        Math.random() * (maxIndex - minIndex + 1) + minIndex
      );

      deployVerifier = await deployContract(
        'TestDeployVerifierEverythingAccepted'
      );
      [unknownWorker] = (await ethers.getSigners()) as [SignerWithAddress];

      deployRequest = {
        request: {
          relayHub: relayHub.address,
          to: ethers.constants.AddressZero,
          data: '0x',
          from: owner.address,
          nonce: (await factory.nonce(owner.address)).toString(),
          value: '0',
          tokenContract: token.address,
          tokenAmount: '1',
          tokenGas: '50000',
          recoverer: ethers.constants.AddressZero,
          index: '0',
          validUntilTime: '0',
          gas: '30000',
        },
        relayData: {
          gasPrice,
          feesReceiver: relayWorker.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
        },
      };
    });

    const cloneDeployRequest = (override: {
      request?: Partial<DeployRequestBody>;
      relayData?: Partial<EnvelopingRequestData>;
    }) => {
      return cloneEnvelopingRequest(deployRequest, override) as DeployRequest;
    };

    context('with unknown worker', function () {
      it('should not accept a deploy call with an unknown worker', async function () {
        const deployRequestUnknownWorker = cloneDeployRequest({
          request: { index: nextWalletIndex.toString() },
          relayData: { feesReceiver: unknownWorker.address },
        });

        const { signature } = await signEnvelopingRequest(
          deployRequestUnknownWorker,
          owner
        );

        nextWalletIndex++;

        const deployCall = relayHub
          .connect(unknownWorker)
          .deployCall(deployRequest, signature, {
            gasLimit,
          });

        await expect(deployCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with manager stake unlocked', function () {
      let signature: string;
      let deployRequestNextIndex: DeployRequest;

      beforeEach(async function () {
        deployRequestNextIndex = cloneDeployRequest({
          request: { index: nextWalletIndex.toString() },
        });

        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('1'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
        ({ signature } = await signEnvelopingRequest(
          deployRequestNextIndex,
          owner
        ));
        nextWalletIndex++;
      });

      it('should not accept a deploy call with an unstaked RelayManager', async function () {
        await relayHub.connect(relayOwner).unlockStake(relayManager.address);

        const deployCall = relayHub
          .connect(relayWorker)
          .deployCall(deployRequestNextIndex, signature, {
            gasLimit,
          });

        await expect(deployCall).to.be.rejectedWith('RelayManager not staked');
      });

      it('should not accept a deploy call with a disabled relay worker', async function () {
        await relayHub
          .connect(relayManager)
          .disableRelayWorkers([relayWorker.address]);

        const deployCall = relayHub
          .connect(unknownWorker)
          .deployCall(deployRequestNextIndex, signature, {
            gasLimit,
          });

        await expect(deployCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with staked and registered relay', function () {
      const url = 'http://relay.com';
      let deployRequestNextIndex: DeployRequest;

      beforeEach(async function () {
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('2'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
        await relayHub.connect(relayManager).registerRelayServer(url);

        deployRequestNextIndex = cloneDeployRequest({
          request: { index: nextWalletIndex.toString() },
        });
        nextWalletIndex++;
      });

      context(
        'with relay worker that is not externally-owned account',
        function () {
          it('should not accept deploy requests', async function () {
            const signature = '0xdeadbeef';

            const testRelayWorkerContract = await ethers
              .getContractFactory('TestRelayWorkerContract')
              .then((contract) => contract.deploy());

            await relayHub
              .connect(relayManager)
              .addRelayWorkers([testRelayWorkerContract.address]);

            const deployCall = testRelayWorkerContract.deployCall(
              relayHub.address,
              deployRequestNextIndex,
              signature,
              {
                gasLimit,
              }
            );

            await expect(deployCall).to.be.rejectedWith(
              'RelayWorker cannot be a contract'
            );
          });
        }
      );

      context('with boltz', function () {
        let data: string;
        let swap: TestSwap;
        let boltzFactory: BoltzSmartWalletFactory;

        beforeEach(async function () {
          const smartWalletTemplate = await deployContract<BoltzSmartWallet>(
            'BoltzSmartWallet'
          );
          boltzFactory = (await createSmartWalletFactory(
            smartWalletTemplate,
            'Boltz',
            owner
          )) as BoltzSmartWalletFactory;
          swap = await deployContract<TestSwap>('TestSwap');
          await fundedAccount.sendTransaction({
            to: swap.address,
            value: ethers.utils.parseEther('1'),
          });
          data = swap.interface.encodeFunctionData('claim', [
            constants.HashZero,
            ethers.utils.parseEther('0.5'),
            constants.AddressZero,
            500,
          ]);
        });

        it('should fail if revert from destination contract', async function () {
          data = swap.interface.encodeFunctionData('claim', [
            constants.HashZero,
            ethers.utils.parseEther('2'),
            constants.AddressZero,
            500,
          ]);

          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).to.be.rejectedWith(
            'Could not transfer Ether'
          );
        });

        it('should fail if not enough gas', async function () {
          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
              gas: 0,
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).to.be.rejectedWith('Unable to execute');
        });

        it('should fail if not enough native token to pay', async function () {
          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
              tokenAmount: ethers.utils.parseEther('1'),
              tokenContract: constants.AddressZero,
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).to.be.rejectedWith(
            'Unable to pay for deployment'
          );
        });

        it('should succeed paying with native token', async function () {
          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
              tokenContract: constants.AddressZero,
              tokenAmount: ethers.utils.parseEther('0.01'),
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).not.to.be.rejected;
        });

        it('should fail if not enough token to pay', async function () {
          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).to.be.rejectedWith(
            'Unable to pay for deployment'
          );
        });

        it('should fail if not enough gas to pay for token transfer', async function () {
          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
              tokenGas: 0,
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).to.be.rejectedWith(
            'Unable to pay for deployment'
          );
        });

        it('should succeed paying with token', async function () {
          const deployRequest = cloneDeployRequest({
            request: {
              index: nextWalletIndex.toString(),
              to: swap.address,
              data,
            },
            relayData: {
              callForwarder: boltzFactory.address,
            },
          });

          const calculatedAddr = await boltzFactory.getSmartWalletAddress(
            owner.address,
            constants.AddressZero,
            deployRequest.request.index
          );

          await token.mint('1', calculatedAddr);

          const { signature } = await signEnvelopingRequest(
            deployRequest,
            owner
          );

          nextWalletIndex++;

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(deployRequest, signature, { gasLimit });

          await expect(deployCall).not.to.be.rejected;
        });
      });

      context('with funded verifier', function () {
        let misbehavingVerifier: TestDeployVerifierConfigurableMisbehavior;
        let signatureWithMisbehavingVerifier: string;
        let deployRequestMisbehavingVerifier: DeployRequest;
        const gasLimit = 4e6;

        beforeEach(async function () {
          misbehavingVerifier = await deployContract(
            'TestDeployVerifierConfigurableMisbehavior'
          );
          deployRequestNextIndex = cloneDeployRequest({
            request: { index: nextWalletIndex.toString() },
          });
          nextWalletIndex++;

          await fundedAccount.sendTransaction({
            to: misbehavingVerifier.address,
            value: ethers.utils.parseEther('1'),
          });

          deployRequestMisbehavingVerifier = cloneDeployRequest({
            relayData: { callVerifier: misbehavingVerifier.address },
          });
          ({ signature: signatureWithMisbehavingVerifier } =
            await signEnvelopingRequest(
              deployRequestMisbehavingVerifier,
              owner
            ));
        });

        it('should execute the transaction and increase sender nonce on factory', async function () {
          const nonceBefore = await factory.nonce(owner.address);
          const calculatedAddr = await factory.getSmartWalletAddress(
            owner.address,
            ethers.constants.AddressZero,
            deployRequestMisbehavingVerifier.request.index
          );
          await token.mint('1', calculatedAddr);

          await relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice,
              }
            );

          const deployedFilter = factory.filters.Deployed();
          const deployedEvent = await factory.queryFilter(deployedFilter);

          expect(deployedEvent.length).to.equal(1, 'No Deployed event found');

          expect(calculatedAddr).to.equal(deployedEvent[0]?.args.addr);

          const nonceAfter = await factory.nonce(owner.address);
          expect(nonceAfter.toNumber()).to.equal(nonceBefore.add(1).toNumber());
        });

        it('should fail to deploy if the worker has been disabled', async function () {
          let manager = await relayHub.workerToManager(relayWorker.address);
          // manager = 32 bytes: <zeroes = 11bytes + 4 bits > + <manager address = 20 bytes = 160 bits > + <isEnabled = 4 bits>
          let expectedManager = '0x00000000000000000000000'.concat(
            stripHex(relayManager.address.concat('1'))
          );

          expect(manager.toLowerCase()).to.equal(
            expectedManager.toLowerCase(),
            `Incorrect relay manager: ${manager}`
          );

          await relayHub
            .connect(relayManager)
            .disableRelayWorkers([relayWorker.address]);
          manager = await relayHub.workerToManager(relayWorker.address);
          expectedManager = '0x00000000000000000000000'.concat(
            stripHex(relayManager.address.concat('0'))
          );
          expect(manager.toLowerCase()).to.equal(
            expectedManager.toLowerCase(),
            `Incorrect relay manager: ${manager}`
          );

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice,
              }
            );

          await expect(deployCall).to.be.rejectedWith('Not an enabled worker');
        });

        it('should refuse to re-send transaction with same nonce', async function () {
          const calculatedAddr = await factory.getSmartWalletAddress(
            owner.address,
            ethers.constants.AddressZero,
            deployRequestMisbehavingVerifier.request.index
          );
          await token.mint('1', calculatedAddr);

          await relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice,
              }
            );

          const deployedFilter = factory.filters.Deployed();
          const deployedEvent = await factory.queryFilter(deployedFilter);

          expect(deployedEvent.length).to.equal(1, 'No Deployed event found');

          expect(calculatedAddr).to.equal(deployedEvent[0]?.args.addr);

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice,
              }
            );

          await expect(deployCall).to.be.rejectedWith('nonce mismatch');
        });

        it('should not accept deploy requests if passed gas is too low for a relayed transaction', async function () {
          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasPrice,
                gasLimit: '60000',
              }
            );

          await expect(deployCall).to.be.rejectedWith('transaction reverted');
        });

        it('should not accept deploy requests with gas price lower than user specified', async function () {
          const deployRequestMisbehavingVerifier = cloneDeployRequest({
            relayData: {
              callVerifier: misbehavingVerifier.address,
              gasPrice: BigInt(2).toString(),
            },
          });

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice,
              }
            );

          await expect(deployCall).to.be.rejectedWith('Invalid gas price');
        });

        it('should accept deploy requests with incorrect relay worker', async function () {
          await relayHub
            .connect(relayManager)
            .addRelayWorkers([incorrectWorker.address]);
          const calculatedAddr = await factory.getSmartWalletAddress(
            owner.address,
            ethers.constants.AddressZero,
            deployRequestMisbehavingVerifier.request.index
          );
          await token.mint('1', calculatedAddr);

          await relayHub
            .connect(incorrectWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasPrice,
                gasLimit,
              }
            );

          const deployedFilter = factory.filters.Deployed();
          const deployedEvent = await factory.queryFilter(deployedFilter);
          expect(deployedEvent.length).to.equal(1, 'No Deployed event found');
        });
      });
    });
  });

  describe('penalize', function () {
    let beneficiary: SignerWithAddress;
    let penalizerMock: SignerWithAddress;

    beforeEach(async function () {
      [penalizerMock, beneficiary] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress
      ];

      relayHub = await deployRelayHub(penalizerMock.address);

      await relayHub
        .connect(relayOwner)
        .stakeForAddress(relayManager.address, 1000, {
          value: ethers.utils.parseEther('2'),
        });
      await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);
    });

    context('with unknown worker', function () {
      it('should not penalize when a worker with address zero is specified', async function () {
        const penalize = relayHub
          .connect(penalizerMock)
          .penalize(ethers.constants.AddressZero, beneficiary.address, {
            gasLimit,
          });

        await expect(penalize).to.be.rejectedWith('Unknown relay worker');
      });
    });

    context('with manager stake unlocked', function () {
      beforeEach(async function () {
        await relayHub.connect(relayOwner).unlockStake(relayManager.address);
      });

      it('should not penalize when an unknown penalizer is specified', async function () {
        const penalize = relayHub
          .connect(relayOwner)
          .penalize(relayWorker.address, beneficiary.address, {
            gasLimit,
          });

        await expect(penalize).to.be.rejectedWith('Not penalizer');
      });

      it('should penalize when the stake is unlocked', async function () {
        let stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const isUnlocked = Number(stakeInfo.withdrawBlock) > 0;
        expect(isUnlocked).to.equal(true, 'Stake is not unlocked');

        const stakeBalanceBefore = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceBefore = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );
        const toBurn = stakeBalanceBefore.div(BigNumber.from(2));
        const reward = stakeBalanceBefore.sub(toBurn);

        await relayHub
          .connect(penalizerMock)
          .penalize(relayWorker.address, beneficiary.address, {
            gasLimit,
          });

        stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const stakeBalanceAfter = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceAfter = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );

        expect(stakeBalanceAfter.eq(BigNumber.from(0))).to.equal(
          true,
          'Stake after penalization must be zero'
        );
        expect(
          beneficiaryBalanceAfter.eq(beneficiaryBalanceBefore.add(reward))
        ).to.equal(true, 'Beneficiary did not receive half the stake');
      });

      it('should revert if stake is already zero', async function () {
        let stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const isUnlocked = Number(stakeInfo.withdrawBlock) > 0;
        expect(isUnlocked).to.equal(true, 'Stake is not unlocked');

        await evmMineMany(Number(stakeInfo.unstakeDelay));

        stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const stakeBalanceBefore = BigNumber.from(stakeInfo.stake);

        const relayOwnerBalanceBefore = BigNumber.from(
          await ethers.provider.getBalance(relayOwner.address)
        );
        const gasPrice = BigNumber.from('60000000');
        const txResponse = await relayHub
          .connect(relayOwner)
          .withdrawStake(relayManager.address, { gasPrice });

        const rbtcUsed = BigNumber.from(
          (await txResponse.wait()).cumulativeGasUsed
        ).mul(gasPrice);

        const relayOwnerBalanceAfter = BigNumber.from(
          await ethers.provider.getBalance(relayOwner.address)
        );

        expect(
          relayOwnerBalanceAfter.eq(
            relayOwnerBalanceBefore.sub(rbtcUsed).add(stakeBalanceBefore)
          )
        ).to.equal(true, 'Withdraw process failed');

        stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const stakeAfterWithdraw = BigNumber.from(stakeInfo.stake);

        expect(stakeAfterWithdraw.isZero()).to.equal(
          true,
          'Stake must be zero'
        );

        const beneficiaryBalanceBefore = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );

        const penalize = relayHub
          .connect(penalizerMock)
          .penalize(relayWorker.address, beneficiary.address, {
            gasLimit,
          });

        await expect(penalize).to.be.rejectedWith('Unstaked relay manager');

        stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const stakeBalanceAfter = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceAfter = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );

        expect(stakeBalanceAfter.isZero()).to.equal(
          true,
          'Stake after penalization must still be zero'
        );
        expect(beneficiaryBalanceAfter.eq(beneficiaryBalanceBefore)).to.equal(
          true,
          'Beneficiary balance must remain unchanged'
        );
      });
    });

    context('with staked and registered relay', function () {
      const url = 'http://relay.com';

      beforeEach(async function () {
        await relayHub.connect(relayManager).registerRelayServer(url);
      });

      it('should not penalize when an unknown penalizer is specified', async function () {
        await expect(
          relayHub
            .connect(relayOwner)
            .penalize(relayWorker.address, beneficiary.address, {
              gasLimit,
            })
        ).to.be.rejectedWith('Not penalizer');
      });

      it('should penalize', async function () {
        let stakeInfo = await relayHub.getStakeInfo(relayManager.address);

        const stakeBalanceBefore = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceBefore = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );
        const toBurn = stakeBalanceBefore.div(BigNumber.from(2));
        const reward = stakeBalanceBefore.sub(toBurn);

        await relayHub
          .connect(penalizerMock)
          .penalize(relayWorker.address, beneficiary.address, {
            gasLimit,
          });

        stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const stakeBalanceAfter = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceAfter = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );

        expect(stakeBalanceAfter.eq(BigNumber.from(0))).to.equal(
          true,
          'Stake after penalization must be zero'
        );
        expect(
          beneficiaryBalanceAfter.eq(beneficiaryBalanceBefore.add(reward))
        ).to.equal(true, 'Beneficiary did not receive half the stake');
      });

      it('should revert if trying to penalize twice', async function () {
        let stakeInfo = await relayHub.getStakeInfo(relayManager.address);

        const stakeBalanceBefore = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceBefore = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );
        const toBurn = stakeBalanceBefore.div(BigNumber.from(2));
        const reward = stakeBalanceBefore.sub(toBurn);

        await relayHub
          .connect(penalizerMock)
          .penalize(relayWorker.address, beneficiary.address, {
            gasLimit,
          });

        stakeInfo = await relayHub.getStakeInfo(relayManager.address);
        const stakeBalanceAfter = BigNumber.from(stakeInfo.stake);
        const beneficiaryBalanceAfter = BigNumber.from(
          await ethers.provider.getBalance(beneficiary.address)
        );

        expect(stakeBalanceAfter.eq(BigNumber.from(0))).to.equal(
          true,
          'Stake after penalization must be zero'
        );
        expect(
          beneficiaryBalanceAfter.eq(beneficiaryBalanceBefore.add(reward))
        ).to.equal(true, 'Beneficiary did not receive half the stake');

        await expect(
          relayHub
            .connect(penalizerMock)
            .penalize(relayWorker.address, beneficiary.address, {
              gasLimit,
            })
        ).to.be.rejectedWith('Unstaked relay manager');
      });
    });
  });
});

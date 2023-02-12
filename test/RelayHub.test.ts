import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Wallet, providers } from 'ethers';
import {
  UtilToken,
  SmartWalletFactory,
  Penalizer,
  RelayHub,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts';
import { DeployRequest, RelayRequest } from '@rsksmart/rif-relay-client';
import {
  TestDeployVerifierConfigurableMisbehavior,
  TestDeployVerifierEverythingAccepted,
  TestRecipient,
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
} from './utils/TestUtils';

const stripHex = (s: string): string => {
  return s.slice(2, s.length);
};

function cloneRelayRequest(relayRequest: RelayRequest): RelayRequest {
  return {
    request: { ...relayRequest.request },
    relayData: { ...relayRequest.relayData },
  };
}

describe('RelayHub', function () {
  let penalizer: Penalizer;
  let relayHub: RelayHub;
  let verifier: TestVerifierEverythingAccepted;
  let recipient: TestRecipient;
  let token: UtilToken;
  let forwarder: SmartWallet;
  let factory: SmartWalletFactory;
  let sharedRelayRequestData: RelayRequest;
  let relayWorker: SignerWithAddress;
  let relayManager: SignerWithAddress;
  let relayOwner: SignerWithAddress;
  let fundedAccount: SignerWithAddress;
  let relayHubSigner: SignerWithAddress;
  let owner: Wallet;
  let incorrectWorker: SignerWithAddress;
  let provider: providers.JsonRpcProvider;

  beforeEach(async function () {
    provider = new ethers.providers.JsonRpcProvider(RSK_URL);
    owner = ethers.Wallet.createRandom().connect(provider);

    const penalizerFactory = await ethers.getContractFactory('Penalizer');
    penalizer = await penalizerFactory.deploy();

    //const { relayHubConfiguration } = defaultEnvironment!;

    const relayHubFactory = await ethers.getContractFactory('RelayHub');

    relayHub = await relayHubFactory.deploy(
      penalizer.address,
      10,
      (1e18).toString(),
      1000,
      (1e18).toString()
    );

    relayHub.connect(provider);

    verifier = await ethers
      .getContractFactory('TestVerifierEverythingAccepted')
      .then((contractFactory) => contractFactory.deploy());

    const smartWalletTemplate = await ethers
      .getContractFactory('SmartWallet')
      .then((contractFactory) => contractFactory.deploy());

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

    //Fund the owner
    await fundedAccount.sendTransaction({
      to: owner.address,
      value: ethers.utils.parseEther('1'),
    });

    factory = (await createSmartWalletFactory(
      smartWalletTemplate,
      false,
      owner
    )) as SmartWalletFactory;
    recipient = await ethers
      .getContractFactory('TestRecipient')
      .then((contractFactory) => contractFactory.deploy());
    token = await ethers
      .getContractFactory('UtilToken')
      .then((contractFactory) => contractFactory.deploy());

    //const sender = await ethers.getSigner(relayHub.address)

    forwarder = (await createSupportedSmartWallet({
      relayHub: relayHubSigner.address,
      factory,
      owner,
      sender: relayHubSigner,
    })) as SmartWallet;

    await token.mint('1000', forwarder.address);

    sharedRelayRequestData = {
      request: {
        relayHub: relayHub.address,
        to: recipient.address,
        data: '',
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
        gasPrice: '1',
        feesReceiver: relayWorker.address,
        callForwarder: forwarder.address,
        callVerifier: verifier.address,
      },
    };
  });
  describe('#add/disable relay workers', function () {
    it('should register and allow to disable new relay workers', async function () {
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      });

      const relayWorkersBefore = await relayHub.workerCount(
        relayManager.address
      );

      expect(relayWorkersBefore.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`
      );

      const addRelayWorkersTrx = await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);
      await addRelayWorkersTrx.wait();
      const relayWorkersAddedFilter = relayHub.filters.RelayWorkersAdded();

      const [relayWorkersAddedEvent] = await relayHub.queryFilter(
        relayWorkersAddedFilter
      );

      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.relayManager.toLowerCase()
      );
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.newRelayWorkers[0]?.toLowerCase()
      );
      expect(BigNumber.from(1)).to.equal(
        relayWorkersAddedEvent?.args.workersCount
      );

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

      const disableWorkerTrx = await relayHub
        .connect(relayManager)
        .disableRelayWorkers([relayWorker.address]);

      await disableWorkerTrx.wait();
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
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      });

      const relayWorkersBefore = await relayHub.workerCount(
        relayManager.address
      );

      expect(relayWorkersBefore.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkersBefore.toNumber()}`
      );

      const addRelayWorkersTrx = await relayHub
        .connect(relayManager)
        .addRelayWorkers([relayWorker.address]);
      await addRelayWorkersTrx.wait();
      const relayWorkersAddedFilter = relayHub.filters.RelayWorkersAdded();

      const [relayWorkersAddedEvent] = await relayHub.queryFilter(
        relayWorkersAddedFilter
      );

      expect(relayManager.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.relayManager.toLowerCase()
      );
      expect(relayWorker.address.toLowerCase()).to.equal(
        relayWorkersAddedEvent?.args.newRelayWorkers[0]?.toLowerCase()
      );
      expect(BigNumber.from(1)).to.equal(
        relayWorkersAddedEvent?.args.workersCount
      );

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
      await relayHub.stakeForAddress(relayManager.address, 1000, {
        value: ethers.utils.parseEther('1'),
      });

      const [incorrectRelayManager, incorrectWorker] =
        (await ethers.getSigners()) as [SignerWithAddress, SignerWithAddress];

      await relayHub
        .connect(relayOwner)
        .stakeForAddress(incorrectRelayManager.address, 1000, {
          value: ethers.utils.parseEther('1'),
        });

      const relayWorkers = await relayHub.workerCount(relayManager.address);

      const relayWorkersIncorrect = await relayHub.workerCount(
        incorrectRelayManager.address
      );

      expect(relayWorkers.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkers.toNumber()}`
      );

      expect(relayWorkersIncorrect.toNumber()).to.equal(
        0,
        `Initial workers must be zero but was ${relayWorkers.toNumber()}`
      );

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
    const gas = 4e6;
    let relayRequest: RelayRequest;

    beforeEach(function () {
      relayRequest = {
        request: { ...sharedRelayRequestData.request, data: '0xdeadbeef' },
        relayData: { ...sharedRelayRequestData.relayData },
      };
    });

    it('should retrieve version number', async function () {
      const version = await relayHub.versionHub();
      expect(version).to.match(/2\.\d*\.\d*-?.*\+enveloping\.hub\.irelayhub/);
    });

    context('with unknown worker', function () {
      it('should not accept a relay call with a disabled worker - 2', async function () {
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
            gasPrice: gas,
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
            gasPrice: gas,
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
            gasPrice: gas,
          });

        await expect(relayCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with staked and registered relay', function () {
      const url = 'http://relay.com';
      const message = 'Enveloping RelayHub';
      const messageWithNoParams = 'Method with no parameters';

      let relayRequest: RelayRequest;
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

        relayRequest = cloneRelayRequest(sharedRelayRequestData);
        relayRequest.request.data = encodedFunction;
        ({ signature: signatureWithPermissiveVerifier } =
          await getSuffixDataAndSignature(forwarder, relayRequest, owner));

        misbehavingVerifier = await ethers
          .getContractFactory('TestVerifierConfigurableMisbehavior')
          .then((contract) => contract.deploy());
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
            relayRequest,
            signature,
            {
              gasPrice: gas,
            }
          );

          await expect(relayCall).to.be.rejectedWith(
            'RelayWorker cannot be a contract'
          );
        });
      });

      /*context.skip('with view functions only', function () {

        // TODO re-enable
        it.skip("should get 'verifierAccepted = true' and no revert reason as view call result of 'relayCall' for a valid transaction", async function () {
          const relayCallView = await relayHub.connect(relayWorker).relayCall(relayRequest, signatureWithPermissiveVerifier, {
            gasPrice: gas
          })
          
          expect(relayCallView.returnValue).to.be.null
          expect(relayCallView.verifierAccepted).to.be.null
        })

        // TODO re-enable
        it.skip("should get Verifier's reject reason from view call result of 'relayCall' for a transaction with a wrong signature", async function () {
          
          relayRequest.relayData.callVerifier = misbehavingVerifier.address
          
          await misbehavingVerifier.setReturnInvalidErrorCode(true)
          const relayCallView = await relayHub.connect(relayWorker)
            .relayCall(relayRequest, '0x')

          expect(relayCallView.verifierAccepted).to.be.false;

          expect(
            relayCallView.returnValue).to.equal(
            encodeRevertReason('invalid code'),
          )
          expect(
            decodeRevertReason(relayCallView.returnValue)).to.equal(
            'invalid code',
          )
        })
      })*/

      context('with funded verifier', function () {
        //let misbehavingVerifier: TestVerifierConfigurableMisbehavior;

        let signatureWithMisbehavingVerifier: string;
        let relayRequestMisbehavingVerifier: RelayRequest;
        const gas = 4e6;

        beforeEach(async function () {
          /*const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequest,
            owner,
          );*/

          relayRequestMisbehavingVerifier = cloneRelayRequest(relayRequest);
          relayRequestMisbehavingVerifier.relayData.callVerifier =
            misbehavingVerifier.address;
          ({ signature: signatureWithMisbehavingVerifier } =
            await getSuffixDataAndSignature(
              forwarder,
              relayRequestMisbehavingVerifier,
              owner
            ));
        });

        /*it.skip('gas prediction tests - with token payment', async function () {

            const nonceBefore = await forwarder.nonce();
            await token.mint('10000', forwarder.address);
            let swalletInitialBalance = await token.balanceOf(
                forwarder.address
            );
            let relayWorkerInitialBalance = await token.balanceOf(
                relayWorker.address
            );
            let message =
                'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING ';
            message = message.concat(message);

            let balanceToTransfer = ethers.utils.hexValue(
                swalletInitialBalance.toNumber()
            );

            const completeReq: RelayRequest = cloneRelayRequest(
                sharedRelayRequestData
            );

            const encodedFunction = recipient.interface.encodeFunctionData(
              'emitMessage',
              [message],
            )
            
            completeReq.request.data = encodedFunction;
            completeReq.request.nonce = nonceBefore.toString();
            completeReq.relayData.callForwarder =
                forwarder.address;
            completeReq.request.tokenAmount = balanceToTransfer;
            completeReq.request.tokenContract = token.address;

            let estimatedDestinationCallGas =
                await ethers.provider.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: completeReq.request.to,
                    gasPrice: completeReq.relayData.gasPrice,
                    data: completeReq.request.data
                });

            let internalDestinationCallCost =
                estimatedDestinationCallGas.toNumber() >
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    ? estimatedDestinationCallGas.toNumber() -
                      INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    : estimatedDestinationCallGas.toNumber();
            internalDestinationCallCost =
                internalDestinationCallCost *
                ESTIMATED_GAS_CORRECTION_FACTOR;

            let estimatedTokenPaymentGas =
                await ethers.provider.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: token.address,
                    data: token.interface.encodeFunctionData('transfer', [relayWorker.address, BigNumber.from(balanceToTransfer)]),
                });

            let internalTokenCallCost =
                estimatedTokenPaymentGas.toNumber() >
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    ? estimatedTokenPaymentGas.toNumber() -
                      INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    : estimatedTokenPaymentGas.toNumber();
            internalTokenCallCost =
                internalTokenCallCost *
                ESTIMATED_GAS_CORRECTION_FACTOR;

            completeReq.request.gas = ethers.utils.hexValue(
                internalDestinationCallCost
            );
            completeReq.request.tokenGas = ethers.utils.hexValue(
                internalTokenCallCost
            );

            const { signature } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

            let detailedEstimation = await ethers.provider.estimateGas({
                from: relayWorker.address,
                to: relayHub.address,
                data: relayHub.interface.encodeFunctionData('relayCall', [ completeReq, signature ]),
                gasPrice: '1',
                gasLimit: 6800000
            });

            // gas estimation fit
            // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
            // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
            const a0 = Number('35095.980');
            const a1 = Number('1.098');
            const estimatedCost =
                a1 *
                    (internalDestinationCallCost +
                        internalTokenCallCost) +
                a0;

            console.log(
                'The destination contract call estimate is: ',
                internalDestinationCallCost
            );
            console.log(
                'The token gas estimate is: ',
                internalTokenCallCost
            );
            console.log(
                'X = ',
                internalDestinationCallCost + internalTokenCallCost
            );
            console.log(
                'The predicted total cost is: ',
                estimatedCost
            );
            console.log(
                'Detailed estimation: ',
                detailedEstimation
            );
            const relayCallTrx = await relayHub.connect(relayWorker).relayCall(
                completeReq,
                signature,
                {
                    gasLimit: gas,
                    gasPrice: 1
                }
            );

            let sWalletFinalBalance = await token.balanceOf(
                forwarder.address
            );
            let relayWorkerFinalBalance = await token.balanceOf(
                relayWorker.address
            );

            expect(
                swalletInitialBalance.eq(
                    sWalletFinalBalance.add(BigNumber.from(balanceToTransfer))
                )
            ).to.equal(true, 'SW Payment did not occur');
            expect(
                relayWorkerFinalBalance.eq(
                    relayWorkerInitialBalance.add(
                        BigNumber.from(balanceToTransfer)
                    )
                )
            ).to.equal(true, 'Worker did not receive payment');

            let nonceAfter = await forwarder.nonce();
            expect(
                nonceBefore.add(1).toNumber()).to.equal(
                nonceAfter.toNumber(),
                'Incorrect nonce after execution'
            );

            let txReceipt = await relayCallTrx.wait();

            console.log(
                `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`
            );

            const sampleRecipientFilter = recipient.filters.SampleRecipientEmitted();
            let sampleRecipientEmittedEvent = await recipient.queryFilter(sampleRecipientFilter);

            expect(
                message).to.equal(
                sampleRecipientEmittedEvent[0]?.args.message
            );
            expect(
                forwarder.address.toLowerCase()).to.equal(
                sampleRecipientEmittedEvent[0]?.args.msgSender.toLowerCase()
            );
            expect(
                relayWorker.address.toLowerCase(),
                sampleRecipientEmittedEvent[0]?.args.origin.toLowerCase()
            );

            const transactionRelayedFilter = relayHub.filters.TransactionRelayed();
            let transactionRelayedEvent = await relayHub.queryFilter(transactionRelayedFilter);

            
            expect(
                transactionRelayedEvent !== undefined &&
                    transactionRelayedEvent !== null).to.equal(true,
                'TransactionRelayedEvent not found'
            );

            // SECOND CALL
            await token.mint('100', forwarder.address);

            swalletInitialBalance = await token.balanceOf(
                forwarder.address
            );
            balanceToTransfer = ethers.utils.hexValue(
                swalletInitialBalance.toNumber()
            );
            relayWorkerInitialBalance = await token.balanceOf(
                relayWorker.address
            );

            completeReq.request.tokenAmount = ethers.utils.hexValue(
                swalletInitialBalance
            );
            estimatedDestinationCallGas =
                await ethers.provider.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: completeReq.request.to,
                    gasPrice: completeReq.relayData.gasPrice,
                    data: completeReq.request.data
                });

            internalDestinationCallCost =
                estimatedDestinationCallGas.toNumber() >
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    ? estimatedDestinationCallGas.toNumber() -
                      INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    : estimatedDestinationCallGas.toNumber();
            internalDestinationCallCost =
                internalDestinationCallCost *
                ESTIMATED_GAS_CORRECTION_FACTOR;

            estimatedTokenPaymentGas = await ethers.provider.estimateGas({
                from: completeReq.relayData.callForwarder,
                to: token.address,
                data: token.interface.encodeFunctionData('transfer', [relayWorker.address, balanceToTransfer])

            });

            internalTokenCallCost =
                estimatedTokenPaymentGas.toNumber() >
                INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    ? estimatedTokenPaymentGas.toNumber() -
                      INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
                    : estimatedTokenPaymentGas.toNumber();
            internalTokenCallCost =
                internalTokenCallCost *
                ESTIMATED_GAS_CORRECTION_FACTOR;

            completeReq.request.gas = ethers.utils.hexValue(
                internalDestinationCallCost
            );
            completeReq.request.tokenGas = ethers.utils.hexValue(
                internalTokenCallCost
            );

            completeReq.request.nonce = nonceBefore
                .add(BigNumber.from(1))
                .toString();

            const { signature: sig } = await getSuffixDataAndSignature(forwarder, completeReq, owner);

            detailedEstimation = await ethers.provider.estimateGas({
                from: relayWorker.address,
                to: relayHub.address,
                data: relayHub.interface.encodeFunctionData('relayCall', [completeReq, signature]),
                gasPrice: '1'
            });

            const result = await relayHub.connect(relayWorker).relayCall(
                completeReq,
                sig,
                {
                    gasLimit: gas,
                    gasPrice: '1'
                }
            );

            console.log('ROUND 2');
            console.log(
                'The destination contract call estimate is: ',
                internalDestinationCallCost
            );
            console.log(
                'The token gas estimate is: ',
                internalTokenCallCost
            );
            console.log(
                'X = ',
                internalDestinationCallCost + internalTokenCallCost
            );
            console.log(
                'Detailed estimation: ',
                detailedEstimation
            );

            sWalletFinalBalance = await token.balanceOf(
                forwarder.address
            );
            relayWorkerFinalBalance = await token.balanceOf(
                relayWorker.address
            );

            expect(
                swalletInitialBalance.eq(
                    sWalletFinalBalance.add(BigNumber.from(balanceToTransfer))
                )).to.equal(true, 
                'SW Payment did not occur'
            );
            expect(
                relayWorkerFinalBalance.eq(
                    relayWorkerInitialBalance.add(
                        BigNumber.from(balanceToTransfer)
                    )
                )).to.equal(true,
                'Worker did not receive payment'
            );

            nonceAfter = await forwarder.nonce();
            expect(
                nonceBefore.add(2).toNumber()).to.equal(
                nonceAfter.toNumber(),
                'Incorrect nonce after execution'
            );

            txReceipt = await result.wait();

            console.log(
                `Cummulative Gas Used in second run: ${txReceipt.cumulativeGasUsed.toString()}`
            );

            sampleRecipientEmittedEvent = await recipient.queryFilter(sampleRecipientFilter);

            expect(
              message).to.equal(
              sampleRecipientEmittedEvent[0]?.args.message
          );
          expect(
              forwarder.address.toLowerCase()).to.equal(
              sampleRecipientEmittedEvent[0]?.args.msgSender.toLowerCase()
          );
          expect(
              relayWorker.address.toLowerCase(),
              sampleRecipientEmittedEvent[0]?.args.origin.toLowerCase()
          );

          transactionRelayedEvent = await relayHub.queryFilter(transactionRelayedFilter);

            
          expect(
              transactionRelayedEvent !== undefined &&
                  transactionRelayedEvent !== null).to.equal(true,
              'TransactionRelayedEvent not found'
          );
        });*/

        /*it.skip('gas prediction tests - without token payment', async function () {
            const SmartWallet = artifacts.require('SmartWallet');
            const smartWalletTemplate: SmartWalletInstance =
                await SmartWallet.new();
            const smartWalletFactory: SmartWalletFactoryInstance =
                await createSmartWalletFactory(smartWalletTemplate);
            const forwarder = await createSmartWallet(
                _,
                gaslessAccount.address,
                smartWalletFactory,
                gaslessAccount.privateKey,
                chainId
            );

            const nonceBefore = await forwarder.nonce();
            let swalletInitialBalance = await token.balanceOf(
                forwarder.address
            );
            let relayWorkerInitialBalance = await token.balanceOf(
                relayWorker
            );
            let message =
                'RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING RIF ENVELOPING ';
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);

            const completeReq: RelayRequest = cloneRelayRequest(
                sharedRelayRequestData
            );
            completeReq.request.data =
                recipientContract.contract.methods
                    .emitMessage(message)
                    .encodeABI();
            completeReq.request.nonce = nonceBefore.toString();
            completeReq.relayData.callForwarder =
                forwarder.address;
            completeReq.request.tokenAmount = '0x00';
            completeReq.request.tokenContract =
                constants.ZERO_ADDRESS;
            completeReq.request.tokenGas = '0x00';

            let estimatedDestinationCallGas =
                await web3.eth.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: completeReq.request.to,
                    gasPrice: completeReq.relayData.gasPrice,
                    data: completeReq.request.data
                });

            let internalDestinationCallCost =
                estimatedDestinationCallGas >
                constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                    ? estimatedDestinationCallGas -
                      constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                    : estimatedDestinationCallGas;
            internalDestinationCallCost =
                internalDestinationCallCost *
                constants.ESTIMATED_GAS_CORRECTION_FACTOR;

            completeReq.request.gas = toHex(
                internalDestinationCallCost
            );

            let reqToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                completeReq
            );

            let sig = getLocalEip712Signature(
                reqToSign,
                gaslessAccount.privateKey
            );

            let detailedEstimation = await web3.eth.estimateGas({
                from: relayWorker,
                to: relayHub.address,
                data: relayHub.contract.methods
                    .relayCall(completeReq, sig)
                    .encodeABI(),
                gasPrice,
                gas: 6800000
            });

            // gas estimation fit
            // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
            // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
            const a0 = Number('35095.980');
            const a1 = Number('1.098');
            const estimatedCost =
                a1 * internalDestinationCallCost + a0;

            console.log(
                'The destination contract call estimate is: ',
                internalDestinationCallCost
            );
            console.log('X = ', internalDestinationCallCost);
            console.log(
                'The predicted total cost is: ',
                estimatedCost
            );
            console.log(
                'Detailed estimation: ',
                detailedEstimation
            );
            const { tx } = await relayHub.relayCall(
                completeReq,
                sig,
                {
                    from: relayWorker,
                    gas,
                    gasPrice
                }
            );

            let sWalletFinalBalance = await token.balanceOf(
                forwarder.address
            );
            let relayWorkerFinalBalance = await token.balanceOf(
                relayWorker
            );

            assert.isTrue(
                swalletInitialBalance.eq(sWalletFinalBalance),
                'SW Payment did occur'
            );
            assert.isTrue(
                relayWorkerFinalBalance.eq(
                    relayWorkerInitialBalance
                ),
                'Worker did receive payment'
            );

            let nonceAfter = await forwarder.nonce();
            assert.equal(
                nonceBefore.addn(1).toNumber(),
                nonceAfter.toNumber(),
                'Incorrect nonce after execution'
            );

            let txReceipt = await web3.eth.getTransactionReceipt(
                tx
            );

            console.log(
                `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`
            );

            let logs = abiDecoder.decodeLogs(txReceipt.logs);
            let sampleRecipientEmittedEvent = logs.find(
                (e: any) =>
                    e != null && e.name === 'SampleRecipientEmitted'
            );

            assert.equal(
                message,
                sampleRecipientEmittedEvent.events[0].value
            );
            assert.equal(
                forwarder.address.toLowerCase(),
                sampleRecipientEmittedEvent.events[1].value.toLowerCase()
            );
            assert.equal(
                relayWorker.toLowerCase(),
                sampleRecipientEmittedEvent.events[2].value.toLowerCase()
            );

            let transactionRelayedEvent = logs.find(
                (e: any) =>
                    e != null && e.name === 'TransactionRelayed'
            );
            assert.isTrue(
                transactionRelayedEvent !== undefined &&
                    transactionRelayedEvent !== null,
                'TransactionRelayedEvent not found'
            );

            // SECOND CALL

            swalletInitialBalance = await token.balanceOf(
                forwarder.address
            );
            relayWorkerInitialBalance = await token.balanceOf(
                relayWorker
            );

            estimatedDestinationCallGas =
                await web3.eth.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: completeReq.request.to,
                    gasPrice: completeReq.relayData.gasPrice,
                    data: completeReq.request.data
                });

            internalDestinationCallCost =
                estimatedDestinationCallGas >
                constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                    ? estimatedDestinationCallGas -
                      constants.INTERNAL_TRANSACTION_ESTIMATE_CORRECTION
                    : estimatedDestinationCallGas;
            internalDestinationCallCost =
                internalDestinationCallCost *
                constants.ESTIMATED_GAS_CORRECTION_FACTOR;

            completeReq.request.gas = toHex(
                internalDestinationCallCost
            );

            completeReq.request.nonce = nonceBefore
                .add(BigNumber.from(1))
                .toString();
            reqToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                completeReq
            );

            sig = getLocalEip712Signature(
                reqToSign,
                gaslessAccount.privateKey
            );

            detailedEstimation = await web3.eth.estimateGas({
                from: relayWorker,
                to: relayHub.address,
                data: relayHub.contract.methods
                    .relayCall(completeReq, sig)
                    .encodeABI(),
                gasPrice
            });

            const result = await relayHub.relayCall(
                completeReq,
                sig,
                {
                    from: relayWorker,
                    gas,
                    gasPrice
                }
            );

            console.log('ROUND 2');
            console.log(
                'The destination contract call estimate is: ',
                internalDestinationCallCost
            );
            console.log('X = ', internalDestinationCallCost);
            console.log(
                'Detailed estimation: ',
                detailedEstimation
            );

            sWalletFinalBalance = await token.balanceOf(
                forwarder.address
            );
            relayWorkerFinalBalance = await token.balanceOf(
                relayWorker
            );

            assert.isTrue(
                swalletInitialBalance.eq(sWalletFinalBalance),
                'SW Payment did occur'
            );
            assert.isTrue(
                relayWorkerFinalBalance.eq(
                    relayWorkerInitialBalance
                ),
                'Worker did receive payment'
            );

            nonceAfter = await forwarder.nonce();
            assert.equal(
                nonceBefore.addn(2).toNumber(),
                nonceAfter.toNumber(),
                'Incorrect nonce after execution'
            );

            txReceipt = await web3.eth.getTransactionReceipt(
                result.tx
            );

            console.log(
                `Cummulative Gas Used in second run: ${txReceipt.cumulativeGasUsed}`
            );

            logs = abiDecoder.decodeLogs(txReceipt.logs);
            sampleRecipientEmittedEvent = logs.find(
                (e: any) =>
                    e != null && e.name === 'SampleRecipientEmitted'
            );

            assert.equal(
                message,
                sampleRecipientEmittedEvent.events[0].value
            );
            assert.equal(
                forwarder.address.toLowerCase(),
                sampleRecipientEmittedEvent.events[1].value.toLowerCase()
            );
            assert.equal(
                relayWorker.toLowerCase(),
                sampleRecipientEmittedEvent.events[2].value.toLowerCase()
            );

            transactionRelayedEvent = logs.find(
                (e: any) =>
                    e != null && e.name === 'TransactionRelayed'
            );
            assert.isTrue(
                transactionRelayedEvent !== undefined &&
                    transactionRelayedEvent !== null,
                'TransactionRelayedEvent not found'
            );
        });

        it.skip('gas estimation tests for SmartWallet', async function () {
            const SmartWallet = artifacts.require('SmartWallet');
            const smartWalletTemplate: SmartWalletInstance =
                await SmartWallet.new();
            const smartWalletFactory: SmartWalletFactoryInstance =
                await createSmartWalletFactory(smartWalletTemplate);
            const forwarder = await createSmartWallet(
                _,
                gaslessAccount.address,
                smartWalletFactory,
                gaslessAccount.privateKey,
                chainId
            );

            const nonceBefore = await forwarder.nonce();
            await token.mint('10000', forwarder.address);

            let message =
                'RIF Enveloping RIF Enveloping RIF Enveloping RIF Enveloping';
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            message = message.concat(message);
            const completeReq: RelayRequest = cloneRelayRequest(
                sharedRelayRequestData
            );
            completeReq.request.data =
                recipientContract.contract.methods
                    .emitMessage3(message)
                    .encodeABI();
            completeReq.request.nonce = nonceBefore.toString();
            completeReq.relayData.callForwarder =
                forwarder.address;
            completeReq.request.tokenAmount = '0x00';
            completeReq.request.tokenGas = '0';

            const reqToSign = new TypedRequestData(
                chainId,
                forwarder.address,
                completeReq
            );

            const sig = getLocalEip712Signature(
                reqToSign,
                gaslessAccount.privateKey
            );

            const estimatedDestinationCallCost =
                await web3.eth.estimateGas({
                    from: completeReq.relayData.callForwarder,
                    to: completeReq.request.to,
                    gasPrice: completeReq.relayData.gasPrice,
                    data: completeReq.request.data
                });

            const tokenPaymentEstimation = 0; 
            //const tokenPaymentEstimation = await web3.eth.estimateGas({
            //    from: completeReq.relayData.callForwarder,
            //    to: token.address,
            //    data: token.contract.methods.transfer(relayWorker, '1').encodeABI()
            //})

            // gas estimation fit
            // 5.10585×10^-14 x^3 - 2.21951×10^-8 x^2 + 1.06905 x + 92756.3
            // 8.2808×10^-14 x^3 - 8.62083×10^-8 x^2 + 1.08734 x + 36959.6
            const a0 = Number('37796.074');
            const a1 = Number('1.086');
            const estimatedCost =
                a1 *
                    (estimatedDestinationCallCost +
                        tokenPaymentEstimation) +
                a0;

            console.log(
                'The destination contract call estimate is: ',
                estimatedDestinationCallCost
            );
            console.log(
                'The token gas estimate is: ',
                tokenPaymentEstimation
            );
            console.log(
                'X = ',
                estimatedDestinationCallCost +
                    tokenPaymentEstimation
            );

            console.log(
                'The predicted total cost is: ',
                estimatedCost
            );
            const { tx } = await relayHub.relayCall(
                completeReq,
                sig,
                {
                    from: relayWorker,
                    gas,
                    gasPrice
                }
            );

            const nonceAfter = await forwarder.nonce();
            assert.equal(
                nonceBefore.addn(1).toNumber(),
                nonceAfter.toNumber(),
                'Incorrect nonce after execution'
            );

            const eventHash = keccak('GasUsed(uint256,uint256)');
            const txReceipt = await web3.eth.getTransactionReceipt(
                tx
            );

            // const overheadCost = txReceipt.cumulativeGasUsed - costForCalling - estimatedDestinationCallCost
            // console.log("data overhead: ", overheadCost)

            // console.log('---------------SmartWallet: RelayCall metrics------------------------')
            console.log(
                `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed}`
            );

            let previousGas: BigInt = BigInt(0);
            let previousStep = null;
            for (let i = 0; i < txReceipt.logs.length; i++) {
                const log = txReceipt.logs[i];
                if (
                    '0x' + eventHash.toString('hex') ===
                    log.topics[0]
                ) {
                    const step = log.data.substring(0, 66);
                    const gasUsed: BigInt = BigInt(
                        '0x' +
                            log.data.substring(67, log.data.length)
                    );
                    console.log(
                        '---------------------------------------'
                    );
                    console.log('step :', BigInt(step).toString());
                    console.log('gasLeft :', gasUsed.toString());

                    if (previousStep != null) {
                        console.log(
                            `Steps substraction ${BigInt(
                                step
                            ).toString()} and ${BigInt(
                                previousStep
                            ).toString()}`
                        );
                        console.log(
                            (
                                previousGas.valueOf() -
                                gasUsed.valueOf()
                            ).toString()
                        );
                    }
                    console.log(
                        '---------------------------------------'
                    );

                    // TODO: we should check this
                    // @ts-ignore
                    previousGas = BigInt(gasUsed);
                    previousStep = step;
                }
            }

            const logs = abiDecoder.decodeLogs(txReceipt.logs);
            const sampleRecipientEmittedEvent = logs.find(
                (e: any) =>
                    e != null && e.name === 'SampleRecipientEmitted'
            );

            assert.equal(
                message,
                sampleRecipientEmittedEvent.events[0].value
            );
            assert.equal(
                forwarder.address.toLowerCase(),
                sampleRecipientEmittedEvent.events[1].value.toLowerCase()
            );
            assert.equal(
                relayWorker.toLowerCase(),
                sampleRecipientEmittedEvent.events[2].value.toLowerCase()
            );

            const transactionRelayedEvent = logs.find(
                (e: any) =>
                    e != null && e.name === 'TransactionRelayed'
            );

            assert.isNotNull(transactionRelayedEvent);

            // const callWithoutRelay = await recipientContract.emitMessage(message)
            // const gasUsed: number = callWithoutRelay.receipt.cumulativeGasUsed
            // const txReceiptWithoutRelay = await web3.eth.getTransactionReceipt(callWithoutRelay)
            // console.log('--------------- Destination Call Without enveloping------------------------')
            // console.log(`Cummulative Gas Used: ${gasUsed}`)
            // console.log('---------------------------------------')
            // console.log('--------------- Enveloping Overhead ------------------------')
            // console.log(`Overhead Gas: ${txReceipt.cumulativeGasUsed - gasUsed}`)
            // console.log('---------------------------------------')
        });*/

        it('gas estimation tests', async function () {
          const nonceBefore = await forwarder.nonce();

          await token.mint('1000000', forwarder.address);

          const completeReq: RelayRequest = {
            request: {
              ...relayRequest.request,
              data: recipient.interface.encodeFunctionData('emitMessage', [
                message,
              ]),
              nonce: nonceBefore.toNumber(),
              tokenContract: token.address,
              tokenAmount: '0',
              tokenGas: '0',
            },
            relayData: {
              ...relayRequest.relayData,
            },
          };

          const { signature: sig } = await getSuffixDataAndSignature(
            forwarder,
            completeReq,
            owner
          );

          const relayCallTrx = await relayHub
            .connect(relayWorker)
            .relayCall(completeReq, sig, {
              gasLimit: gas,
              gasPrice: '1',
            });

          const nonceAfter = await forwarder.nonce();
          expect(nonceBefore.add(1).toNumber()).to.equal(nonceAfter.toNumber());

          const eventHash = ethers.utils.keccak256(
            Buffer.from('GasUsed(uint256,uint256)')
          );
          const txReceipt = await relayCallTrx.wait();
          console.log('---------------------------------------');

          console.log(`Gas Used: ${txReceipt.gasUsed.toString()}`);
          console.log(
            `Cummulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}`
          );

          let previousGas = BigInt(0);
          let previousStep = null;
          // not sure about this loop
          for (let i = 0; i < txReceipt.logs.length; i++) {
            const log = txReceipt.logs[i];
            if (ethers.utils.hexValue(eventHash) === log?.topics[0]) {
              const step = log.data.substring(0, 66);
              const gasUsed = BigInt(
                '0x' + log.data.substring(67, log.data.length)
              );
              console.log('---------------------------------------');
              console.log('step :', BigInt(step).toString());
              console.log('gasLeft :', gasUsed.toString());

              if (previousStep != null) {
                console.log(
                  `Steps substraction ${BigInt(step).toString()} and ${BigInt(
                    previousStep
                  ).toString()}`
                );
                console.log(
                  (previousGas.valueOf() - gasUsed.valueOf()).toString()
                );
              }
              console.log('---------------------------------------');
              previousGas = BigInt(gasUsed);
              previousStep = step;
            }
          }

          const sampleRecipientEmittedFilter =
            recipient.filters.SampleRecipientEmitted();
          const sampleRecipientEmittedEvent = await recipient.queryFilter(
            sampleRecipientEmittedFilter
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

          expect(transactionRelayedEvent).to.not.be.null;
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
              gasLimit: gas,
              gasPrice: '1',
            });

          await expect(relayCall).to.be.rejectedWith('Not an enabled worker');
        });

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await forwarder.nonce();

          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequest, signatureWithPermissiveVerifier, {
              gasLimit: gas,
              gasPrice: '1',
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

          expect(transactionRelayedEvent).to.not.be.null;
        });

        it('relayCall should refuse to re-send transaction with same nonce', async function () {
          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequest, signatureWithPermissiveVerifier, {
              gasLimit: gas,
              gasPrice: '1',
            });

          const recipientEmittedFilter =
            recipient.filters.SampleRecipientEmitted();
          const sampleRecipientEmittedEvent = await recipient.queryFilter(
            recipientEmittedFilter
          );

          expect(sampleRecipientEmittedEvent).to.not.be.null;

          const relayCall = relayHub
            .connect(relayWorker)
            .relayCall(relayRequest, signatureWithPermissiveVerifier, {
              gasLimit: gas,
              gasPrice: '1',
            });

          await expect(relayCall).to.be.rejectedWith('nonce mismatch');
        });
        // This test is added due to a regression that almost slipped to production.
        it('relayCall executes the transaction with no parameters', async function () {
          const encodedFunction = recipient.interface.encodeFunctionData(
            'emitMessageNoParams'
          );
          const relayRequestNoCallData = cloneRelayRequest(relayRequest);
          relayRequestNoCallData.request.data = encodedFunction;

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequestNoCallData,
            owner
          );

          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequestNoCallData, signature, {
              gasLimit: gas,
              gasPrice: '1',
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

        it('relayCall executes a transaction even if recipient call reverts', async function () {
          const encodedFunction =
            recipient.interface.encodeFunctionData('testRevert');

          const relayRequestRevert = cloneRelayRequest(relayRequest);
          relayRequestRevert.request.data = encodedFunction;

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequestRevert,
            owner
          );

          await relayHub
            .connect(relayWorker)
            .relayCall(relayRequestRevert, signature, {
              gasLimit: gas,
              gasPrice: '1',
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
                gasPrice: '1',
                gasLimit: '60000',
              }
            );

          await expect(relayCall).to.be.rejectedWith('transaction reverted');
        });

        it('should not accept relay requests with gas price lower than user specified', async function () {
          const relayRequestMisbehavingVerifier =
            cloneRelayRequest(relayRequest);
          relayRequestMisbehavingVerifier.relayData.callVerifier =
            misbehavingVerifier.address;
          relayRequestMisbehavingVerifier.relayData.gasPrice = (
            BigInt('1') + BigInt(1)
          ).toString();

          const { signature } = await getSuffixDataAndSignature(
            forwarder,
            relayRequestMisbehavingVerifier,
            owner
          );

          const relayCall = relayHub
            .connect(relayWorker)
            .relayCall(relayRequestMisbehavingVerifier, signature, {
              gasLimit: gas,
              gasPrice: '1',
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
                gasLimit: gas,
                gasPrice: '1',
              }
            );

          const transactionRelayedFilter =
            relayHub.filters.TransactionRelayed();
          const transactionRelayedEvent = await relayHub.queryFilter(
            transactionRelayedFilter
          );

          expect(transactionRelayedEvent).to.not.be.null;
        });
      });
    });
  });

  describe('deployCall', function () {
    let min = 0;
    let max = 1000000000;
    let nextWalletIndex: number;
    let sharedDeployRequestData: DeployRequest;
    let deployVerifier: TestDeployVerifierEverythingAccepted;
    let unknownWorker: SignerWithAddress;

    beforeEach(async function () {
      min = Math.ceil(min);
      max = Math.floor(max);
      nextWalletIndex = Math.floor(Math.random() * (max - min + 1) + min);

      deployVerifier = await ethers
        .getContractFactory('TestDeployVerifierEverythingAccepted')
        .then((contractFactory) => contractFactory.deploy());
      [unknownWorker] = (await ethers.getSigners()) as [SignerWithAddress];

      sharedDeployRequestData = {
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
        },
        relayData: {
          gasPrice: '1',
          feesReceiver: relayWorker.address,
          callForwarder: factory.address,
          callVerifier: deployVerifier.address,
        },
      };
    });

    context('with unknown worker', function () {
      const gas = 4e6;
      let deployRequest: DeployRequest;
      let signature: string;

      beforeEach(async function () {
        deployRequest = {
          relayData: { ...sharedDeployRequestData.relayData },
          request: { ...sharedDeployRequestData.request },
        };

        deployRequest.request.index = nextWalletIndex.toString();
        deployRequest.relayData.feesReceiver = unknownWorker.address;
        ({ signature } = await signEnvelopingRequest(deployRequest, owner));

        nextWalletIndex++;
      });

      it('should not accept a deploy call - 2', async function () {
        const deployCall = relayHub
          .connect(unknownWorker)
          .deployCall(deployRequest, signature, {
            gasLimit: gas,
          });

        await expect(deployCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with manager stake unlocked', function () {
      const gasLimit = 4e6;
      let signature: string;
      let deployRequest: DeployRequest;

      beforeEach(async function () {
        deployRequest = {
          relayData: { ...sharedDeployRequestData.relayData },
          request: { ...sharedDeployRequestData.request },
        };
        deployRequest.request.index = nextWalletIndex.toString();

        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('1'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
        ({ signature } = await signEnvelopingRequest(deployRequest, owner));
        nextWalletIndex++;
      });

      it('should not accept a deploy call with an unstaked RelayManager', async function () {
        await relayHub.connect(relayOwner).unlockStake(relayManager.address);

        const deployCall = relayHub
          .connect(relayWorker)
          .deployCall(deployRequest, signature, {
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
          .deployCall(deployRequest, signature, {
            gasLimit,
          });

        await expect(deployCall).to.be.rejectedWith('Not an enabled worker');
      });
    });

    context('with staked and registered relay', function () {
      const url = 'http://relay.com';
      let deployRequest: DeployRequest;

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

        deployRequest = {
          relayData: { ...sharedDeployRequestData.relayData },
          request: { ...sharedDeployRequestData.request },
        };
        deployRequest.request.index = nextWalletIndex.toString();
        nextWalletIndex++;
      });

      context(
        'with relay worker that is not externally-owned account',
        function () {
          it('should not accept deploy requests', async function () {
            const signature = '0xdeadbeef';
            const gasLimit = 4e6;

            const testRelayWorkerContract = await ethers
              .getContractFactory('TestRelayWorkerContract')
              .then((contract) => contract.deploy());

            await relayHub
              .connect(relayManager)
              .addRelayWorkers([testRelayWorkerContract.address]);

            const deployCall = testRelayWorkerContract.deployCall(
              relayHub.address,
              deployRequest,
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

      context('with funded verifier', function () {
        let misbehavingVerifier: TestDeployVerifierConfigurableMisbehavior;
        let signatureWithMisbehavingVerifier: string;
        let relayRequestMisbehavingVerifier: DeployRequest;
        const gasLimit = 4e6;

        beforeEach(async function () {
          misbehavingVerifier = await ethers
            .getContractFactory('TestDeployVerifierConfigurableMisbehavior')
            .then((contract) => contract.deploy());
          deployRequest.request.index = nextWalletIndex.toString();
          nextWalletIndex++;

          await fundedAccount.sendTransaction({
            to: misbehavingVerifier.address,
            value: ethers.utils.parseEther('1'),
          });

          relayRequestMisbehavingVerifier = {
            relayData: { ...deployRequest.relayData },
            request: { ...deployRequest.request },
          };
          relayRequestMisbehavingVerifier.relayData.callVerifier =
            misbehavingVerifier.address;

          //relayRequestMisbehavingVerifier.request.tokenGas = '100000';
          ({ signature: signatureWithMisbehavingVerifier } =
            await signEnvelopingRequest(
              relayRequestMisbehavingVerifier,
              owner
            ));
        });

        it('deployCall executes the transaction and increases sender nonce on factory', async function () {
          const nonceBefore = await factory.nonce(owner.address);
          const calculatedAddr = await factory.getSmartWalletAddress(
            owner.address,
            ethers.constants.AddressZero,
            relayRequestMisbehavingVerifier.request.index
          );
          await token.mint('1', calculatedAddr);

          await relayHub
            .connect(relayWorker)
            .deployCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice: '1',
              }
            );

          const deployedFilter = factory.filters.Deployed();
          const deployedEvent = await factory.queryFilter(deployedFilter);

          expect(deployedEvent !== undefined).to.equal(
            true,
            'No Deployed event found'
          );

          expect(calculatedAddr).to.equal(deployedEvent[1]?.args.addr);

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
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice: '1',
              }
            );

          await expect(deployCall).to.be.rejectedWith('Not an enabled worker');
        });

        it('deployCall should refuse to re-send transaction with same nonce', async function () {
          const calculatedAddr = await factory.getSmartWalletAddress(
            owner.address,
            ethers.constants.AddressZero,
            relayRequestMisbehavingVerifier.request.index
          );
          await token.mint('2', calculatedAddr);

          await relayHub
            .connect(relayWorker)
            .deployCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice: '1',
              }
            );

          const deployedFilter = factory.filters.Deployed();
          const deployedEvent = await factory.queryFilter(deployedFilter);

          expect(deployedEvent !== undefined).to.equal(
            true,
            'No Deployed event found'
          );

          expect(calculatedAddr).to.equal(deployedEvent[1]?.args.addr);

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice: '1',
              }
            );

          await expect(deployCall).to.be.rejectedWith('nonce mismatch');
        });

        it('should not accept deploy requests if passed gas is too low for a relayed transaction', async function () {
          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasPrice: '1',
                gasLimit: '60000',
              }
            );

          await expect(deployCall).to.be.rejectedWith('transaction reverted');
        });

        it('should not accept deploy requests with gas price lower than user specified', async function () {
          const deployRequestMisbehavingVerifier: DeployRequest = {
            relayData: {
              ...deployRequest.relayData,
            },
            request: {
              ...deployRequest.request,
            },
          };

          deployRequestMisbehavingVerifier.relayData.callVerifier =
            misbehavingVerifier.address;
          deployRequestMisbehavingVerifier.relayData.gasPrice = (
            BigInt(1) + BigInt(1)
          ).toString();

          const deployCall = relayHub
            .connect(relayWorker)
            .deployCall(
              deployRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasLimit,
                gasPrice: '1',
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
            relayRequestMisbehavingVerifier.request.index
          );
          await token.mint('1', calculatedAddr);

          await relayHub
            .connect(incorrectWorker)
            .deployCall(
              relayRequestMisbehavingVerifier,
              signatureWithMisbehavingVerifier,
              {
                gasPrice: '1',
                gasLimit,
              }
            );

          const deployedFilter = factory.filters.Deployed();
          const deployedEvent = await factory.queryFilter(deployedFilter);
          expect(deployedEvent !== undefined).to.equal(
            true,
            'No Deployed event found'
          );
        });
      });
    });
  });

  describe('penalize', function () {
    const gasLimit = 4e6;
    let beneficiary: SignerWithAddress;
    let penalizerMock: SignerWithAddress;

    beforeEach(async function () {
      [penalizerMock, beneficiary] = (await ethers.getSigners()) as [
        SignerWithAddress,
        SignerWithAddress
      ];

      const relayHubFactory = await ethers.getContractFactory('RelayHub');

      relayHub = await relayHubFactory.deploy(
        penalizerMock.address,
        10,
        (1e18).toString(),
        1000,
        (1e18).toString()
      );
    });

    context('with unknown worker', function () {
      beforeEach(async function () {
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('1'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
      });

      it('should not penalize when an unknown worker is specified', async function () {
        try {
          const [unknownWorker] = (await ethers.getSigners()) as [
            SignerWithAddress
          ];

          await relayHub
            .connect(penalizerMock)
            .penalize(unknownWorker.address, beneficiary.address, {
              gasLimit,
            });
        } catch (error) {
          const err: string =
            error instanceof Error ? error.message : JSON.stringify(error);
          expect(err.includes('Unknown relay worker')).to.be.true;
        }
      });
    });

    context('with manager stake unlocked', function () {
      beforeEach(async function () {
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('1'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
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

        try {
          await relayHub
            .connect(penalizerMock)
            .penalize(relayWorker.address, beneficiary.address, {
              gasLimit,
            });
        } catch (error) {
          const err: string =
            error instanceof Error ? error.message : JSON.stringify(error);
          expect(err.includes('Unstaked relay manager')).to.be.true;
        }

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
        await relayHub
          .connect(relayOwner)
          .stakeForAddress(relayManager.address, 1000, {
            value: ethers.utils.parseEther('2'),
          });
        await relayHub
          .connect(relayManager)
          .addRelayWorkers([relayWorker.address]);
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

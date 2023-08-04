import { ethers } from 'hardhat';
import { expect } from 'chai';
import config from 'config';
import { deployRelayHub, evmMineMany } from '../utils/TestUtils';
import {
  assertEventHub,
  getTemporaryWorkdirs,
  getTotalTxCosts,
  loadConfiguration,
  ServerWorkdirs,
} from './ServerTestUtils';
import {
  AppConfig,
  getServerConfig,
  isRegistrationValid,
  KeyManager,
  RegistrationManager,
  RelayServer,
  ServerAction,
  ServerConfigParams,
  ServerDependencies,
  StoredTransaction,
  TxStoreManager,
} from '@rsksmart/rif-relay-server';
import {
  getFundedServer,
  getInitiatedServer,
  getServerInstance,
} from './ServerTestEnvironments';
import { BigNumber, constants, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { RelayHub } from 'typechain-types';
import { TypedEvent } from '@rsksmart/rif-relay-contracts';

const SERVER_WORK_DIR = './tmp/enveloping/test/server';

const basicAppConfig: Partial<AppConfig> = {
  checkInterval: 10,
  logLevel: 5,
  workdir: SERVER_WORK_DIR,
};

const workerIndex = 0;

const unstakeDelay = 50;

const oneEther = utils.parseEther('1');

const maxWorkerCount = 1;
const minimumEntryDepositValue = oneEther;
const minimumUnstakeDelay = 50;
const minimumStake = oneEther;

type RegistrationManagerExposed = {
  _ownerAddress: string | undefined;
  _managerAddress: string;
  _delayedEvents: Array<{ block: number; eventData: TypedEvent }>;
  _extractDuePendingEvents: (currentBlock: number) => TypedEvent[];
} & {
  [key in keyof RegistrationManager]: RegistrationManager[key];
};

type RelayServerExposed = {
  _lastScannedBlock: number;
  _lastSuccessfulRounds: number;
} & {
  [key in keyof RelayServer]: RelayServer[key];
};

const provider = ethers.provider;

describe('RegistrationManager', function () {
  let originalConfig: ServerConfigParams;

  before(function () {
    originalConfig = config.util.toObject(config) as ServerConfigParams;
  });

  afterEach(function () {
    config.util.extendDeep(config, originalConfig);
  });

  describe('multi-step server initialization', function () {
    let relayServer: RelayServer;
    let relayOwner: SignerWithAddress;
    let relayHub: RelayHub;
    let serverWorkdirs: ServerWorkdirs;

    beforeEach(async function () {
      [relayOwner] = (await ethers.getSigners()) as [SignerWithAddress];
      relayHub = await deployRelayHub(undefined, {
        maxWorkerCount,
        minimumEntryDepositValue,
        minimumUnstakeDelay,
        minimumStake,
      });
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
      });
      serverWorkdirs = getTemporaryWorkdirs();
    });

    it('should wait for manager balance', async function () {
      relayServer = getServerInstance({ relayOwner, serverWorkdirs });
      let latestBlock = await provider.getBlock('latest');
      let transactionHashes = await relayServer._worker(latestBlock.number);
      let managerBalance = await relayServer.getManagerBalance();

      const expectedBalance = utils.parseEther('2');

      expect(transactionHashes.length).to.be.equal(0);
      expect(managerBalance).to.not.be.equal(expectedBalance);

      const { relayManagerAddress } = relayServer.getChainInfo();
      await relayOwner.sendTransaction({
        to: relayManagerAddress,
        value: expectedBalance,
      });
      latestBlock = await provider.getBlock('latest');
      transactionHashes = await relayServer._worker(latestBlock.number);
      managerBalance = await relayServer.getManagerBalance();

      expect(transactionHashes.length).to.be.equal(0);
      expect(relayServer.isReady()).to.be.false;
      expect(managerBalance).to.be.equal(expectedBalance);
    });

    it('should wait for stake and fund workers', async function () {
      relayServer = getServerInstance({ relayOwner, serverWorkdirs });
      const { relayManagerAddress } = relayServer.getChainInfo();
      await relayOwner.sendTransaction({
        to: relayManagerAddress,
        value: utils.parseEther('2'),
      });

      let latestBlock = await provider.getBlock('latest');
      const transactionHashes = await relayServer._worker(latestBlock.number);

      expect(transactionHashes.length).to.be.equal(0);
      expect(relayServer.isReady()).to.be.false;

      await relayHub
        .connect(relayOwner)
        .stakeForAddress(relayManagerAddress, unstakeDelay, {
          value: oneEther,
        });
      const workerBalanceBefore = await relayServer.getWorkerBalance(
        workerIndex
      );

      expect(workerBalanceBefore).to.be.equal(constants.Zero);

      latestBlock = await provider.getBlock('latest');
      const receipts = await relayServer._worker(latestBlock.number);
      await relayServer._worker(latestBlock.number + 1);
      const workerBalanceAfter = await relayServer.getWorkerBalance(
        workerIndex
      );
      const localServer = relayServer as unknown as RelayServerExposed;
      const { registrationManager } = relayServer as unknown as {
        registrationManager: RegistrationManagerExposed;
      };
      const {
        blockchain: { workerTargetBalance },
      } = getServerConfig();

      expect(localServer._lastScannedBlock).to.be.equal(latestBlock.number + 1);
      expect(registrationManager.stakeRequired.currentValue).to.be.equal(
        oneEther
      );
      expect(registrationManager);
      expect(registrationManager._ownerAddress, relayOwner.address).to.be.equal(
        relayOwner.address
      );
      expect(workerBalanceAfter).to.be.equal(workerTargetBalance);
      expect(relayServer.isReady()).to.be.true;

      await assertEventHub('RelayServerRegistered', receipts);
      await assertEventHub('RelayWorkersAdded', receipts);
    });

    it('should start again after restarting process', async function () {
      relayServer = await getInitiatedServer({ relayOwner, serverWorkdirs });
      await relayServer.transactionManager.txStoreManager.clearAll();
      const managerKeyManager = new KeyManager(
        1,
        serverWorkdirs.managerWorkdir
      );
      const workersKeyManager = new KeyManager(
        1,
        serverWorkdirs.workersWorkdir
      );
      const txStoreManager = new TxStoreManager({
        workdir: serverWorkdirs.workdir,
      });
      const dependencies: ServerDependencies = {
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
      };
      const newRelayServer = new RelayServer(
        dependencies
      ) as unknown as RelayServerExposed;
      await newRelayServer.init();
      const latestBlock = await provider.getBlock('latest');
      await newRelayServer._worker(latestBlock.number);

      expect(relayServer.isReady()).to.be.true;
      expect(newRelayServer.isReady()).to.be.true;
    });
  });

  describe('single step server initialization', function () {
    beforeEach(async function () {
      const relayHub = await deployRelayHub(undefined, {
        maxWorkerCount,
        minimumEntryDepositValue,
        minimumUnstakeDelay,
        minimumStake,
      });
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
      });
    });

    it('should initialize relay after staking and funding it', async function () {
      const relayOwner = (await ethers.getSigners()).at(0) as SignerWithAddress;
      const relayServer = (await getFundedServer(
        { relayOwner },
        undefined,
        unstakeDelay
      )) as unknown as RelayServerExposed;
      await relayServer.init();

      const { registrationManager } = relayServer as unknown as {
        registrationManager: RegistrationManagerExposed;
      };

      expect(registrationManager._ownerAddress).to.be.undefined;

      await registrationManager.refreshStake();

      expect(registrationManager.stakeRequired.currentValue.eq(oneEther)).to.be
        .true;

      expect(
        registrationManager._ownerAddress,
        'owner should be set after refreshing stake'
      ).to.be.equal(relayOwner.address);

      const {
        blockchain: { gasPriceFactor, workerTargetBalance },
      } = getServerConfig();

      const gasPrice = await provider.getGasPrice();

      const expectedGasPrice = gasPrice.mul(gasPriceFactor);

      expect(relayServer.isReady()).to.be.false;

      expect(relayServer._lastScannedBlock).to.be.equal(1);

      const workerBalanceBefore = await relayServer.getWorkerBalance(
        workerIndex
      );

      expect(workerBalanceBefore).to.be.equal(constants.Zero);

      const latestBlock = await provider.getBlock('latest');
      const receipts = await relayServer._worker(latestBlock.number);

      await relayServer._worker(latestBlock.number + 1);
      expect(relayServer._lastScannedBlock).to.be.equal(latestBlock.number + 1);
      expect(relayServer.gasPrice).to.be.equal(expectedGasPrice);

      expect(relayServer.isReady(), 'relay no ready?').to.be.true;
      const workerBalanceAfter = await relayServer.getWorkerBalance(
        workerIndex
      );
      expect(registrationManager.stakeRequired.currentValue.eq(oneEther)).to.be
        .true;
      expect(registrationManager._ownerAddress).to.be.equal(relayOwner.address);
      expect(workerBalanceAfter).to.be.equal(workerTargetBalance);

      await assertEventHub('RelayServerRegistered', receipts);
      await assertEventHub('RelayWorkersAdded', receipts);
    });
  });

  describe('configuration change', function () {
    let relayServer: RelayServer;

    beforeEach(async function () {
      const relayOwner = (await ethers.getSigners()).at(0) as SignerWithAddress;
      const relayHub = await deployRelayHub(undefined, {
        maxWorkerCount,
        minimumEntryDepositValue,
        minimumUnstakeDelay,
        minimumStake,
      });
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
        blockchain: {
          refreshStateTimeoutBlocks: 1,
        },
      });
      relayServer = await getFundedServer(
        { relayOwner },
        undefined,
        unstakeDelay
      );
    });

    describe('handlePastEvents', function () {
      it('should re-register server with new configuration', async function () {
        let latestBlock = await provider.getBlock('latest');
        const receipts = await relayServer._worker(latestBlock.number);

        await assertEventHub('RelayServerRegistered', receipts);
        await assertEventHub('RelayWorkersAdded', receipts);

        await relayServer._worker(latestBlock.number + 1);

        const { registrationManager } = relayServer;

        let transactionHashes = await registrationManager.handlePastEvents(
          [],
          latestBlock.number,
          0,
          false
        );

        expect(
          transactionHashes.length,
          'should not re-register if already registered'
        ).to.be.equal(0);

        latestBlock = await provider.getBlock('latest');
        await relayServer._worker(latestBlock.number);

        relayServer.config.app.url = 'http://fake_url';
        transactionHashes = await registrationManager.handlePastEvents(
          [],
          latestBlock.number,
          0,
          false
        );

        await assertEventHub('RelayServerRegistered', transactionHashes);
      });
    });

    describe('isRegistrationValid', function () {
      it('should return true if validation is valid', async function () {
        const latestBlock = await provider.getBlock('latest');
        await relayServer._worker(latestBlock.number);

        const { registrationManager } = relayServer as unknown as {
          registrationManager: RegistrationManagerExposed;
        };

        const relayData = await registrationManager.getRelayData();

        const isValid = isRegistrationValid(
          relayData,
          registrationManager._managerAddress
        );

        expect(isValid).to.be.true;
      });

      it('should return false if validation is not valid', async function () {
        const latestBlock = await provider.getBlock('latest');
        await relayServer._worker(latestBlock.number);

        const { registrationManager } = relayServer as unknown as {
          registrationManager: RegistrationManagerExposed;
        };

        relayServer.config.app.url = 'http://fake_url';

        const relayData = await registrationManager.getRelayData();
        const isValid = isRegistrationValid(
          relayData,
          registrationManager._managerAddress
        );

        expect(isValid).to.be.false;
      });
    });
  });

  describe('event handlers', function () {
    let relayServer: RelayServer;
    let relayHub: RelayHub;
    let relayOwner: SignerWithAddress;

    beforeEach(async function () {
      relayOwner = (await ethers.getSigners()).at(0) as SignerWithAddress;
      relayHub = await deployRelayHub(undefined, {
        maxWorkerCount,
        minimumEntryDepositValue,
        minimumUnstakeDelay,
        minimumStake,
      });
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
        blockchain: {
          refreshStateTimeoutBlocks: 1,
        },
      });
      relayServer = await getFundedServer(
        { relayOwner },
        undefined,
        unstakeDelay
      );
      const latestBlock = await provider.getBlock('latest');
      await relayServer._worker(latestBlock.number);
      await relayServer._worker(latestBlock.number + 1);
    });

    describe('Withdrawn event', function () {
      it('should send manager/worker balances back to owner', async function () {
        const { relayManagerAddress } = relayServer.getChainInfo();

        await relayHub.connect(relayOwner).unlockStake(relayManagerAddress);
        await evmMineMany(unstakeDelay);
        await relayHub.connect(relayOwner).withdrawStake(relayManagerAddress);

        const managerBalanceBefore = await relayServer.getManagerBalance();
        const workerBalanceBefore = await relayServer.getWorkerBalance(
          workerIndex
        );

        expect(managerBalanceBefore.gt(constants.Zero)).to.be.true;
        expect(workerBalanceBefore.gt(constants.Zero)).to.be.true;

        const { registrationManager } = relayServer as unknown as {
          registrationManager: RegistrationManagerExposed;
        };

        expect(registrationManager.stakeRequired.currentValue).to.be.equal(
          oneEther
        );

        const gasPrice = await provider.getGasPrice();

        const ownerBalanceBefore = await provider.getBalance(
          registrationManager._ownerAddress as string
        );

        const latestBlock = await provider.getBlock('latest');
        const receipts = await relayServer._worker(latestBlock.number);
        const totalTxCosts = await getTotalTxCosts(receipts, gasPrice);

        const ownerBalanceAfter = await provider.getBalance(
          registrationManager._ownerAddress as string
        );

        expect(
          ownerBalanceAfter.sub(ownerBalanceBefore),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) !=
                + managerBalanceBefore(${managerBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
               - totalTxCosts(${totalTxCosts.toString()})`
        ).to.be.equal(
          managerBalanceBefore.add(workerBalanceBefore).sub(totalTxCosts)
        );

        const managerBalanceAfter = await relayServer.getManagerBalance();
        const workerBalanceAfter = await relayServer.getWorkerBalance(
          workerIndex
        );

        expect(managerBalanceAfter).to.be.equal(constants.Zero);
        expect(workerBalanceAfter).to.be.equal(constants.Zero);
      });

      it("should emit 'unstaked' when withdrawing funds", async function () {
        const { relayManagerAddress } = relayServer.getChainInfo();

        await relayHub.connect(relayOwner).unlockStake(relayManagerAddress);
        await evmMineMany(unstakeDelay);
        await relayHub.connect(relayOwner).withdrawStake(relayManagerAddress);

        let unstakedEmitted = false;
        relayServer.on('unstaked', () => {
          unstakedEmitted = true;
        });

        const latestBlock = await provider.getBlock('latest');
        await relayServer._worker(latestBlock.number);

        expect(unstakedEmitted, 'unstaked not emitted').to.be.true;
      });
    });

    describe('HubUnauthorized event', function () {
      it('should not send balance immediately after unauthorize (before unstake delay)', async function () {
        const workerBalanceBefore = await relayServer.getWorkerBalance(
          workerIndex
        );

        const { relayManagerAddress } = relayServer.getChainInfo();

        await relayHub.connect(relayOwner).unlockStake(relayManagerAddress);

        await evmMineMany(unstakeDelay - 3);
        const latestBlock = await provider.getBlock('latest');

        const receipt = await relayServer._worker(latestBlock.number);
        const receipt2 = await relayServer._worker(latestBlock.number + 1);

        expect(receipt.length).to.be.equal(0);
        expect(receipt2.length).to.be.equal(0);

        const workerBalanceAfter = await relayServer.getWorkerBalance(
          workerIndex
        );

        expect(workerBalanceBefore).to.be.equal(workerBalanceAfter);
      });

      it('send only workers balances to owner (not manager hub) - after unstake delay', async function () {
        const { relayManagerAddress } = relayServer.getChainInfo();

        await relayHub.connect(relayOwner).unlockStake(relayManagerAddress);

        const managerBalanceBefore = await relayServer.getManagerBalance();
        const workerBalanceBefore = await relayServer.getWorkerBalance(
          workerIndex
        );

        expect(managerBalanceBefore.gt(constants.Zero)).to.be.true;
        expect(workerBalanceBefore.gt(constants.Zero)).to.be.true;

        const ownerBalanceBefore = await provider.getBalance(
          relayOwner.address
        );

        await evmMineMany(unstakeDelay);

        const latestBlock = await provider.getBlock('latest');

        const receipts = await relayServer._worker(latestBlock.number);

        const gasPrice = await provider.getGasPrice();

        const workerEthTxCost = await getTotalTxCosts(receipts, gasPrice);

        const ownerBalanceAfter = await provider.getBalance(relayOwner.address);
        const managerBalanceAfter = await relayServer.getManagerBalance();
        const workerBalanceAfter = await relayServer.getWorkerBalance(
          workerIndex
        );

        expect(workerBalanceAfter).to.be.equal(constants.Zero);
        expect(managerBalanceAfter).to.be.equal(managerBalanceBefore);
        expect(
          ownerBalanceAfter.sub(ownerBalanceBefore),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) != 
                + workerBalanceBefore(${workerBalanceBefore.toString()})
               - workerEthTxCost(${workerEthTxCost.toString()})`
        ).to.be.equal(workerBalanceBefore.sub(workerEthTxCost));
      });
    });
  });

  describe('_extractDuePendingEvents', function () {
    let relayServer: RelayServer;
    let registrationManager: RegistrationManagerExposed;

    beforeEach(async function () {
      const relayOwner = (await ethers.getSigners()).at(0) as SignerWithAddress;
      const relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
      });
      relayServer = await getInitiatedServer({ relayOwner });
      registrationManager =
        relayServer.registrationManager as unknown as RegistrationManagerExposed;
      registrationManager._delayedEvents = [
        { block: 1, eventData: {} as TypedEvent },
        { block: 2, eventData: {} as TypedEvent },
        { block: 3, eventData: {} as TypedEvent },
      ];
    });

    it('should extract events which are due (lower or equal block number)', function () {
      const extracted = registrationManager._extractDuePendingEvents(2);

      expect(extracted).to.be.deep.equal([{} as TypedEvent, {} as TypedEvent]);
    });

    it('should leave future events in the delayedEvents list', function () {
      registrationManager._extractDuePendingEvents(2);

      expect(registrationManager._delayedEvents).to.be.deep.equal([
        { block: 3, eventData: {} as TypedEvent },
      ]);
    });
  });

  describe('attemptRegistration', function () {
    let relayServer: RelayServer;
    let registrationManager: RegistrationManager;

    beforeEach(async function () {
      const relayOwner = (await ethers.getSigners()).at(0) as SignerWithAddress;
      const relayHub = await deployRelayHub(undefined, {
        maxWorkerCount,
        minimumEntryDepositValue,
        minimumUnstakeDelay,
        minimumStake,
      });
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
      });
      relayServer = await getFundedServer(
        { relayOwner },
        undefined,
        unstakeDelay
      );
      await relayServer.init();
      registrationManager = relayServer.registrationManager;
      registrationManager.balanceRequired.requiredValue = constants.Zero;
      registrationManager.stakeRequired.requiredValue = constants.Zero;
      await registrationManager.refreshStake();
    });

    describe('without re-registration', function () {
      it('should register server and add workers', async function () {
        let pendingTransactions = await relayServer.txStoreManager.getAll();

        expect(pendingTransactions.length).to.be.equal(0);

        const receipts = await registrationManager.attemptRegistration(1);

        await assertEventHub('RelayServerRegistered', receipts);
        await assertEventHub('RelayWorkersAdded', receipts);

        pendingTransactions = await relayServer.txStoreManager.getAll();

        const addWorkerTransaction =
          pendingTransactions[0] as StoredTransaction;
        const registerServerTransaction =
          pendingTransactions[1] as StoredTransaction;

        expect(pendingTransactions.length).to.be.gt(0);
        expect(addWorkerTransaction.serverAction).to.be.equal(
          ServerAction.ADD_WORKER
        );
        expect(registerServerTransaction.serverAction).to.be.equal(
          ServerAction.REGISTER_SERVER
        );
      });
    });
  });

  describe('assertRegistered', function () {
    let relayServer: RelayServer;

    beforeEach(async function () {
      const relayOwner = (await ethers.getSigners()).at(0) as SignerWithAddress;
      const relayHub = await deployRelayHub();
      loadConfiguration({
        app: basicAppConfig,
        contracts: {
          relayHubAddress: relayHub.address,
        },
      });
      relayServer = await getInitiatedServer({ relayOwner });
    });

    it('should return false if the stake requirement is not satisfied', function () {
      const registrationManager = relayServer.registrationManager;
      registrationManager.stakeRequired.requiredValue = BigNumber.from(
        (1e20).toString()
      );

      const isRegistered = registrationManager.isRegistered();

      expect(isRegistered).to.be.false;
    });
  });
});

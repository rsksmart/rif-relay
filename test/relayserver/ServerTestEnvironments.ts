import {
  KeyManager,
  RelayServer,
  ServerDependencies,
  TxStoreManager,
} from '@rsksmart/rif-relay-server';
import {
  EnvelopingRequest,
  EnvelopingTxRequest,
  HubInfo,
  RelayClient,
  UserDefinedEnvelopingRequest,
} from '@rsksmart/rif-relay-client';
import { utils, Wallet } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import {
  assertEventHub,
  getTemporaryWorkdirs,
  ServerWorkdirs,
} from './ServerTestUtils';
import {
  RelayHubInterface,
  RelayHub__factory,
} from '@rsksmart/rif-relay-contracts';
import { ethers } from 'hardhat';
import { expect } from 'chai';

import { LogDescription } from 'ethers/lib/utils';

const provider = ethers.provider;
const dayInSec = 24 * 60 * 60;
const weekInSec = dayInSec * 7;

type ServerInitParams = {
  relayOwner: Wallet;
  serverWorkdirs?: ServerWorkdirs;
};

const initServer = async (
  initParams: ServerInitParams,
  getServer = getFundedServer
) => {
  const { relayOwner } = initParams;
  const relayServer = await getServer(initParams);
  await relayServer.init();
  const latestBlock = await provider.getBlock('latest');
  const receipts = await relayServer._worker(latestBlock.number);
  await assertEventHub('RelayServerRegistered', receipts, relayOwner.address); // sanity check
  await assertEventHub('RelayWorkersAdded', receipts, relayOwner.address); // sanity check
  await relayServer._worker(latestBlock.number + 1);

  return relayServer;
};

const getFundedServer = async (
  initParams: ServerInitParams,
  getServer = getServerInstance,
  unstakeDelay = weekInSec
) => {
  const relayServer = getServer(initParams);

  const { relayOwner } = initParams;

  const { relayHubAddress, relayManagerAddress } = relayServer.getChainInfo();

  await relayOwner.sendTransaction({
    value: utils.parseEther('2'),
  });

  const relayHub = RelayHub__factory.connect(relayHubAddress, provider);

  await relayHub
    .connect(relayOwner)
    .stakeForAddress(relayManagerAddress, unstakeDelay, {
      value: utils.parseEther('1'),
    });

  return relayServer;
};

const getServerInstance = ({ serverWorkdirs }: ServerInitParams) => {
  const { workdir } = getTemporaryWorkdirs();

  const managerKeyManager = createKeyManager(serverWorkdirs?.managerWorkdir);
  const workersKeyManager = createKeyManager(serverWorkdirs?.workersWorkdir);
  const txStoreManager = new TxStoreManager({
    workdir: serverWorkdirs?.workdir ?? workdir,
  });

  const dependencies: ServerDependencies = {
    txStoreManager,
    managerKeyManager,
    workersKeyManager,
  };

  return new RelayServer(dependencies);
};

const createKeyManager = (workdir?: string): KeyManager => {
  if (workdir != null) {
    return new KeyManager(1, workdir);
  } else {
    return new KeyManager(1, undefined, utils.randomBytes(32).toString());
  }
};

const createRelayHttpRequest = async (
  envelopingRequest: UserDefinedEnvelopingRequest,
  relayClient: RelayClient,
  hubInfo: HubInfo
): Promise<EnvelopingTxRequest> => {
  type RelayClientExposed = {
    _prepareHttpRequest: (
      hubInfo: HubInfo,
      envelopingRequest: EnvelopingRequest
    ) => Promise<EnvelopingTxRequest>;
    _getEnvelopingRequestDetails: (
      envelopingRequest: UserDefinedEnvelopingRequest
    ) => Promise<EnvelopingRequest>;
  };

  const localClient = relayClient as unknown as RelayClientExposed;

  const envelopingRequestDetails =
    await localClient._getEnvelopingRequestDetails(envelopingRequest);

  return await localClient._prepareHttpRequest(
    hubInfo,
    envelopingRequestDetails
  );
};

const relayTransaction = async (
  envelopingRequest: UserDefinedEnvelopingRequest,
  relayServer: RelayServer,
  relayClient: RelayClient,
  assertRelayed = true
) => {
  const hubInfo = relayServer.getChainInfo();
  const envelopingTx = await createRelayHttpRequest(
    envelopingRequest,
    relayClient,
    hubInfo
  );
  const relayTransaction = await relayServer.createRelayTransaction(
    envelopingTx
  );

  if (assertRelayed) {
    await assertTransactionRelayed(
      hubInfo,
      relayTransaction.txHash,
      utils.keccak256(envelopingTx.metadata.signature)
    );
  }

  return relayTransaction;
};

const assertTransactionRelayed = async (
  hubInfo: HubInfo,
  txHash: string,
  hashSignature: string
) => {
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new Error('Transaction Receipt not found');
  }

  const relayHubInterface: RelayHubInterface =
    RelayHub__factory.createInterface();

  const decodedLogs = receipt.logs.map((log: Log) =>
    relayHubInterface.parseLog(log)
  );
  const event = decodedLogs.find(
    (e: LogDescription) => e.name === 'TransactionRelayed'
  );

  if (!event) {
    throw new Error(
      'TransactionRelayed not found, maybe transaction was not relayed successfully'
    );
  }

  const { relayManagerAddress, relayWorkerAddress } = hubInfo;

  expect(event.args['relayManager']).to.be.equal(relayManagerAddress);

  expect(event.args['relayWorker']).to.be.equal(relayWorkerAddress);

  expect(event.args['relayRequestSigHash']).to.be.equal(hashSignature);
};

export {
  initServer,
  getFundedServer,
  getServerInstance,
  createRelayHttpRequest,
  relayTransaction,
  assertTransactionRelayed,
};

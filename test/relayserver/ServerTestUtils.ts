import { TransactionReceipt } from '@ethersproject/providers';
import {
  RelayHubInterface,
  RelayHub__factory,
} from '@rsksmart/rif-relay-contracts';
import {
  AppConfig,
  BlockchainConfig,
  ContractsConfig,
  ManagerEvent,
} from '@rsksmart/rif-relay-server';
import { BigNumberish, constants } from 'ethers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import config from 'config';
import { EnvelopingTxRequest } from '@rsksmart/rif-relay-client';

type ServerWorkdirs = {
  workdir: string;
  managerWorkdir: string;
  workersWorkdir: string;
};

type ServerLoadConfiguration = Partial<{
  app: Partial<AppConfig>;
  contracts: Partial<ContractsConfig>;
  blockchain: Partial<BlockchainConfig>;
}>;

const provider = ethers.provider;

const resolveAllReceipts = async (
  transactionHashes: string[]
): Promise<TransactionReceipt[]> => {
  return await Promise.all(
    transactionHashes.map((transactionHash) =>
      provider.getTransactionReceipt(transactionHash)
    )
  );
};

const assertEventHub = async (
  event: ManagerEvent,
  transactionHashes: string[],
  indexedAddress?: string
) => {
  const relayHubInterface: RelayHubInterface =
    RelayHub__factory.createInterface();
  const receipts = await resolveAllReceipts(transactionHashes);

  const parsedLogs = receipts.flatMap((receipt) => {
    return receipt.logs.map((log) => relayHubInterface.parseLog(log));
  });

  const registeredReceipt = parsedLogs.find((log) => log.name === event);

  if (!registeredReceipt) {
    throw new Error('Registered receipt not found');
  }

  expect(registeredReceipt.name).to.be.equal(event);

  if (indexedAddress) {
    expect(registeredReceipt.args[0]).to.be.equal(indexedAddress);
  }
};

const getTotalTxCosts = async (
  transactionHashes: string[],
  gasPrice: BigNumberish
) => {
  const receipts = await resolveAllReceipts(transactionHashes);

  return receipts
    .map((receipt) => receipt.gasUsed.mul(gasPrice))
    .reduce((previous, current) => previous.add(current), constants.Zero);
};

const getTemporaryWorkdirs = (): ServerWorkdirs => {
  const workdir =
    '/tmp/enveloping/test/relayserver/defunct' + Date.now().toString();
  const managerWorkdir = workdir + '/manager';
  const workersWorkdir = workdir + '/workers';

  return {
    workdir,
    managerWorkdir,
    workersWorkdir,
  };
};

const stringifyEnvelopingTx = (
  envelopingTx: EnvelopingTxRequest
): EnvelopingTxRequest => {
  const {
    relayRequest: {
      request: { tokenGas, nonce, value, tokenAmount, gas },
      relayData: { gasPrice },
    },
  } = envelopingTx;

  return {
    ...envelopingTx,
    relayRequest: {
      ...envelopingTx.relayRequest,
      request: {
        ...envelopingTx.relayRequest.request,
        tokenGas: tokenGas.toString(),
        nonce: nonce.toString(),
        value: value.toString(),
        tokenAmount: tokenAmount.toString(),
        gas: gas?.toString(),
      },
      relayData: {
        ...envelopingTx.relayRequest.relayData,
        gasPrice: gasPrice.toString(),
      },
    },
  } as EnvelopingTxRequest;
};

const loadConfiguration = ({
  app = {},
  contracts = {},
  blockchain = {},
}: ServerLoadConfiguration) => {
  config.util.extendDeep(config, {
    app,
    contracts,
    blockchain,
  });
};

const deployTestRecipient = async () => {
  const testRecipientFactory = await ethers.getContractFactory('TestRecipient');

  return await testRecipientFactory.deploy();
};

export {
  resolveAllReceipts,
  assertEventHub,
  getTotalTxCosts,
  getTemporaryWorkdirs,
  stringifyEnvelopingTx,
  loadConfiguration,
  deployTestRecipient,
};

export type { ServerWorkdirs, ServerLoadConfiguration };

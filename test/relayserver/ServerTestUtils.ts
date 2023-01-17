import { TransactionReceipt } from '@ethersproject/providers';
import {
  RelayHubInterface,
  RelayHub__factory,
} from '@rsksmart/rif-relay-contracts';
import { ManagerEvent } from '@rsksmart/rif-relay-server';
import { BigNumberish, constants } from 'ethers';
import { expect } from 'chai';
import { ethers as hardhat } from 'hardhat';

export type ServerWorkdirs = {
  workdir: string;
  managerWorkdir: string;
  workersWorkdir: string;
};

const provider = hardhat.provider;

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
  indexedAddress: string
) => {
  const relayHubInterface: RelayHubInterface =
    RelayHub__factory.createInterface();
  const receipts = await resolveAllReceipts(transactionHashes);

  const registeredLogs = receipts.flatMap((receipt) => {
    return receipt.logs.map((log) => relayHubInterface.parseLog(log));
  });

  expect(registeredLogs.length).to.be.equal(1);

  const parsedLog = registeredLogs.at(0);

  if (!parsedLog) {
    throw new Error('Registered receipt not found');
  }

  expect(parsedLog.args[indexedAddress]).to.be.equal(event);
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

export {
  resolveAllReceipts,
  assertEventHub,
  getTotalTxCosts,
  getTemporaryWorkdirs,
};

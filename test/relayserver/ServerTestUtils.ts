// @ts-ignore
import abiDecoder from 'abi-decoder'
import { TransactionReceipt } from 'web3-core'
import { toBN } from 'web3-utils'

import RelayVerifierABI from '../../src/common/interfaces/IRelayVerifier.json'
import DeployVerifierABI from '../../src/common/interfaces/IDeployVerifier.json'

import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { PrefixedHexString } from 'ethereumjs-tx'
import { sleep } from '../../src/common/Utils'

const TestRecipient = artifacts.require('TestRecipient')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('TestDeployVerifierEverythingAccepted')

const WAIT_FOR_RECEIPT_RETRIES = 5
const WAIT_UNTIL_RECEIPT_MS = 1000

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(RelayVerifierABI)
abiDecoder.addABI(DeployVerifierABI)

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestVerifierEverythingAccepted.abi)
// @ts-ignore
abiDecoder.addABI(TestDeployVerifierEverythingAccepted.abi)

async function waitForReceipt (transactionHash: PrefixedHexString): Promise<TransactionReceipt> {
  for (let tryCount = 0; tryCount < WAIT_FOR_RECEIPT_RETRIES; tryCount++) {
    const receipt = await web3.eth.getTransactionReceipt(transactionHash)
    if (receipt) {
      return receipt
    }
    await sleep(WAIT_UNTIL_RECEIPT_MS)
  }
  throw new Error(`No receipt found for this transaction ${transactionHash}`)
}

async function resolveAllReceipts (transactionHashes: PrefixedHexString[]): Promise<TransactionReceipt[]> {
  return await Promise.all(transactionHashes.map((transactionHash) => waitForReceipt(transactionHash)))
}

export async function assertRelayAdded (transactionHashes: PrefixedHexString[], server: RelayServer, checkWorkers = true): Promise<void> {
  const receipts = await resolveAllReceipts(transactionHashes)
  const registeredReceipt = receipts.find(r => {
    const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
    return decodedLogs[0].name === 'RelayServerRegistered'
  })
  if (registeredReceipt == null) {
    throw new Error('Registered Receipt not found')
  }
  const registeredLogs = abiDecoder.decodeLogs(registeredReceipt.logs).map(server.registrationManager._parseEvent)
  assert.equal(registeredLogs.length, 1)
  assert.equal(registeredLogs[0].name, 'RelayServerRegistered')
  assert.equal(registeredLogs[0].args.relayManager.toLowerCase(), server.managerAddress.toLowerCase())
  assert.equal(registeredLogs[0].args.relayUrl, server.config.url)

  if (checkWorkers) {
    const workersAddedReceipt = receipts.find(r => {
      const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
      return decodedLogs[0].name === 'RelayWorkersAdded'
    })
    const workersAddedLogs = abiDecoder.decodeLogs(workersAddedReceipt!.logs).map(server.registrationManager._parseEvent)
    assert.equal(workersAddedLogs.length, 1)
    assert.equal(workersAddedLogs[0].name, 'RelayWorkersAdded')
  }
}

export async function getTotalTxCosts (transactionHashes: PrefixedHexString[], gasPrice: string): Promise<BN> {
  const receipts = await resolveAllReceipts(transactionHashes)
  return receipts.map(r => toBN(r.gasUsed).mul(toBN(gasPrice))).reduce(
    (previous, current) => previous.add(current), toBN(0))
}

export interface ServerWorkdirs {
  workdir: string
  managerWorkdir: string
  workersWorkdir: string
}

export function getTemporaryWorkdirs (): ServerWorkdirs {
  const workdir = '/tmp/enveloping/test/relayserver/defunct' + Date.now().toString()
  const managerWorkdir = workdir + '/manager'
  const workersWorkdir = workdir + '/workers'

  return {
    workdir,
    managerWorkdir,
    workersWorkdir
  }
}

import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  ESTIMATED_GAS_CORRECTION_FACTOR,
  EnvelopingRequestData,
  INTERNAL_TRANSACTION_ESTIMATED_CORRECTION,
  RelayRequest,
  RelayRequestBody,
  DeployRequest,
} from '@rsksmart/rif-relay-client';
import { UtilToken } from '@rsksmart/rif-relay-contracts';
import { BigNumber, ContractReceipt, Wallet, constants } from 'ethers';
import {
  createSmartWalletFactory,
  createSupportedSmartWallet,
  deployRelayHub,
  getSuffixDataAndSignature,
  SupportedSmartWallet,
  deployContract,
} from '../test/utils/TestUtils';
import { TestRecipient, TestVerifierEverythingAccepted } from 'typechain-types';
import {
  SmartWalletFactory,
  Penalizer,
  RelayHub,
  SmartWallet,
} from '@rsksmart/rif-relay-contracts';
import { expect } from 'chai';

const GAS_PRICE = '60000000';
const GAS_LIMIT = 4e6;
const UNDERLINE = '\x1b[4m';
const RESET = '\x1b[0m';
const TOKEN_AMOUNT_TO_TRANSFER = ethers.utils.parseUnits('100').toString();
const RELAY_URL = 'http://relay.com';

let relayWorker: SignerWithAddress;
let relayManager: SignerWithAddress;
let relayOwner: SignerWithAddress;
let fundedAccount: SignerWithAddress;
let relayHubSigner: SignerWithAddress;

function combineTwoRelayRequests(
  baseRelayRequest: RelayRequest,
  overrideRelayRequest: {
    request?: Partial<RelayRequestBody>;
    relayData?: Partial<EnvelopingRequestData>;
  }
) {
  return {
    request: { ...baseRelayRequest.request, ...overrideRelayRequest.request },
    relayData: {
      ...baseRelayRequest.relayData,
      ...overrideRelayRequest.relayData,
    },
  };
}

function logTitle(title: string) {
  console.log(`${UNDERLINE}\n${title.toUpperCase()}${RESET}`);
}

async function setupRelayHub(relayHub: RelayHub) {
  await relayHub
    .connect(relayOwner)
    .stakeForAddress(relayManager.address, 1000, {
      value: ethers.utils.parseEther('2'),
    });

  await relayHub.connect(relayManager).addRelayWorkers([relayWorker.address]);
  await relayHub.connect(relayManager).registerRelayServer(RELAY_URL);
}

async function deployAndSetup() {
  const owner = Wallet.createRandom().connect(ethers.provider);
  const penalizer = await deployContract<Penalizer>('Penalizer');
  const verifier = await deployContract<TestVerifierEverythingAccepted>(
    'TestVerifierEverythingAccepted'
  );
  const token = await deployContract<UtilToken>('UtilToken');
  const smartWalletTemplate = await deployContract<SmartWallet>('SmartWallet');
  const relayHub = await deployRelayHub(penalizer.address);
  await setupRelayHub(relayHub);

  await fundedAccount.sendTransaction({
    to: owner.address,
    value: ethers.utils.parseEther('1'),
  });

  const smartWalletFactory = (await createSmartWalletFactory(
    smartWalletTemplate,
    false,
    owner
  )) as SmartWalletFactory;

  return {
    relayHub,
    owner,
    smartWalletFactory,
    token,
    verifier,
  };
}

async function getTransferEstimationWithoutRelay(token: UtilToken) {
  const [senderAccount, receiverAccount] = (await ethers.getSigners()) as [
    SignerWithAddress,
    SignerWithAddress
  ];

  await token.mint(TOKEN_AMOUNT_TO_TRANSFER + '00', senderAccount.address);

  const noRelayCall = await token.transfer(
    receiverAccount.address,
    TOKEN_AMOUNT_TO_TRANSFER,
    { from: senderAccount.address }
  );

  return await noRelayCall.wait();
}

function printRelayGasAnalysis(
  txReceiptWithRelay: ContractReceipt,
  txReceiptWithoutRelay: ContractReceipt
) {
  const gasOverhead = txReceiptWithRelay.gasUsed.sub(
    txReceiptWithoutRelay.gasUsed
  );

  console.log(
    `\tToken transfer WITHOUT RIFRelay. Gas used: ${txReceiptWithoutRelay.gasUsed.toString()}`
  );
  console.log(
    `\tToken transfer WITH RIFRelay. Gas used:\t ${txReceiptWithRelay.gasUsed.toString()}`
  );
  console.log(`\t\t\tGas overhead:\t\t ${gasOverhead.toString()}`);
}

async function assertRelayedTransaction(
  forwarderInitialBalance: BigNumber,
  relayWorkerInitialBalance: BigNumber,
  balanceToTransfer: BigNumber,
  token: UtilToken,
  forwarder: SupportedSmartWallet,
  fees?: BigNumber
) {
  const forwarderFinalBalance = await token.balanceOf(forwarder.address);
  const relayWorkerFinalBalance = await token.balanceOf(relayWorker.address);

  expect(
    forwarderInitialBalance.eq(
      forwarderFinalBalance
        .add(balanceToTransfer)
        .add(BigNumber.from(fees ?? 0))
    )
  ).to.equal(true, 'SW Payment did not occur');
  expect(
    relayWorkerFinalBalance.eq(
      relayWorkerInitialBalance.add(fees ?? balanceToTransfer)
    )
  ).to.equal(true, 'Worker did not receive payment');
}

function correctEstimatedCallCost(estimation: BigNumber) {
  const internalCorrection = BigNumber.from(
    INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
  );
  const gasCorrectionFactor = BigNumber.from(ESTIMATED_GAS_CORRECTION_FACTOR);

  return gasCorrectionFactor.mul(
    estimation.gt(internalCorrection)
      ? estimation.sub(internalCorrection)
      : estimation
  );
}

async function getEstimatedGasWithCorrection(
  senderAddress: string,
  receiverAddress: string,
  data: string
) {
  const estimatedDestinationCallGas = await ethers.provider.estimateGas({
    from: senderAddress,
    to: receiverAddress,
    gasPrice: GAS_PRICE,
    data,
  });

  return correctEstimatedCallCost(estimatedDestinationCallGas);
}

async function completeRelayRequest(
  transferReceiver: string,
  balanceToTransfer: string,
  fees: string,
  token: UtilToken,
  relayRequest: RelayRequest,
  forwarder: SmartWallet
) {
  const isSponsored = fees === '0';
  const tokenContract = isSponsored
    ? ethers.constants.AddressZero
    : token.address;

  const encodedFunction = token.interface.encodeFunctionData('transfer', [
    transferReceiver,
    balanceToTransfer,
  ]);

  const estimatedDestinationCallGasCorrected =
    await getEstimatedGasWithCorrection(
      forwarder.address,
      token.address,
      encodedFunction
    );

  let tokenGas = '0';

  if (!isSponsored) {
    const dataForTransfer = token.interface.encodeFunctionData('transfer', [
      relayWorker.address,
      fees,
    ]);

    tokenGas = (
      await getEstimatedGasWithCorrection(
        forwarder.address,
        token.address,
        dataForTransfer
      )
    ).toString();
  }

  return combineTwoRelayRequests(relayRequest, {
    request: {
      data: encodedFunction,
      to: token.address,
      nonce: (await forwarder.nonce()).toString(),
      tokenAmount: fees,
      tokenContract,
      gas: estimatedDestinationCallGasCorrected.toString(),
      tokenGas,
    },
  });
}

async function estimateRelayCost(fees = '0') {
  const recipient = await deployContract<TestRecipient>('TestRecipient');
  const { relayHub, smartWalletFactory, owner, token, verifier } =
    await deployAndSetup();

  const smartWallet = (await createSupportedSmartWallet({
    relayHub: relayHubSigner.address,
    factory: smartWalletFactory,
    owner,
    sender: relayHubSigner,
  })) as SmartWallet;

  const baseRelayRequest = {
    request: {
      relayHub: relayHub.address,
      to: recipient.address,
      data: '0xdeadbeef',
      from: owner.address,
      nonce: (await smartWallet.nonce()).toString(),
      value: '0',
      gas: '0',
      tokenContract: token.address,
      tokenAmount: '0',
      tokenGas: '0',
      validUntilTime: '0',
    },
    relayData: {
      gasPrice: GAS_PRICE,
      feesReceiver: relayWorker.address,
      callForwarder: smartWallet.address,
      callVerifier: verifier.address,
    },
  };

  await token.mint(TOKEN_AMOUNT_TO_TRANSFER + '00', smartWallet.address);

  const smartWalletInitialBalance = await token.balanceOf(smartWallet.address);
  const relayWorkerInitialBalance = await token.balanceOf(relayWorker.address);

  const transferReceiver = ethers.Wallet.createRandom();

  const completeReq: RelayRequest = await completeRelayRequest(
    transferReceiver.address,
    TOKEN_AMOUNT_TO_TRANSFER,
    fees,
    token,
    baseRelayRequest,
    smartWallet
  );

  const { signature } = await getSuffixDataAndSignature(
    smartWallet,
    completeReq,
    owner
  );

  const relayCallResult = await relayHub
    .connect(relayWorker)
    .relayCall(completeReq, signature, {
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
    });
  const txReceiptWithRelay = await relayCallResult.wait();

  await assertRelayedTransaction(
    smartWalletInitialBalance,
    relayWorkerInitialBalance,
    BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER),
    token,
    smartWallet,
    BigNumber.from(fees)
  );

  const txReceiptWithoutRelay = await getTransferEstimationWithoutRelay(token);

  printRelayGasAnalysis(txReceiptWithRelay, txReceiptWithoutRelay);
}

async function estimateDeployCost(tokenAmount = '0') {
  const SMART_WALLET_INDEX = '1';
  const { relayHub, owner, smartWalletFactory, token, verifier } =
    await deployAndSetup();

  let tokenGas = '0';

  if (tokenAmount !== '0') {
    const swAddress = await smartWalletFactory.getSmartWalletAddress(
      owner.address,
      constants.AddressZero,
      SMART_WALLET_INDEX
    );
    await token.mint(tokenAmount, swAddress);

    const dataForTransfer = token.interface.encodeFunctionData('transfer', [
      relayWorker.address,
      tokenAmount,
    ]);

    tokenGas = (
      await getEstimatedGasWithCorrection(
        swAddress,
        token.address,
        dataForTransfer
      )
    ).toString();
  }

  const deployRequest = {
    request: {
      data: '0x00',
      from: owner.address,
      nonce: '0',
      relayHub: relayHub.address,
      to: constants.AddressZero,
      tokenAmount,
      tokenContract: constants.AddressZero,
      tokenGas,
      value: '0',
      validUntilTime: 0,
      index: SMART_WALLET_INDEX,
      recoverer: constants.AddressZero,
    },
    relayData: {
      callForwarder: smartWalletFactory.address,
      callVerifier: verifier.address,
      feesReceiver: relayWorker.address,
      gasPrice: GAS_PRICE,
    },
  } as DeployRequest;

  const { signature } = await getSuffixDataAndSignature(
    smartWalletFactory,
    deployRequest,
    owner
  );

  const txResponse = await relayHub
    .connect(relayWorker)
    .deployCall(deployRequest, signature, { gasPrice: GAS_PRICE });

  const { gasUsed } = await txResponse.wait();

  console.log('\tTotal gas used on deploy: ', gasUsed.toString());
}

async function estimateGas() {
  const RELAY_FEES = '100000';

  [relayWorker, relayManager, relayOwner, fundedAccount, relayHubSigner] =
    (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress
    ];

  logTitle('Relay estimation without token payment (sponsored)');
  await estimateRelayCost();

  logTitle('Relay estimation with token payment (not sponsored)');
  await estimateRelayCost(RELAY_FEES);

  logTitle('Deploy estimation without token payment (sponsored)');
  await estimateDeployCost();

  logTitle('Deploy estimation with token payment (not sponsored)');
  await estimateDeployCost(TOKEN_AMOUNT_TO_TRANSFER);
}

estimateGas().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
  deployContract,
} from '../test/utils/TestUtils';
import { TestSwap, TestVerifierEverythingAccepted } from 'typechain-types';
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
  const swap = await deployContract<TestSwap>('TestSwap');
  const penalizer = await deployContract<Penalizer>('Penalizer');
  const verifier = await deployContract<TestVerifierEverythingAccepted>(
    'TestVerifierEverythingAccepted'
  );

  const token = await deployContract<UtilToken>('UtilToken');
  const smartWalletTemplate = await deployContract<SmartWallet>('SmartWallet');
  const relayHub = await deployRelayHub(penalizer.address);
  await setupRelayHub(relayHub);

  const oneEther = ethers.utils.parseEther('1');

  await fundedAccount.sendTransaction({
    to: swap.address,
    value: oneEther,
  });

  await fundedAccount.sendTransaction({
    to: owner.address,
    value: oneEther,
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
    swap,
  };
}

async function executeTransferEstimationWithoutRelay(token: UtilToken) {
  const [senderAccount, receiverAccount] = (await ethers.getSigners()) as [
    SignerWithAddress,
    SignerWithAddress
  ];

  // the amount to mint should be bigger than the amount to transfer to avoid gas refund
  const amountToMint = BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER).add(1);
  await token.mint(amountToMint, senderAccount.address);

  const noRelayCall = await token.transfer(
    receiverAccount.address,
    TOKEN_AMOUNT_TO_TRANSFER,
    { from: senderAccount.address }
  );

  return await noRelayCall.wait();
}

async function executeSwapEstimationWithoutRelay(swap: TestSwap) {
  const [senderAccount] = (await ethers.getSigners()) as [
    SignerWithAddress,
    SignerWithAddress
  ];

  const noRelayCall = await swap.claim(
    constants.HashZero,
    ethers.utils.parseEther('0.5'),
    constants.AddressZero,
    500,
    {
      from: senderAccount.address,
    }
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
    `\tExecution WITHOUT RIFRelay. Gas used: ${txReceiptWithoutRelay.gasUsed.toString()}`
  );
  console.log(
    `\tExecution WITH RIFRelay. Gas used:\t ${txReceiptWithRelay.gasUsed.toString()}`
  );
  console.log(`\t\t\tGas overhead:\t\t ${gasOverhead.toString()}`);
}

function assertRelayedTransaction(
  forwarderInitialBalance: BigNumber,
  relayWorkerInitialBalance: BigNumber,
  forwarderFinalBalance: BigNumber,
  relayWorkerFinalBalance: BigNumber,
  balanceToTransfer: BigNumber,
  fees?: BigNumber
) {
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

  const tokenGas = await getTokenGas(token, fees, forwarder.address);

  return combineTwoRelayRequests(relayRequest, {
    request: {
      data: encodedFunction,
      to: token.address,
      nonce: (await forwarder.nonce()).toString(),
      tokenAmount: fees,
      tokenContract,
      gas: estimatedDestinationCallGasCorrected.toString(),
      tokenGas: tokenGas.toString(),
    },
  });
}

async function estimateRelayCost(fees = '0') {
  const { relayHub, smartWalletFactory, owner, token, verifier } =
    await deployAndSetup();

  const smartWallet = (await createSupportedSmartWallet({
    relayHub: relayHubSigner.address,
    factory: smartWalletFactory,
    owner,
    sender: relayHubSigner,
  })) as SmartWallet;

  const baseRelayRequest: RelayRequest = {
    request: {
      relayHub: relayHub.address,
      to: constants.AddressZero,
      data: '0x',
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

  const smartWalletFinalBalance = await token.balanceOf(smartWallet.address);
  const relayWorkerFinalBalance = await token.balanceOf(relayWorker.address);

  assertRelayedTransaction(
    smartWalletInitialBalance,
    relayWorkerInitialBalance,
    smartWalletFinalBalance,
    relayWorkerFinalBalance,
    BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER),
    BigNumber.from(fees)
  );

  const txReceiptWithoutRelay = await executeTransferEstimationWithoutRelay(
    token
  );

  printRelayGasAnalysis(txReceiptWithRelay, txReceiptWithoutRelay);
}

async function prepareDeployRequest(fees = '0', native: boolean) {
  const SMART_WALLET_INDEX = '1';

  const { relayHub, owner, smartWalletFactory, token, verifier, swap } =
    await deployAndSetup();

  const swAddress = await smartWalletFactory.getSmartWalletAddress(
    owner.address,
    constants.AddressZero,
    SMART_WALLET_INDEX
  );

  await token.mint(fees, swAddress);

  const tokenGas = await getTokenGas(token, fees, swAddress, native);

  const deployRequest: DeployRequest = {
    request: {
      data: '0x00',
      from: owner.address,
      nonce: '0',
      relayHub: relayHub.address,
      to: constants.AddressZero,
      tokenAmount: fees,
      tokenContract: native ? constants.AddressZero : token.address,
      tokenGas: tokenGas.toString(),
      value: '0',
      gas: '0',
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
  };

  return {
    deployRequest,
    smartWalletFactory,
    owner,
    relayHub,
    swap,
    swAddress,
  };
}

async function estimateDeployCost(fees = '0', native = false) {
  const { deployRequest, smartWalletFactory, owner, relayHub } =
    await prepareDeployRequest(fees, native);

  const { signature } = await getSuffixDataAndSignature(
    smartWalletFactory,
    deployRequest,
    owner
  );

  const txResponse = await relayHub
    .connect(relayWorker)
    .deployCall(deployRequest, signature, { gasPrice: GAS_PRICE });

  const txReceipt = await txResponse.wait();

  console.log('\tTotal gas used on deploy: ', txReceipt.gasUsed.toString());
}

async function estimateDeployCostWithExecution(fees = '0', native = false) {
  const {
    deployRequest,
    smartWalletFactory,
    owner,
    relayHub,
    swap,
    swAddress,
  } = await prepareDeployRequest(fees, native);

  const { to, data, gas } = await getExecutionParameters(swap, swAddress);

  const updatedDeployRequest = {
    request: {
      ...deployRequest.request,
      to,
      data,
      gas: gas.toString(),
    },
    relayData: {
      ...deployRequest.relayData,
    },
  };

  const { signature } = await getSuffixDataAndSignature(
    smartWalletFactory,
    updatedDeployRequest,
    owner
  );

  const txResponse = await relayHub
    .connect(relayWorker)
    .deployCall(updatedDeployRequest, signature, { gasPrice: GAS_PRICE });

  const txReceipt = await txResponse.wait();

  const txReceiptWithoutRelay = await executeSwapEstimationWithoutRelay(swap);

  printRelayGasAnalysis(txReceipt, txReceiptWithoutRelay);
}

async function getExecutionParameters(swap: TestSwap, swAddress: string) {
  const encodedFunction = swap.interface.encodeFunctionData('claim', [
    constants.HashZero,
    ethers.utils.parseEther('0.5'),
    constants.AddressZero,
    500,
  ]);

  const estimatedDestinationCallGasCorrected =
    await getEstimatedGasWithCorrection(
      swAddress,
      swap.address,
      encodedFunction
    );

  return {
    to: swap.address,
    data: encodedFunction,
    gas: estimatedDestinationCallGasCorrected,
  };
}

async function getTokenGas(
  token: UtilToken,
  fees: string,
  address: string,
  native = false
) {
  if (fees === '0') {
    return constants.Zero;
  }

  if (native) {
    return await getEstimatedGasWithCorrection(
      address,
      relayWorker.address,
      ''
    );
  }

  const dataForTransfer = token.interface.encodeFunctionData('transfer', [
    relayWorker.address,
    fees,
  ]);

  return await getEstimatedGasWithCorrection(
    address,
    token.address,
    dataForTransfer
  );
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

  logTitle('Deploy estimation without payment (sponsored)');
  await estimateDeployCost();

  logTitle('Deploy estimation with token payment (not sponsored)');
  await estimateDeployCost(TOKEN_AMOUNT_TO_TRANSFER);

  logTitle(
    'Deploy estimation without payment (sponsored) and contract execution'
  );
  await estimateDeployCostWithExecution('0', true);

  logTitle(
    'Deploy estimation with token payment (not sponsored) and contract execution'
  );
  await estimateDeployCostWithExecution(TOKEN_AMOUNT_TO_TRANSFER);

  logTitle('Deploy estimation with native payment (not sponsored)');
  await estimateDeployCost('0', false);

  logTitle(
    'Deploy estimation with native payment (not sponsored) and contract execution'
  );
  await estimateDeployCostWithExecution('0', true);
}

estimateGas().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

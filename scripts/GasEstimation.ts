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
import {
  BoltzSmartWalletFactory,
  UtilToken,
} from '@rsksmart/rif-relay-contracts';
import {
  BigNumber,
  BigNumberish,
  BytesLike,
  ContractReceipt,
  Wallet,
  constants,
} from 'ethers';
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
const CLAIMED_AMOUNT = ethers.utils.parseEther('0.5');
const NO_FEES = '0';

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
  const boltzSmartWalletTemplate = await deployContract<SmartWallet>(
    'BoltzSmartWallet'
  );
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
    'Default',
    owner
  )) as SmartWalletFactory;

  const boltzSmartWalletFactory = (await createSmartWalletFactory(
    boltzSmartWalletTemplate,
    'Boltz',
    owner
  )) as BoltzSmartWalletFactory;

  return {
    relayHub,
    owner,
    smartWalletFactory,
    token,
    verifier,
    swap,
    boltzSmartWalletTemplate,
    boltzSmartWalletFactory,
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

  const transferTx = await token.transfer(
    receiverAccount.address,
    TOKEN_AMOUNT_TO_TRANSFER,
    { from: senderAccount.address }
  );

  return await transferTx.wait();
}

async function executeSwapWithoutRelay(swap: TestSwap) {
  const [senderAccount] = (await ethers.getSigners()) as [
    SignerWithAddress,
    SignerWithAddress
  ];

  const claimTx = await swap.claim(
    constants.HashZero,
    ethers.utils.parseEther('0.5'),
    constants.AddressZero,
    500,
    {
      from: senderAccount.address,
    }
  );

  return await claimTx.wait();
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

function assertRelayWorkerReceivedPayment(
  relayWorkerInitialBalanceRBTC: BigNumber,
  relayWorkerFinalBalanceRBTC: BigNumber,
  feesBigNumber: BigNumber,
  gasUsed: BigNumber
) {
  // worker final balance = initial balance + fees - (gas used * gas price)
  expect(
    relayWorkerFinalBalanceRBTC.eq(
      relayWorkerInitialBalanceRBTC
        .add(feesBigNumber ?? NO_FEES)
        .sub(gasUsed.mul(GAS_PRICE))
    )
  ).to.equal(true, 'Worker did not receive payment');
}

function assertSWOwnerReceivedClaimedRBTC(
  ownerInitialBalanceRBTC: BigNumber,
  ownerFinalBalanceRBTC: BigNumber,
  feesBigNumber: BigNumber
) {
  // owner final balance = initial balance + claimed amount - fees
  expect(
    ownerFinalBalanceRBTC.eq(
      ownerInitialBalanceRBTC.add(CLAIMED_AMOUNT).sub(feesBigNumber)
    )
  ).to.equal(true, 'Owner did not receive claimed amount');
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

async function getDestinationContractCallParams(
  transferReceiver: string,
  balanceToTransfer: string,
  token: UtilToken,
  forwarder: SmartWallet,
  native: boolean,
  swap: TestSwap
): Promise<DestinationContractCallParams> {
  if (native) {
    return getExecutionParameters(swap, forwarder.address);
  }
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

  return {
    data: encodedFunction,
    to: token.address,
    gas: estimatedDestinationCallGasCorrected.toString(),
  };
}

interface DestinationContractCallParams {
  to: string;
  gas: BigNumberish;
  data: BytesLike;
}

async function estimateRelayCost(fees = NO_FEES, native = false) {
  const {
    relayHub,
    smartWalletFactory,
    owner,
    token,
    verifier,
    swap,
    boltzSmartWalletFactory,
  } = await deployAndSetup();

  const smartWallet = (await createSupportedSmartWallet({
    relayHub: relayHubSigner.address,
    factory: native ? boltzSmartWalletFactory : smartWalletFactory,
    owner,
    sender: relayHubSigner,
    type: native ? 'Boltz' : 'Default',
  })) as SmartWallet;

  // FIXME: apparently we need a high value for this
  // const tokenGas = await getTokenGas(token, fees, smartWallet.address, native);
  const tokenGas = '50000';
  const baseRelayRequest: RelayRequest = {
    request: {
      relayHub: relayHub.address,
      to: constants.AddressZero,
      data: '0x',
      from: owner.address,
      nonce: (await smartWallet.nonce()).toString(),
      value: '0',
      gas: '0',
      tokenContract: native ? constants.AddressZero : token.address,
      tokenAmount: fees,
      tokenGas: tokenGas.toString(),
      validUntilTime: '0',
    },
    relayData: {
      gasPrice: GAS_PRICE,
      feesReceiver: relayWorker.address,
      callForwarder: smartWallet.address,
      callVerifier: verifier.address,
    },
  };

  // provide the SW with some tokens
  await token.mint(
    BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER).mul(100),
    smartWallet.address
  );

  const ownerInitialBalanceRBTC = await owner.getBalance();
  const relayWorkerInitialBalanceRBTC = await relayWorker.getBalance();
  const smartWalletInitialBalance = await token.balanceOf(smartWallet.address);
  const relayWorkerInitialBalance = await token.balanceOf(relayWorker.address);

  const transferReceiver = ethers.Wallet.createRandom();

  const { data, to, gas } = await getDestinationContractCallParams(
    transferReceiver.address,
    TOKEN_AMOUNT_TO_TRANSFER,
    token,
    smartWallet,
    native,
    swap
  );
  const completeReq = combineTwoRelayRequests(baseRelayRequest, {
    request: {
      data,
      to,
      gas,
    },
  });

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
  const ownerFinalBalanceRBTC = await owner.getBalance();
  const relayWorkerFinalBalanceRBTC = await relayWorker.getBalance();

  const feesBigNumber = BigNumber.from(fees);

  if (!native) {
    assertRelayedTransaction(
      smartWalletInitialBalance,
      relayWorkerInitialBalance,
      smartWalletFinalBalance,
      relayWorkerFinalBalance,
      BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER),
      feesBigNumber
    );
  } else {
    assertRelayWorkerReceivedPayment(
      relayWorkerInitialBalanceRBTC,
      relayWorkerFinalBalanceRBTC,
      feesBigNumber,
      txReceiptWithRelay.gasUsed
    );
    assertSWOwnerReceivedClaimedRBTC(
      ownerInitialBalanceRBTC,
      ownerFinalBalanceRBTC,
      feesBigNumber
    );
  }

  const txReceiptWithoutRelay = await executeTransferEstimationWithoutRelay(
    token
  );

  printRelayGasAnalysis(txReceiptWithRelay, txReceiptWithoutRelay);
}

async function prepareDeployRequest(fees = NO_FEES, native: boolean) {
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

async function estimateDeployCost(fees = NO_FEES, native = false) {
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

async function estimateDeployCostWithExecution(fees = NO_FEES, native = false) {
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
      gas,
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

  const txReceiptWithoutRelay = await executeSwapWithoutRelay(swap);

  printRelayGasAnalysis(txReceipt, txReceiptWithoutRelay);
}

async function getExecutionParameters(
  swap: TestSwap,
  swAddress: string
): Promise<DestinationContractCallParams> {
  const encodedFunction = swap.interface.encodeFunctionData('claim', [
    constants.HashZero,
    CLAIMED_AMOUNT,
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
    gas: estimatedDestinationCallGasCorrected.toString(),
  };
}

async function getTokenGas(
  token: UtilToken,
  fees: string,
  senderAddress: string,
  native = false
) {
  if (fees === NO_FEES) {
    return constants.Zero;
  }

  if (native) {
    return await getEstimatedGasWithCorrection(
      senderAddress,
      relayWorker.address,
      ''
    );
  }

  const dataForTransfer = token.interface.encodeFunctionData('transfer', [
    relayWorker.address,
    fees,
  ]);

  return await getEstimatedGasWithCorrection(
    senderAddress,
    token.address,
    dataForTransfer
  );
}

type Operation = 'relay' | 'deploy' | 'deployWithExecution';
type Payment = 'erc20' | 'native';

interface EstimationRun {
  operation: Operation;
  payment: Payment;
  fees?: string;
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
  const runs: EstimationRun[] = [
    {
      operation: 'relay',
      payment: 'erc20',
      fees: NO_FEES,
    },
    {
      operation: 'relay',
      payment: 'erc20',
      fees: RELAY_FEES,
    },
    {
      operation: 'relay',
      payment: 'native',
      fees: RELAY_FEES,
    },
    {
      operation: 'deploy',
      payment: 'erc20',
      fees: NO_FEES,
    },
    {
      operation: 'deploy',
      payment: 'erc20',
      fees: RELAY_FEES,
    },
    {
      operation: 'deployWithExecution',
      payment: 'erc20',
      fees: NO_FEES,
    },
    {
      operation: 'deployWithExecution',
      payment: 'erc20',
      fees: RELAY_FEES,
    },
    {
      operation: 'deploy',
      payment: 'native',
      fees: RELAY_FEES,
    },
    {
      operation: 'deployWithExecution',
      payment: 'native',
      fees: RELAY_FEES,
    },
  ];
  for (const runConfig of runs) {
    await runEstimation(runConfig);
  }
}

estimateGas().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function runEstimation({ operation, payment, fees }: EstimationRun) {
  logTitle(
    `Operation: ${operation} estimation ${
      fees === NO_FEES ? 'without' : 'with'
    } ${payment} payment`
  );
  switch (operation) {
    case 'relay':
      await estimateRelayCost(fees, payment === 'native');
      break;
    case 'deploy':
      await estimateDeployCost(fees, payment === 'native');
      break;
    case 'deployWithExecution':
      await estimateDeployCostWithExecution(fees, payment === 'native');
      break;
    default:
      break;
  }
}

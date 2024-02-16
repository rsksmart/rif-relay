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
  SupportedType,
  SupportedSmartWallet,
  SupportedSmartWalletName,
  getSmartWalletAddress,
} from '../test/utils/TestUtils';
import { TestSwap, TestVerifierEverythingAccepted } from 'typechain-types';
import { Penalizer, RelayHub } from '@rsksmart/rif-relay-contracts';
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

async function deployAndSetup(payment: Payment = 'erc20') {
  const owner = Wallet.createRandom().connect(ethers.provider);
  const swap = await deployContract<TestSwap>('TestSwap');
  const penalizer = await deployContract<Penalizer>('Penalizer');
  const verifier = await deployContract<TestVerifierEverythingAccepted>(
    'TestVerifierEverythingAccepted'
  );

  const token = await deployContract<UtilToken>('UtilToken');

  const templateNames: Record<Payment, SupportedSmartWalletName> = {
    native: 'BoltzSmartWallet',
    minimalNative: 'MinimalBoltzSmartWallet',
    erc20: 'SmartWallet',
  };
  const template = await deployContract<SupportedSmartWallet>(
    templateNames[payment]
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

  const supportedTypes: Record<Payment, SupportedType> = {
    native: 'Boltz',
    minimalNative: 'MinimalBoltz',
    erc20: 'Default',
  };

  const factory = await createSmartWalletFactory(
    template,
    owner,
    supportedTypes[payment]
  );

  const tokenContracts: Record<Payment, string> = {
    native: constants.AddressZero,
    minimalNative: constants.AddressZero,
    erc20: token.address,
  };

  return {
    relayHub,
    owner,
    token,
    verifier,
    swap,
    factory,
    tokenContractAddress: tokenContracts[payment],
    type: supportedTypes[payment],
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
function assertWorkerReceivedTokenPayment(
  relayWorkerInitialBalance: BigNumber,
  relayWorkerFinalBalance: BigNumber,
  fees: BigNumber | undefined,
  balanceToTransfer: BigNumber
) {
  expect(
    relayWorkerFinalBalance.eq(
      relayWorkerInitialBalance.add(fees ?? balanceToTransfer)
    )
  ).to.equal(true, 'Worker did not receive payment');
}

function assertSmartWalletPayment(
  forwarderInitialBalance: BigNumber,
  forwarderFinalBalance: BigNumber,
  balanceToTransfer: BigNumber,
  fees: BigNumber | undefined
) {
  expect(
    forwarderInitialBalance.eq(
      forwarderFinalBalance.add(balanceToTransfer).add(BigNumber.from(fees))
    )
  ).to.equal(true, 'SW Payment did not occur');
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
        .add(feesBigNumber)
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
  forwarder: SupportedSmartWallet,
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

async function estimateRelayCost(fees = NO_FEES, payment: Payment = 'erc20') {
  const {
    relayHub,
    owner,
    token,
    verifier,
    swap,
    factory,
    tokenContractAddress,
    type,
  } = await deployAndSetup(payment);

  const isNative = isNativePayment(payment);

  const smartWallet: SupportedSmartWallet = await createSupportedSmartWallet({
    relayHub: relayHubSigner.address,
    factory,
    owner,
    sender: relayHubSigner,
    type,
  });

  // provide the SW with some tokens
  await token.mint(
    BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER).mul(100),
    smartWallet.address
  );

  const tokenGas = await getTokenGas(
    token,
    fees,
    smartWallet.address,
    isNative
  );
  const baseRelayRequest: RelayRequest = {
    request: {
      relayHub: relayHub.address,
      to: constants.AddressZero,
      data: '0x',
      from: owner.address,
      nonce: (await smartWallet.nonce()).toString(),
      value: '0',
      gas: '0',
      tokenContract: tokenContractAddress,
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

  const {
    smartWalletTokenBalance: smartWalletInitialBalance,
    relayWorkerTokenBalance: workerInitialBalance,
    relayWorkerRBTCBalance: workerInitialBalanceRBTC,
    ownerRBTCBalance: ownerInitialBalanceRBTC,
  } = await getBalances({
    owner,
    smartWalletAddress: smartWallet.address,
    token,
    relayWorker,
  });

  const transferReceiver = ethers.Wallet.createRandom();

  const { data, to, gas } = await getDestinationContractCallParams(
    transferReceiver.address,
    TOKEN_AMOUNT_TO_TRANSFER,
    token,
    smartWallet,
    isNative,
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

  const {
    smartWalletTokenBalance: swTokenFinalBalance,
    relayWorkerTokenBalance: workerTokenFinalBalance,
    relayWorkerRBTCBalance: workerRBTCFinalBalance,
    ownerRBTCBalance: ownerRBTCFinalBalance,
  } = await getBalances({
    owner,
    smartWalletAddress: smartWallet.address,
    token,
    relayWorker,
  });

  const feesBigNumber = BigNumber.from(fees);
  const balanceToTransfer = BigNumber.from(TOKEN_AMOUNT_TO_TRANSFER);

  if (!isNative) {
    assertSmartWalletPayment(
      smartWalletInitialBalance,
      swTokenFinalBalance,
      balanceToTransfer,
      feesBigNumber
    );
    assertWorkerReceivedTokenPayment(
      workerInitialBalance,
      workerTokenFinalBalance,
      feesBigNumber,
      balanceToTransfer
    );
  } else {
    assertRelayWorkerReceivedPayment(
      workerInitialBalanceRBTC,
      workerRBTCFinalBalance,
      feesBigNumber,
      txReceiptWithRelay.gasUsed
    );
    assertSWOwnerReceivedClaimedRBTC(
      ownerInitialBalanceRBTC,
      ownerRBTCFinalBalance,
      feesBigNumber
    );
  }

  const txReceiptWithoutRelay = await executeTransferEstimationWithoutRelay(
    token
  );

  printRelayGasAnalysis(txReceiptWithRelay, txReceiptWithoutRelay);
}

async function getBalances({
  owner,
  token,
  smartWalletAddress,
  relayWorker,
}: {
  owner: Wallet;
  token: UtilToken;
  smartWalletAddress: string;
  relayWorker: SignerWithAddress;
}) {
  const ownerRBTCBalance = await owner.getBalance();
  const relayWorkerRBTCBalance = await relayWorker.getBalance();
  const smartWalletTokenBalance = await token.balanceOf(smartWalletAddress);
  const relayWorkerTokenBalance = await token.balanceOf(relayWorker.address);

  return {
    smartWalletTokenBalance,
    relayWorkerTokenBalance,
    relayWorkerRBTCBalance,
    ownerRBTCBalance,
  };
}

async function prepareDeployRequest(
  fees = NO_FEES,
  payment: Payment = 'erc20',
  withExecution: boolean
) {
  const SMART_WALLET_INDEX = 1;

  const {
    relayHub,
    owner,
    factory,
    token,
    verifier,
    swap,
    tokenContractAddress,
    type,
  } = await deployAndSetup(payment);

  const isNative = isNativePayment(payment);
  const swAddress = await getSmartWalletAddress({
    type,
    factory,
    owner: owner,
    recoverer: constants.AddressZero,
    index: SMART_WALLET_INDEX,
  });

  if (payment === 'erc20') {
    await token.mint(fees, swAddress);
  } else if (!withExecution) {
    // if there is no final contract execution, the SW needs to have some RBTC to pay the fees
    const sendTx = await owner.sendTransaction({
      value: BigNumber.from(fees),
      to: swAddress,
    });
    await sendTx.wait();
  }

  const tokenGas = await getTokenGas(token, fees, swAddress, isNative);

  const deployRequest: DeployRequest = {
    request: {
      data: '0x00',
      from: owner.address,
      nonce: '0',
      relayHub: relayHub.address,
      to: constants.AddressZero,
      tokenAmount: fees,
      tokenContract: tokenContractAddress,
      tokenGas: tokenGas.toString(),
      value: '0',
      validUntilTime: 0,
      index: SMART_WALLET_INDEX,
      recoverer: constants.AddressZero,
    },
    relayData: {
      callForwarder: factory.address,
      callVerifier: verifier.address,
      feesReceiver: relayWorker.address,
      gasPrice: GAS_PRICE,
    },
  };

  return {
    deployRequest,
    factory,
    owner,
    relayHub,
    swap,
    swAddress,
    token,
  };
}

async function estimateDeployCost(
  fees = NO_FEES,
  payment: Payment = 'erc20',
  withExecution = false
) {
  const { deployRequest, factory, owner, relayHub, swAddress, token, swap } =
    await prepareDeployRequest(fees, payment, withExecution);

  let updatedDeployRequest = {
    ...deployRequest,
  };
  if (withExecution) {
    const { to, data } = await getExecutionParameters(swap, swAddress);

    updatedDeployRequest = {
      request: {
        ...deployRequest.request,
        to,
        data,
      },
      relayData: {
        ...deployRequest.relayData,
      },
    };
  }

  const { signature } = await getSuffixDataAndSignature(
    factory,
    updatedDeployRequest,
    owner
  );

  const {
    smartWalletTokenBalance: swInitialBalance,
    relayWorkerTokenBalance: workerInitialBalance,
    relayWorkerRBTCBalance: workerInitialBalanceRBTC,
  } = await getBalances({
    owner,
    smartWalletAddress: swAddress,
    token,
    relayWorker,
  });

  await assertSmartWalletNotDeployed(swAddress);

  const txResponse = await relayHub
    .connect(relayWorker)
    .deployCall(updatedDeployRequest, signature, {
      gasPrice: GAS_PRICE,
    });

  const txReceipt = await txResponse.wait();

  const {
    smartWalletTokenBalance: swTokenFinalBalance,
    relayWorkerTokenBalance: workerTokenFinalBalance,
    relayWorkerRBTCBalance: workerRBTCFinalBalance,
  } = await getBalances({
    owner,
    smartWalletAddress: swAddress,
    token,
    relayWorker,
  });

  await assertSmartWalletDeployed(swAddress);
  const feesBigNumber = BigNumber.from(fees);
  const balanceToTransfer = BigNumber.from(0);

  if (!isNativePayment(payment)) {
    assertSmartWalletPayment(
      swInitialBalance,
      swTokenFinalBalance,
      balanceToTransfer,
      feesBigNumber
    );
    assertWorkerReceivedTokenPayment(
      workerInitialBalance,
      workerTokenFinalBalance,
      feesBigNumber,
      balanceToTransfer
    );
  } else {
    assertRelayWorkerReceivedPayment(
      workerInitialBalanceRBTC,
      workerRBTCFinalBalance,
      feesBigNumber,
      txReceipt.gasUsed
    );
  }
  console.log('\tTotal gas used on deploy: ', txReceipt.gasUsed.toString());

  if (withExecution) {
    const txReceiptWithoutRelay = await executeSwapWithoutRelay(swap);
    printRelayGasAnalysis(txReceipt, txReceiptWithoutRelay);
  }
}

async function assertSmartWalletNotDeployed(swAddress: string) {
  const swCodeBefore = await ethers.provider.getCode(swAddress);
  expect(swCodeBefore).to.be.eq(
    '0x',
    `Smart Wallet already deployed at address ${swAddress}`
  );
}

async function assertSmartWalletDeployed(swAddress: string) {
  const swCode = await ethers.provider.getCode(swAddress);
  expect(swCode).not.to.be.eq(
    '0x',
    `Smart Wallet not deployed at address ${swAddress}`
  );
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
async function runEstimation({ operation, payment, fees }: EstimationRun) {
  logTitle(
    `Operation: ${operation} estimation ${
      fees === NO_FEES ? 'without' : 'with'
    } ${payment} payment`
  );
  const operations: Record<Operation, () => Promise<void>> = {
    relay: () => estimateRelayCost(fees, payment),
    deploy: () => estimateDeployCost(fees, payment),
    deployWithExecution: () => estimateDeployCost(fees, payment, true),
  };
  await operations[operation]();
}

type Operation = 'relay' | 'deploy' | 'deployWithExecution';
type Payment = 'erc20' | 'native' | 'minimalNative';

function isNativePayment(payment: Payment) {
  return ['native', 'minimalNative'].includes(payment);
}

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
      operation: 'deploy',
      payment: 'minimalNative',
      fees: RELAY_FEES,
    },
    {
      operation: 'deployWithExecution',
      payment: 'native',
      fees: RELAY_FEES,
    },

    {
      operation: 'deployWithExecution',
      payment: 'minimalNative',
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

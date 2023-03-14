import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  // DeployRequestBody,
  ESTIMATED_GAS_CORRECTION_FACTOR,
  EnvelopingRequestData,
  INTERNAL_TRANSACTION_ESTIMATED_CORRECTION,
  RelayRequest,
  RelayRequestBody,
  // SHA3_NULL_S,
} from '@rsksmart/rif-relay-client';
import { UtilToken } from '@rsksmart/rif-relay-contracts';
import {
  BigNumber,
  /* Contract, */ ContractReceipt,
  Wallet /* constants */,
} from 'ethers';
import {
  // CreateSmartWalletParams,
  RSK_URL,
  // createEnvelopingRequest,
  createSmartWalletFactory,
  createSupportedSmartWallet,
  deployRelayHub,
  getSuffixDataAndSignature,
  // signEnvelopingRequest,
} from '../test/utils/TestUtils';
import {
  Penalizer,
  RelayHub,
  SmartWallet,
  SmartWalletFactory,
  TestRecipient,
  TestVerifierEverythingAccepted,
} from 'typechain-types';
import { expect } from 'chai';

// import SmartWalletJson from '../artifacts/@rsksmart/rif-relay-contracts/contracts/smartwallet/SmartWallet.sol/SmartWallet.json';

const gasPrice = 1;
const gasLimit = 4e6;
const bgMagenta = '\x1B[45m';
const underline = '\x1b[4m';
const reset = '\x1b[0m';

let penalizer: Penalizer;
let relayHub: RelayHub;
let verifier: TestVerifierEverythingAccepted;
let recipient: TestRecipient;
let token: UtilToken;
let owner: Wallet;
let forwarder: SmartWallet;
let relayRequest: RelayRequest;
let relayWorker: SignerWithAddress;
let relayManager: SignerWithAddress;
let relayOwner: SignerWithAddress;
let fundedAccount: SignerWithAddress;
let relayHubSigner: SignerWithAddress;

const cloneRelayRequest = (
  relayRequest: RelayRequest,
  override: {
    request?: Partial<RelayRequestBody>;
    relayData?: Partial<EnvelopingRequestData>;
  }
) => {
  return {
    request: { ...relayRequest.request, ...override.request },
    relayData: { ...relayRequest.relayData, ...override.relayData },
  };
};

function logTitle(title: string) {
  console.log(`${underline}${title}${reset}`);
}

function logGasOverhead(gasOverhead: BigNumber) {
  console.log(
    `${bgMagenta}Enveloping Overhead Gas: ${gasOverhead.toString()}${reset}\n`
  );
}

const deployContract = <Contract>(contract: string) => {
  return ethers
    .getContractFactory(contract)
    .then((contractFactory) => contractFactory.deploy() as Contract);
};

const deployAndSetup = async () => {
  const provider = new ethers.providers.JsonRpcProvider(RSK_URL);

  owner = ethers.Wallet.createRandom().connect(provider);
  penalizer = await deployContract<Penalizer>('Penalizer');
  verifier = await deployContract<TestVerifierEverythingAccepted>(
    'TestVerifierEverythingAccepted'
  );
  recipient = await deployContract<TestRecipient>('TestRecipient');
  token = await deployContract<UtilToken>('UtilToken');
  const smartWalletTemplate = await deployContract<SmartWallet>('SmartWallet');

  relayHub = await deployRelayHub(penalizer.address);

  await fundedAccount.sendTransaction({
    to: owner.address,
    value: ethers.utils.parseEther('1'),
  });

  const factory = (await createSmartWalletFactory(
    smartWalletTemplate,
    false,
    owner
  )) as SmartWalletFactory;

  forwarder = (await createSupportedSmartWallet({
    relayHub: relayHubSigner.address,
    factory,
    owner,
    sender: relayHubSigner,
    logGas: true,
  })) as SmartWallet;

  await token.mint('1000', forwarder.address);

  relayRequest = {
    request: {
      relayHub: relayHub.address,
      to: recipient.address,
      data: '0xdeadbeef',
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
      gasPrice,
      feesReceiver: relayWorker.address,
      callForwarder: forwarder.address,
      callVerifier: verifier.address,
    },
  };

  await relayHub
    .connect(relayOwner)
    .stakeForAddress(relayManager.address, 1000, {
      value: ethers.utils.parseEther('2'),
    });

  await relayHub.connect(relayManager).addRelayWorkers([relayWorker.address]);
  await relayHub.connect(relayManager).registerRelayServer('http://relay.com');

  return {
    forwarder,
    recipient,
    relayHub,
    owner,
    relayRequest,
  };
};

async function printGasStatus(receipt: ContractReceipt) {
  const [firstAccount] = (await ethers.getSigners()) as [SignerWithAddress];
  await token.mint('1000', firstAccount.address);

  const noRelayCall = await token.transfer(owner.address, '1000');
  const { gasUsed: gasUsedWithoutRelay } = await noRelayCall.wait();

  const gasOverhead = receipt.gasUsed.sub(gasUsedWithoutRelay);
  console.log(
    `Destination Call Without enveloping - Gas Used: ${gasUsedWithoutRelay.toString()}`
  );
  console.log(
    `Destination Call with enveloping - Gas Used: ${receipt.gasUsed.toString()}`
  );
  logGasOverhead(gasOverhead);
}

function printGasAnalysis({
  cumulativeGasUsed,
  detailedEstimation,
  internalDestinationCallCost,
  internalTokenCallCost,
}: {
  internalDestinationCallCost: number;
  internalTokenCallCost: number;
  detailedEstimation: number;
  cumulativeGasUsed: number;
}) {
  console.log(
    'The destination contract call estimate is: ',
    internalDestinationCallCost
  );
  console.log('The token gas estimate is: ', internalTokenCallCost);
  console.log('X = ', internalDestinationCallCost + internalTokenCallCost);

  console.log(`Detailed estimation: ${detailedEstimation}`);
  console.log(`Cumulative Gas Used: ${cumulativeGasUsed}\n`);
}

const assertRelayedTransaction = async (
  forwarderInitialBalance: BigNumber,
  relayWorkerInitialBalance: BigNumber,
  balanceToTransfer: BigNumber,
  fees?: BigNumber
) => {
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
};

const assertNonce = async (nonceBefore: BigNumber) => {
  const nonceAfter = await forwarder.nonce();
  expect(nonceBefore.add(1).toNumber()).to.equal(
    nonceAfter.toNumber(),
    'Incorrect nonce after execution'
  );
};

const correctEstimatedCallCost = (estimate: number) => {
  const correction = INTERNAL_TRANSACTION_ESTIMATED_CORRECTION;

  return (
    ESTIMATED_GAS_CORRECTION_FACTOR *
    (estimate > correction ? estimate - correction : estimate)
  );
};

const getCurrentBalances = async () => {
  const nonceBefore = await forwarder.nonce();
  const forwarderInitialBalance = await token.balanceOf(forwarder.address);
  const relayWorkerInitialBalance = await token.balanceOf(
    relayWorker.address
  );

  return {
    nonceBefore,
    forwarderInitialBalance,
    relayWorkerInitialBalance,
  };
};

const triggerRelayCallProcess = async ({
  message,
  estimateGasLimit,
  noPayment,
  noTokenGas,
  noTokenContract,
  noCorrection,
}: {
  message: string;
  estimateGasLimit?: boolean;
  noPayment?: boolean;
  noTokenGas?: boolean;
  noTokenContract?: boolean;
  noCorrection?: boolean;
}) => {
  const encodedFunction = recipient.interface.encodeFunctionData(
    'emitMessage',
    [message]
  );

  await token.mint('100', forwarder.address);

  const { nonceBefore, forwarderInitialBalance, relayWorkerInitialBalance } =
    await getCurrentBalances();

  const balanceToTransfer = noPayment
    ? '0x00'
    : forwarderInitialBalance.toNumber();

  const estimatedDestinationCallGas = await ethers.provider.estimateGas({
    from: forwarder.address,
    to: recipient.address,
    gasPrice,
    data: encodedFunction,
  });

  const internalDestinationCallCost = noCorrection
    ? estimatedDestinationCallGas.toNumber()
    : correctEstimatedCallCost(estimatedDestinationCallGas.toNumber());

  let internalTokenCallCost = 0;
  if (!noTokenGas) {
    const estimatedTokenPaymentGas = await ethers.provider.estimateGas({
      from: forwarder.address,
      to: token.address,
      data: token.interface.encodeFunctionData('transfer', [
        relayWorker.address,
        balanceToTransfer,
      ]),
    });
    internalTokenCallCost = correctEstimatedCallCost(
      estimatedTokenPaymentGas.toNumber()
    );
  }

  const completeReq: RelayRequest = cloneRelayRequest(relayRequest, {
    request: {
      nonce: nonceBefore.toString(),
      tokenAmount: balanceToTransfer,
      data: encodedFunction,
      gas: internalDestinationCallCost,
      tokenGas: internalTokenCallCost,
      tokenContract: noTokenContract
        ? ethers.constants.AddressZero
        : token.address,
    },
  });

  const { signature } = await getSuffixDataAndSignature(
    forwarder,
    completeReq,
    owner
  );

  const detailedEstimation = await ethers.provider.estimateGas({
    from: relayWorker.address,
    to: relayHub.address,
    data: relayHub.interface.encodeFunctionData('relayCall', [
      completeReq,
      signature,
    ]),
    gasPrice,
    gasLimit: estimateGasLimit ? gasLimit : undefined,
  });

  const relayCallResult = await relayHub
    .connect(relayWorker)
    .relayCall(completeReq, signature, {
      gasLimit,
      gasPrice,
    });

  await assertRelayedTransaction(
    forwarderInitialBalance,
    relayWorkerInitialBalance,
    BigNumber.from(balanceToTransfer)
  );

  await assertNonce(nonceBefore);

  const { cumulativeGasUsed, gasUsed } = await relayCallResult.wait();

  return {
    gasUsed,
    cumulativeGasUsed: cumulativeGasUsed.toNumber(),
    detailedEstimation: detailedEstimation.toNumber(),
    internalDestinationCallCost,
    internalTokenCallCost,
  };
};

async function forgeRequest(
  transferReceiver: string,
  balanceToTransfer: number,
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

  const estimatedDestinationCallGas = await ethers.provider.estimateGas({
    from: forwarder.address,
    to: token.address,
    gasPrice,
    data: encodedFunction,
  });

  const internalDestinationCallCost = correctEstimatedCallCost(
    estimatedDestinationCallGas.toNumber()
  );

  const estimatedTokenPaymentGas = await ethers.provider.estimateGas({
    from: forwarder.address,
    to: token.address,
    data: token.interface.encodeFunctionData('transfer', [
      relayWorker.address,
      fees,
    ]),
  });

  const tokenGas = !isSponsored
    ? {
        tokenGas: correctEstimatedCallCost(
          estimatedTokenPaymentGas.toNumber()
        ),
      }
    : {};

  const completeReq: RelayRequest = cloneRelayRequest(relayRequest, {
    request: {
      data: encodedFunction,
      to: token.address,
      nonce: (await forwarder.nonce()).toString(),
      tokenAmount: fees,
      tokenContract,
      gas: internalDestinationCallCost,
      ...tokenGas,
    },
  });

  return completeReq;
}

async function estimateTokenTransferGasOverhead(fees: string) {
  await deployAndSetup();
  // refill SW balance
  await token.mint('9000', forwarder.address);

  const { forwarderInitialBalance, relayWorkerInitialBalance } =
    await getCurrentBalances();

  const transferReceiver = ethers.Wallet.createRandom();

  // necessary to execute the transfer tx without relay
  const balanceToTransfer = 1000;

  // forge the request
  const completeReq: RelayRequest = await forgeRequest(
    transferReceiver.address,
    balanceToTransfer,
    fees,
    token,
    relayRequest,
    forwarder
  );

  const { signature } = await getSuffixDataAndSignature(
    forwarder,
    completeReq,
    owner
  );

  const relayCallResult = await relayHub
    .connect(relayWorker)
    .relayCall(completeReq, signature, {
      gasLimit,
      gasPrice,
    });
  const txReceipt = await relayCallResult.wait();

  await assertRelayedTransaction(
    forwarderInitialBalance,
    relayWorkerInitialBalance,
    BigNumber.from(balanceToTransfer),
    BigNumber.from(fees)
  );
  await printGasStatus(txReceipt);
}

async function runGasPrediction1(){
  const message = 'RIF ENVELOPING '.repeat(22);

  const relayCallProcessFirstResult = await triggerRelayCallProcess({
    message,
    estimateGasLimit: true,
  });

  printGasAnalysis(relayCallProcessFirstResult);

  console.log('ROUND 2');
  
  const relayCallProcessSecondResult = await triggerRelayCallProcess({
    message,
  });

  printGasAnalysis(relayCallProcessSecondResult);
}

async function runGasPrediction2(){
  logTitle('Gas prediction - without token payment:');

  const message = 'RIF ENVELOPING '.repeat(77);
  const relayCallProcessFirstResult = await triggerRelayCallProcess({
    message,
    estimateGasLimit: true,
    noPayment: true,
    noTokenGas: true,
  });

  printGasAnalysis(relayCallProcessFirstResult);

  console.log('ROUND 2');
  const relayCallProcessSecondResult = await triggerRelayCallProcess({
    message,
    noPayment: true,
    noTokenGas: true,
  });

  printGasAnalysis(relayCallProcessSecondResult);
}

async function runGasEstimation(){
  const message = 'RIF Enveloping '.repeat(32);
  
  const { gasUsed, cumulativeGasUsed } = await triggerRelayCallProcess({
    message,
    estimateGasLimit: true,
    noPayment: true,
    noTokenGas: true,
    noTokenContract: true,
    noCorrection: true,
  });

  const callWithoutRelay = await recipient.emitMessage(message);
  const callWithoutRelayReceipt = await callWithoutRelay.wait();
  const cumulativeGasUsedWithoutRelay =
    callWithoutRelayReceipt.cumulativeGasUsed.toNumber();
  const gasOverhead = cumulativeGasUsed - cumulativeGasUsedWithoutRelay;
  console.log(
    `Destination Call without enveloping - Gas Used: ${callWithoutRelayReceipt.gasUsed.toNumber()}, Cumulative Gas Used: ${cumulativeGasUsedWithoutRelay}`
  );
  console.log(
    `Destination Call with enveloping - Gas Used: ${gasUsed.toNumber()}, CumulativeGasUsed: ${cumulativeGasUsed}`
  );
  console.log(
    `Enveloping Overhead (message length: ${message.length}) - Overhead Gas: ${gasOverhead} `
  );  console.log('Round 2: ');

  const { gasUsed: gasUsedRound2, cumulativeGasUsed: cumulativeGasUsedRound2 } =
    await triggerRelayCallProcess({
      message,
      estimateGasLimit: true,
      noPayment: true,
      noTokenGas: true,
      noTokenContract: true,
      noCorrection: true,
    });

  console.log(
    `Destination Call with enveloping - Gas Used: ${gasUsedRound2.toNumber()}, CumulativeGasUsed: ${cumulativeGasUsedRound2}\n`
  );
}

async function runGasEstimationScenarios(){
  const message = 'RIF Enveloping '.repeat(32);

  const encodedFunction = recipient.interface.encodeFunctionData(
    'emitMessage',
    [message]
  );

  const nonceBefore = await forwarder.nonce();

  const completeReq = cloneRelayRequest(relayRequest, {
    request: {
      data: encodedFunction,
      nonce: nonceBefore.toString(),
      tokenAmount: '0',
      tokenGas: '0',
    },
  });

  const { signature: sig } = await getSuffixDataAndSignature(
    forwarder,
    completeReq,
    owner
  );

  const relayCallResult = await relayHub
    .connect(relayWorker)
    .relayCall(completeReq, sig, {
      gasLimit,
      gasPrice,
    });

  const nonceAfter = await forwarder.nonce();
  expect(nonceBefore.add(1).toNumber()).to.equal(nonceAfter.toNumber());

  const txReceipt = await relayCallResult.wait();

  console.log(
    `Gas Used: ${txReceipt.gasUsed.toString()} - Cumulative Gas Used: ${txReceipt.cumulativeGasUsed.toString()}\n`
  );

  logTitle('Gas estimation tests for token transfer - with token payment');
  await estimateTokenTransferGasOverhead('5000');

  logTitle('Gas estimation tests for token transfer - without token payment');
  await estimateTokenTransferGasOverhead('0');
}

const estimateGas = async () => {
  const [
    localRelayWorker,
    localRelayManager,
    localRelayOwner,
    localFundedAccount,
    localRelayHubSigner,
  ] = (await ethers.getSigners()) as [
    SignerWithAddress,
    SignerWithAddress,
    SignerWithAddress,
    SignerWithAddress,
    SignerWithAddress
  ];

  relayWorker = localRelayWorker;
  relayManager = localRelayManager;
  relayOwner = localRelayOwner;
  fundedAccount = localFundedAccount;
  relayHubSigner = localRelayHubSigner;

  logTitle('Gas prediction - with token payment:');

  await deployAndSetup();

  await runGasPrediction1();
  await runGasPrediction2();


  logTitle('Gas estimation tests for SmartWallet');

  ({ recipient, forwarder, owner, relayRequest, relayHub } =
    await deployAndSetup());

  await runGasEstimation();

  logTitle('Gas estimation scenarios');

  await deployAndSetup();
  await runGasEstimationScenarios();

};

estimateGas().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

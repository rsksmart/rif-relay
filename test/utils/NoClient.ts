import { AccountManager, isDataEmpty } from '@rsksmart/rif-relay-client';
import {
  EnvelopingTypes,
  IERC20__factory,
  IForwarder__factory,
  ISmartWalletFactory__factory,
  IWalletFactory__factory,
} from '@rsksmart/rif-relay-contracts';
import { getProvider } from '@rsksmart/rif-relay-server';
import { BigNumber, BigNumberish, Wallet, constants, ethers } from 'ethers';
import { BytesLike, isAddress } from 'ethers/lib/utils';
import { PromiseOrValue } from 'typechain-types/common';

// configuration
const INTERNAL_TRANSACTION_ESTIMATED_CORRECTION: BigNumberish = 20000;
const ESTIMATED_GAS_CORRECTION_FACTOR: BigNumberish = 1;
const REQUEST_VALID_SECONDS = 172800;
const MIN_GAS_PRICE = 60000000; // 0.06 GWei
const GAS_PRICE_FACTOR_PERCENT = 0;

const MISSING_SMART_WALLET_ADDRESS =
  'Missing smart wallet address in requestConfig. Should be calculated before estimating the gas cost for a deploy transaction';
const MISSING_CALL_FORWARDER = 'Missing call forwarder in a relay request';

type PrepareRequestArg = {
  relayWorkerAddress: string;
  relayHubAddress: string;
  feesReceiver: string;
  request: EnvelopingRequest;
  signerWallet?: Wallet;
};

type PreparePaymentGasArg = {
  envelopingRequest: EnvelopingRequest;
  isDeployment?: boolean;
  provider: ethers.providers.Provider;
};

export const prepareHttpRequest = async ({
  feesReceiver,
  relayWorkerAddress,
  relayHubAddress,
  request: envelopingRequest,
  signerWallet = ethers.Wallet.createRandom(),
}: PrepareRequestArg) => {
  const provider = getProvider();

  const MAX_RELAY_NONCE_GAP = 3;
  const relayMaxNonce =
    (await provider.getTransactionCount(relayWorkerAddress)) +
    MAX_RELAY_NONCE_GAP;

  if (
    !feesReceiver ||
    feesReceiver === constants.AddressZero ||
    !isAddress(feesReceiver)
  ) {
    throw new Error('FeesReceiver has to be a valid non-zero address');
  }
  const isDeployment = 'index' in envelopingRequest;

  const paymentGas = await preparePaymentGas({
    envelopingRequest,
    isDeployment,
    provider,
  });

  const updatedRelayRequest: EnvelopingRequest = {
    request: {
      ...envelopingRequest.request,
      tokenGas: paymentGas.toString(),
    },
    relayData: {
      ...envelopingRequest.relayData,
      feesReceiver,
    },
  };

  // TODO: this is the only part we use from the client to sign the transaction
  const accountManager = AccountManager.getInstance();

  const metadata: EnvelopingMetadata = {
    relayHubAddress,
    signature: await accountManager.sign(updatedRelayRequest, signerWallet),
    relayMaxNonce,
  };
  const httpRequest: EnvelopingTxRequest = {
    relayRequest: updatedRelayRequest,
    metadata,
  };

  return httpRequest;
};

const preparePaymentGas = async ({
  envelopingRequest,
  isDeployment,
  provider,
}: PreparePaymentGasArg): Promise<BigNumber> => {
  const {
    request: { tokenGas, tokenAmount, tokenContract },
    relayData: { gasPrice, callForwarder, feesReceiver },
  } = envelopingRequest;

  const currentTokenAmount = BigNumber.from(tokenAmount);

  if (currentTokenAmount.isZero()) {
    return constants.Zero;
  }

  const currentTokenGas = BigNumber.from(tokenGas);

  if (currentTokenGas.gt(constants.Zero)) {
    return currentTokenGas;
  }

  const { from, index, recoverer, to, data } = envelopingRequest.request as {
    from: string;
    index: string;
    recoverer: string;
    to: string;
    data: string;
  };

  const origin = isDeployment
    ? await getSmartWalletAddress({
        owner: from,
        smartWalletIndex: index,
        recoverer,
        to,
        data,
        factoryAddress: await envelopingRequest.relayData.callForwarder,
        provider,
      })
    : await callForwarder;

  const isNativePayment = (await tokenContract) === constants.AddressZero;

  return isNativePayment
    ? await estimateInternalCallGas({
        from: origin,
        to,
        gasPrice: await gasPrice,
        data,
      })
    : await estimateTokenTransferGas({
        relayRequest: {
          ...envelopingRequest,
          relayData: {
            ...envelopingRequest.relayData,
            feesReceiver,
          },
        },
        preDeploySWAddress: origin,
      });
};

type TokenGasEstimationParams = {
  preDeploySWAddress: string;
  relayRequest: EnvelopingRequest;
};

const estimateTokenTransferGas = async ({
  preDeploySWAddress,
  relayRequest,
}: TokenGasEstimationParams): Promise<BigNumber> => {
  const {
    request: { tokenContract, tokenAmount },
    relayData: { callForwarder, gasPrice, feesReceiver },
  } = relayRequest;

  if (!Number(tokenContract) || tokenAmount.toString() === '0') {
    return constants.Zero;
  }

  let tokenOrigin: PromiseOrValue<string> | undefined;

  if (isDeployRequest(relayRequest)) {
    tokenOrigin = preDeploySWAddress;

    // If it is a deploy and tokenGas was not defined, then the smartwallet address
    // is required to estimate the token gas. This value should be calculated prior to
    // the call to this function
    if (!tokenOrigin || tokenOrigin === constants.AddressZero) {
      throw Error(MISSING_SMART_WALLET_ADDRESS);
    }
  } else {
    tokenOrigin = callForwarder;

    if (tokenOrigin === constants.AddressZero) {
      throw Error(MISSING_CALL_FORWARDER);
    }
  }

  const provider = getProvider();

  const erc20 = IERC20__factory.connect(await tokenContract, provider);
  const gasCost = await erc20.estimateGas.transfer(feesReceiver, tokenAmount, {
    from: tokenOrigin,
    gasPrice,
  });

  const internalCallCost = applyInternalEstimationCorrection(gasCost);

  return applyGasCorrectionFactor(internalCallCost);
};

type SmartWalletAddressTxOptions = {
  owner: string;
  smartWalletIndex: BigNumberish;
  recoverer: string;
  to?: string;
  data?: string | BytesLike;
  factoryAddress: string;
  isCustom?: boolean;
  provider: ethers.providers.Provider;
};

const getSmartWalletAddress = async ({
  factoryAddress,
  owner,
  recoverer,
  smartWalletIndex,
  provider,
}: SmartWalletAddressTxOptions) => {
  return await ISmartWalletFactory__factory.connect(
    factoryAddress,
    provider
  ).getSmartWalletAddress(owner, recoverer, smartWalletIndex);
};

type EstimateInternalGasParams = {
  data: BytesLike;
  to: string;
  from: string;
  gasPrice: BigNumberish;
};

const estimateInternalCallGas = async ({
  ...estimateGasParams
}: EstimateInternalGasParams): Promise<BigNumber> => {
  const provider = getProvider();

  let estimation: BigNumber = await provider.estimateGas(estimateGasParams);

  estimation = applyInternalEstimationCorrection(estimation);

  return applyGasCorrectionFactor(estimation, ESTIMATED_GAS_CORRECTION_FACTOR);
};

const applyInternalEstimationCorrection = (
  estimation: BigNumberish,
  internalTransactionEstimationCorrection: BigNumberish = INTERNAL_TRANSACTION_ESTIMATED_CORRECTION
) => {
  const estimationBN = BigNumber.from(estimation);

  if (estimationBN.gt(internalTransactionEstimationCorrection)) {
    return estimationBN.sub(internalTransactionEstimationCorrection);
  }

  return estimationBN;
};

const applyGasCorrectionFactor = (
  estimation: BigNumberish,
  estimatedGasCorrectFactor: BigNumberish = ESTIMATED_GAS_CORRECTION_FACTOR
): BigNumber => {
  // Note: in the original implementation in the client, we use BigNumberJs
  if (estimatedGasCorrectFactor.toString() !== '1') {
    const bigGasCorrection = BigNumber.from(
      estimatedGasCorrectFactor.toString()
    );
    let bigEstimation = BigNumber.from(estimation.toString());
    bigEstimation = bigEstimation.mul(bigGasCorrection);

    return BigNumber.from(bigEstimation);
  }

  return BigNumber.from(estimation);
};

type RelayRequest = EnvelopingTypes.RelayRequestStruct;
type DeployRequest = EnvelopingTypes.DeployRequestStruct;

// NOTE: this is a simplification of the type used in the client
type EnvelopingRequest = {
  request: RelayRequest['request'] | DeployRequest['request'];
  relayData: RelayRequest['relayData'];
};

export type EnvelopingRequestOptional = {
  request: Partial<RelayRequest['request']> | Partial<DeployRequest['request']>;
  relayData: Partial<RelayRequest['relayData']>;
};

type EnvelopingMetadata = {
  relayHubAddress: RelayRequest['request']['relayHub'];
  relayMaxNonce: number;
  signature: string;
};

type EnvelopingTxRequest = {
  relayRequest: EnvelopingRequest;
  metadata: EnvelopingMetadata;
};

const isDeployRequest = (request: EnvelopingRequestOptional) =>
  'index' in request.request;

const MISSING_REQUEST_FIELD = (field: string) =>
  `Field ${field} is not defined in request body.`;

type EnvelopingRequestArg = {
  envelopingRequest: EnvelopingRequestOptional;
  provider: ethers.providers.Provider;
};

export const getEnvelopingRequestDetails = async ({
  envelopingRequest,
  provider,
}: EnvelopingRequestArg): Promise<EnvelopingRequest> => {
  const isDeployment: boolean = isDeployRequest(envelopingRequest);
  const { relayData, request } = envelopingRequest;

  const { from, tokenContract } = request;

  if (!from) {
    throw new Error(MISSING_REQUEST_FIELD('from'));
  }

  if (!tokenContract) {
    throw new Error(MISSING_REQUEST_FIELD('tokenContract'));
  }

  if (!isDeployment) {
    if (!relayData?.callForwarder) {
      throw new Error(MISSING_REQUEST_FIELD('callForwarder'));
    }

    if (!request.data) {
      throw new Error(MISSING_REQUEST_FIELD('data'));
    }

    if (!request.to) {
      throw new Error(MISSING_REQUEST_FIELD('to'));
    }
  }

  if (!relayData?.callForwarder) {
    throw new Error(MISSING_REQUEST_FIELD('callForwarder'));
  }
  const callForwarder = await relayData.callForwarder;
  const data = (await request.data) ?? '0x00';
  const to = (await request.to) ?? constants.AddressZero;
  const value =
    (await envelopingRequest.request.value)?.toString() ??
    constants.Zero.toString();
  const tokenAmount =
    (await envelopingRequest.request.tokenAmount)?.toString() ?? constants.Zero;

  if (isCallInvalid(to, data, value)) {
    throw new Error('Contract execution needs data or value to be sent.');
  }

  const { index } = request as DeployRequest['request'];

  const callVerifier = envelopingRequest.relayData?.callVerifier;

  if (!callVerifier) {
    throw new Error('No call verifier present. Check your configuration.');
  }

  const gasPrice: BigNumberish =
    (await envelopingRequest.relayData?.gasPrice) ||
    (await calculateGasPrice());

  if (!gasPrice || BigNumber.from(gasPrice).isZero()) {
    throw new Error('Could not get gas price for request');
  }

  const nonce =
    ((await envelopingRequest.request.nonce) ||
      (isDeployment
        ? await IWalletFactory__factory.connect(callForwarder, provider).nonce(
            from
          )
        : await IForwarder__factory.connect(
            callForwarder,
            provider
          ).nonce())) ??
    constants.Zero;
  const relayHub = envelopingRequest.request.relayHub;

  if (!relayHub) {
    throw new Error('No relay hub address has been given or configured');
  }

  const recoverer =
    (envelopingRequest.request as DeployRequest['request']).recoverer ??
    constants.AddressZero;

  const updateRelayData = {
    callForwarder,
    callVerifier,
    feesReceiver: constants.AddressZero, // returns zero address and is to be completed when attempting to relay the transaction
    gasPrice: gasPrice.toString(),
  };

  const secondsNow = Math.round(Date.now() / 1000);
  const validUntilTime =
    (await request.validUntilTime) ?? secondsNow + REQUEST_VALID_SECONDS;

  // tokenGas can be zero here and is going to be calculated while attempting to relay the transaction.
  const tokenGas = (await request.tokenGas)?.toString() ?? constants.Zero;

  const gasLimit = await ((envelopingRequest.request as RelayRequest['request'])
    .gas ??
    estimateInternalCallGas({
      data,
      from: callForwarder,
      to,
      gasPrice,
    }));

  if (!isDeployment && (!gasLimit || BigNumber.from(gasLimit).isZero())) {
    throw new Error('Gas limit value (`gas`) is required in a relay request.');
  }

  const commonRequestBody: CommonEnvelopingRequestBody = {
    data,
    from,
    nonce: nonce.toString(),
    relayHub,
    to,
    tokenAmount,
    tokenContract,
    tokenGas,
    value,
    validUntilTime,
  };

  const completeRequest: EnvelopingRequest = isDeployment
    ? {
        request: {
          ...commonRequestBody,
          ...{
            index,
            recoverer,
          },
        },
        relayData: updateRelayData,
      }
    : {
        request: {
          ...commonRequestBody,
          ...{
            gas: gasLimit,
          },
        },
        relayData: updateRelayData,
      };

  return completeRequest;
};

const isCallInvalid = (
  to: string,
  data: BytesLike,
  value: BigNumberish
): boolean => {
  return (
    to != constants.AddressZero &&
    isDataEmpty(data.toString()) &&
    BigNumber.from(value).isZero()
  );
};

const calculateGasPrice = async (): Promise<BigNumber> => {
  const provider = getProvider();

  const networkGasPrice = BigNumber.from(
    (await provider.getGasPrice()).toString()
  );

  const gasPrice = networkGasPrice.mul(GAS_PRICE_FACTOR_PERCENT + 1);

  return BigNumber.from(
    gasPrice.lt(MIN_GAS_PRICE) ? MIN_GAS_PRICE : gasPrice // originally we use the BigNumberJS that has the .toFixed(0) method
  );
};

type CommonEnvelopingRequestBody = {
  relayHub: PromiseOrValue<string>;
  from: PromiseOrValue<string>;
  to: PromiseOrValue<string>;
  tokenContract: PromiseOrValue<string>;
  value: PromiseOrValue<BigNumberish>;
  nonce: PromiseOrValue<BigNumberish>;
  tokenAmount: PromiseOrValue<BigNumberish>;
  tokenGas: PromiseOrValue<BigNumberish>;
  validUntilTime: PromiseOrValue<BigNumberish>;
  data: PromiseOrValue<BytesLike>;
};

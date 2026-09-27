import { expect } from 'chai';
import { ethers } from 'hardhat';
import config from 'config';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  BigNumber,
  constants,
  Contract,
  ContractTransaction,
  utils,
  Wallet,
} from 'ethers';
import {
  AccountManager,
  RelayClient,
  UserDefinedDeployRequest,
  UserDefinedEnvelopingRequest,
  UserDefinedRelayRequest,
  estimateRelayMaxPossibleGas,
  estimateRelayMaxPossibleGasNoSignature,
  setEnvelopingConfig,
  setProvider,
} from '@rsksmart/rif-relay-client';
import {
  AppConfig,
  getServerConfig,
  HttpServer,
  RelayServer,
  ServerConfigParams,
} from '@rsksmart/rif-relay-server';
import { RelayHub__factory } from '@rsksmart/rif-relay-contracts';
import {
  BoltzSmartWallet,
  BoltzSmartWalletFactory,
  LendaswapDeployVerifier,
  LendaswapRelayVerifier,
  MinimalBoltzRelayVerifier,
  MinimalBoltzSmartWalletFactory,
  MinimalLendaswapDeployVerifier,
  RelayHub,
} from 'typechain-types';
import {
  createSmartWalletFactory,
  deployContract,
  deployRelayHub,
  RSK_URL,
} from '../utils/TestUtils';
import { loadConfiguration } from '../relayserver/ServerTestUtils';
import {
  createEnvelopingTxRequest,
  getInitiatedServer,
} from '../relayserver/ServerTestEnvironments';
import HTLCNativeJson from './fixtures/HTLCNative.json';
import HTLCNativeCoordinatorJson from './fixtures/HTLCNativeCoordinator.json';

/**
 * End-to-end check that rif-relay-client and rif-relay-server can sponsor
 * Lendaswap claims with the new smart wallets, against a local RSK node.
 *
 * HTLCNative / HTLCNativeCoordinator are deployed from the bytecode verified on
 * Rootstock testnet (see ./artifacts). The wallet stacks are deployed the same
 * way as deployLendaswapSmartWallet / deployMinimalLendaswapSmartWallet in
 * rif-relay-contracts/tasks/deployers.ts.
 */

const SERVER_WORK_DIR = './tmp/enveloping/test/lendaswap-server';
const serverPort = 8096;

const basicAppConfig: Partial<AppConfig> = {
  url: `http://localhost:${serverPort}`,
  port: serverPort,
  devMode: true,
  logLevel: 5,
  workdir: SERVER_WORK_DIR,
};

const SWAP_AMOUNT = utils.parseEther('0.5');
const FEE = utils.parseEther('0.01');

// HTLCNative.SwapState
const SWAP_REDEEMED = 2;

const REDEEM_TYPES = {
  Redeem: [
    { name: 'preimage', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'sender', type: 'address' },
    { name: 'timelock', type: 'uint256' },
    { name: 'caller', type: 'address' },
    { name: 'destination', type: 'address' },
    { name: 'sweepToken', type: 'address' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'callsHash', type: 'bytes32' },
  ],
};

type Swap = {
  preimage: string;
  preimageHash: string;
  amount: BigNumber;
  sender: string;
  claimAddress: string;
  timelock: BigNumber;
};

type Call = { target: string; value: BigNumber; callData: string };

// The HTLCNative methods the test calls (it is deployed from ./artifacts, so it has no typechain type)
type HTLCNative = Contract & {
  'create(bytes32,address,uint256)': (
    preimageHash: string,
    claimAddress: string,
    timelock: BigNumber,
    overrides: { value: BigNumber }
  ) => Promise<ContractTransaction>;
  computeKey: (
    preimageHash: string,
    amount: BigNumber,
    token: string,
    sender: string,
    claimAddress: string,
    timelock: BigNumber
  ) => Promise<string>;
  swapState: (key: string) => Promise<[number, string]>;
};

type ClaimMethod = 'redeem' | 'redeemBySig' | 'redeemAndExecute';

const CLAIM_METHODS: ClaimMethod[] = [
  'redeem',
  'redeemBySig',
  'redeemAndExecute',
];

const provider = ethers.provider;

describe('Lendaswap smart wallets through RIF Relay client and server', function () {
  let relayClient: RelayClient;
  let relayServer: RelayServer;
  let httpServer: HttpServer;
  let relayHub: RelayHub;
  let htlc: HTLCNative;
  let coordinator: Contract;
  let gaslessAccount: Wallet;
  let relayOwner: SignerWithAddress;
  let fundedAccount: SignerWithAddress;
  let lp: SignerWithAddress;
  let chainId: number;
  let originalConfig: ServerConfigParams;

  // Full wallet: BoltzSmartWallet template + Lendaswap verifiers
  let fullFactory: BoltzSmartWalletFactory;
  let fullDeployVerifier: LendaswapDeployVerifier;
  let fullRelayVerifier: LendaswapRelayVerifier;

  // Minimal wallet: MinimalSwapSmartWallet template + minimal verifiers
  let minimalFactory: MinimalBoltzSmartWalletFactory;
  let minimalDeployVerifier: MinimalLendaswapDeployVerifier;
  let minimalRelayVerifier: MinimalBoltzRelayVerifier;

  before(async function () {
    originalConfig = config.util.toObject(config) as ServerConfigParams;
    gaslessAccount = Wallet.createRandom();
    [, relayOwner, fundedAccount, lp] = (await ethers.getSigners()) as [
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress,
      SignerWithAddress
    ];
    ({ chainId } = await provider.getNetwork());

    relayHub = await deployRelayHub();
    await deployLendaswap();
    await deployFullWalletStack();
    await deployMinimalWalletStack();

    loadConfiguration({
      app: basicAppConfig,
      contracts: {
        relayHubAddress: relayHub.address,
        relayVerifierAddress: fullRelayVerifier.address,
        deployVerifierAddress: fullDeployVerifier.address,
        trustedVerifiers: [
          fullDeployVerifier.address,
          fullRelayVerifier.address,
          minimalDeployVerifier.address,
          minimalRelayVerifier.address,
        ],
      },
      blockchain: {
        workerTargetBalance: (0.6e18).toString(),
        rskNodeUrl: RSK_URL,
        gasPriceFactor: 1,
      },
    });

    relayServer = await getInitiatedServer({ relayOwner });
    httpServer = new HttpServer(serverPort, relayServer);
    httpServer.start();

    const {
      app: { url: serverUrl },
    } = getServerConfig();
    setProvider(provider);
    setEnvelopingConfig({
      preferredRelays: [serverUrl],
      chainId,
      relayHubAddress: relayHub.address,
      relayVerifierAddress: fullRelayVerifier.address,
      deployVerifierAddress: fullDeployVerifier.address,
      logLevel: 5,
    });

    relayClient = new RelayClient();
    AccountManager.getInstance().addAccount(gaslessAccount);
  });

  after(function () {
    config.util.extendDeep(config, originalConfig);
    httpServer.stop();
    httpServer.close();
  });

  it('server trusts the Lendaswap verifiers', function () {
    const { trustedVerifiers } = relayServer.verifierHandler();

    for (const verifier of [
      fullDeployVerifier,
      fullRelayVerifier,
      minimalDeployVerifier,
      minimalRelayVerifier,
    ]) {
      expect(trustedVerifiers).to.include(verifier.address.toLowerCase());
    }
  });

  describe('full wallet (BoltzSmartWallet + Lendaswap verifiers)', function () {
    describe('deploy + claim', function () {
      for (const method of CLAIM_METHODS) {
        it(`with ${method}, paying the fee from the claimed RBTC`, async function () {
          const index = randomIndex();
          const wallet = await fullFactory.getSmartWalletAddress(
            gaslessAccount.address,
            constants.AddressZero,
            index
          );

          await deployAndClaim({
            factory: fullFactory,
            verifier: fullDeployVerifier,
            wallet,
            index,
            method,
          });
        });
      }

      it('estimates the deploy through the server', async function () {
        const index = randomIndex();
        const wallet = await fullFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          index
        );
        const { to, data, swap } = await prepareClaim(
          'redeemAndExecute',
          wallet
        );

        const estimation = await relayClient.estimateRelayTransaction(
          deployRequest(fullFactory, fullDeployVerifier, index, to, data, 0)
        );

        expect(BigNumber.from(estimation.requiredNativeAmount).gt(0)).to.be
          .true;
        expect(BigNumber.from(estimation.requiredNativeAmount).lt(swap.amount))
          .to.be.true;
      });
    });

    describe('relay from an existing wallet with no RBTC', function () {
      let wallet: string;

      before(async function () {
        const index = randomIndex();
        wallet = await fullFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          index
        );
        await deployAndClaim({
          factory: fullFactory,
          verifier: fullDeployVerifier,
          wallet,
          index,
          method: 'redeemAndExecute',
        });
      });

      for (const method of CLAIM_METHODS) {
        it(`with ${method}`, async function () {
          expect(await provider.getBalance(wallet)).to.be.equal(0);

          const { to, data, swap } = await prepareClaim(method, wallet);
          const userBefore = await provider.getBalance(gaslessAccount.address);

          const receipt = await relay(relayRequest(wallet, to, data, FEE));

          const hub = RelayHub__factory.createInterface();
          const events = receipt.logs
            .filter((log) => log.address === relayHub.address)
            .map((log) => hub.parseLog(log).name);
          expect(events).to.include('TransactionRelayed');

          await assertClaimed(swap, userBefore);
          expect(await provider.getBalance(wallet)).to.be.equal(0);
        });
      }
    });
  });

  describe('minimal wallet (MinimalSwapSmartWallet + minimal verifiers)', function () {
    describe('deploy + claim', function () {
      for (const method of CLAIM_METHODS) {
        it(`with ${method}, paying the fee from the claimed RBTC`, async function () {
          const index = randomIndex();
          const wallet = await minimalFactory.getSmartWalletAddress(
            gaslessAccount.address,
            constants.AddressZero,
            index
          );

          await deployAndClaim({
            factory: minimalFactory,
            verifier: minimalDeployVerifier,
            wallet,
            index,
            method,
          });
        });
      }
    });
  });

  describe('estimation accuracy (estimated gas limit vs gas used)', function () {
    const rows: Array<Record<string, string | number>> = [];

    after(function () {
      console.table(rows);
    });

    describe('first claim of a brand-new user', function () {
      let existingAccount: Wallet;

      before(function () {
        existingAccount = gaslessAccount;
        gaslessAccount = Wallet.createRandom();
        AccountManager.getInstance().addAccount(gaslessAccount);
      });

      after(function () {
        gaslessAccount = existingAccount;
      });

      it('full wallet: deploy + redeemAndExecute', async function () {
        const index = randomIndex();
        const wallet = await fullFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          index
        );
        const { to, data } = await prepareClaim('redeemAndExecute', wallet);

        await measure(
          'NEW USER full deploy + redeemAndExecute',
          (tokenAmount) =>
            deployRequest(
              fullFactory,
              fullDeployVerifier,
              index,
              to,
              data,
              tokenAmount
            )
        );
      });
    });

    for (const flavour of ['full', 'minimal'] as const) {
      for (const method of CLAIM_METHODS) {
        it(`${flavour} wallet: deploy + ${method}`, async function () {
          const factory = flavour === 'full' ? fullFactory : minimalFactory;
          const verifier =
            flavour === 'full' ? fullDeployVerifier : minimalDeployVerifier;
          const index = randomIndex();
          const wallet = await factory.getSmartWalletAddress(
            gaslessAccount.address,
            constants.AddressZero,
            index
          );
          const { to, data } = await prepareClaim(method, wallet);

          await measure(`${flavour} deploy + ${method}`, (tokenAmount) =>
            deployRequest(factory, verifier, index, to, data, tokenAmount)
          );
        });
      }
    }

    describe('full wallet: relay', function () {
      let wallet: string;

      before(async function () {
        const index = randomIndex();
        wallet = await fullFactory.getSmartWalletAddress(
          gaslessAccount.address,
          constants.AddressZero,
          index
        );
        await deployAndClaim({
          factory: fullFactory,
          verifier: fullDeployVerifier,
          wallet,
          index,
          method: 'redeemAndExecute',
        });
      });

      for (const method of CLAIM_METHODS) {
        it(`relay + ${method}`, async function () {
          const { to, data } = await prepareClaim(method, wallet);

          await measure(`full relay + ${method}`, (tokenAmount) =>
            relayRequest(wallet, to, data, tokenAmount)
          );
        });
      }
    });

    /**
     * Estimates with the client's two estimators (both need tokenAmount 0), then
     * relays the real request (tokenAmount = FEE) and compares with its gasUsed.
     */
    async function measure(
      flow: string,
      build: (tokenAmount: BigNumber | number) => UserDefinedEnvelopingRequest
    ) {
      const hubInfo = relayServer.getChainInfo();
      const estimationTx = await createEnvelopingTxRequest(
        build(0),
        relayClient,
        hubInfo
      );
      const withSignature = await estimateRelayMaxPossibleGas(
        estimationTx,
        hubInfo.relayWorkerAddress
      );
      const workerWallet =
        relayServer.transactionManager.workersKeyManager.getWallet(
          hubInfo.relayWorkerAddress
        );
      const noSignature = await estimateRelayMaxPossibleGasNoSignature(
        estimationTx.relayRequest,
        workerWallet
      );
      const { gasUsed } = await relay(build(FEE));

      const margin = (estimate: BigNumber) =>
        Number(estimate.sub(gasUsed).mul(1000).div(gasUsed)) / 10;
      rows.push({
        flow,
        gasUsed: gasUsed.toNumber(),
        withSignature: withSignature.toNumber(),
        'withSignature margin %': margin(withSignature),
        noSignature: noSignature.toNumber(),
        'noSignature margin %': margin(noSignature),
      });

      expect(withSignature.gte(gasUsed), 'signed estimate below gas used').to.be
        .true;
      expect(noSignature.gte(gasUsed), 'unsigned estimate below gas used').to.be
        .true;
    }
  });

  // ---------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------

  async function deployLendaswap() {
    const htlcFactory = new ethers.ContractFactory(
      HTLCNativeJson.abi,
      HTLCNativeJson.bytecode,
      fundedAccount
    );
    htlc = (await htlcFactory.deploy(fundedAccount.address)) as HTLCNative;
    await htlc.deployed();

    const coordinatorFactory = new ethers.ContractFactory(
      HTLCNativeCoordinatorJson.abi,
      HTLCNativeCoordinatorJson.bytecode,
      fundedAccount
    );
    coordinator = await coordinatorFactory.deploy(htlc.address);
    await coordinator.deployed();
  }

  async function deployFullWalletStack() {
    const template = await deployContract<BoltzSmartWallet>('BoltzSmartWallet');
    fullFactory = await createSmartWalletFactory(
      template,
      fundedAccount,
      'Boltz'
    );

    fullDeployVerifier = await (
      await ethers.getContractFactory('LendaswapDeployVerifier')
    ).deploy(fullFactory.address);
    fullRelayVerifier = await (
      await ethers.getContractFactory('LendaswapRelayVerifier')
    ).deploy(fullFactory.address);

    for (const verifier of [fullDeployVerifier, fullRelayVerifier]) {
      await (await verifier.acceptContract(htlc.address)).wait();
      await (await verifier.acceptContract(coordinator.address)).wait();
    }
  }

  async function deployMinimalWalletStack() {
    // Same list as LENDASWAP_REDEEM_METHODS in rif-relay-contracts/tasks/deployers.ts
    const allowedMethods = [
      htlc.interface.getSighash('redeem'),
      htlc.interface.getSighash('redeemBySig'),
      coordinator.interface.getSighash('redeemAndExecute'),
    ];
    const template = await (
      await ethers.getContractFactory('MinimalSwapSmartWallet')
    ).deploy(allowedMethods);

    minimalFactory = await (
      await ethers.getContractFactory('MinimalBoltzSmartWalletFactory')
    )
      .connect(fundedAccount)
      .deploy(template.address);

    minimalDeployVerifier = await (
      await ethers.getContractFactory('MinimalLendaswapDeployVerifier')
    ).deploy(minimalFactory.address);
    minimalRelayVerifier = await (
      await ethers.getContractFactory('MinimalBoltzRelayVerifier')
    ).deploy(minimalFactory.address);

    await (await minimalDeployVerifier.acceptContract(htlc.address)).wait();
    await (
      await minimalDeployVerifier.acceptContract(coordinator.address)
    ).wait();
  }

  // ---------------------------------------------------------------------
  // Flows
  // ---------------------------------------------------------------------

  async function deployAndClaim({
    factory,
    verifier,
    wallet,
    index,
    method,
  }: {
    factory: Contract;
    verifier: Contract;
    wallet: string;
    index: number;
    method: ClaimMethod;
  }) {
    const { to, data, swap } = await prepareClaim(method, wallet);
    const userBefore = await provider.getBalance(gaslessAccount.address);

    const receipt = await relay(
      deployRequest(factory, verifier, index, to, data, FEE)
    );

    const deployed = receipt.logs
      .filter((log) => log.address === factory.address)
      .map((log) => factory.interface.parseLog(log))
      .find((event) => event.name === 'Deployed');
    expect(deployed?.args['addr']).to.be.equal(wallet);
    expect(await provider.getCode(wallet)).to.not.be.equal('0x');

    await assertClaimed(swap, userBefore);
  }

  /**
   * Locks a swap and builds the claim call for `wallet`:
   * - redeem: the wallet is the claimAddress
   * - redeemBySig: the user EOA is the claimAddress and authorizes the wallet as caller
   * - redeemAndExecute: the user authorizes the coordinator, which sweeps to the wallet
   */
  async function prepareClaim(method: ClaimMethod, wallet: string) {
    if (method === 'redeem') {
      const swap = await lockSwap(wallet);

      return {
        swap,
        to: htlc.address,
        data: htlc.interface.encodeFunctionData('redeem', [
          swap.preimage,
          swap.amount,
          swap.sender,
          swap.timelock,
        ]),
      };
    }

    const swap = await lockSwap(gaslessAccount.address);

    if (method === 'redeemBySig') {
      const sig = await signRedeem(swap, {
        caller: wallet,
        destination: wallet,
        sweepToken: constants.AddressZero,
        minAmountOut: constants.Zero,
        callsHash: constants.HashZero,
      });

      return {
        swap,
        to: htlc.address,
        data: htlc.interface.encodeFunctionData('redeemBySig', [
          swap.preimage,
          swap.amount,
          swap.sender,
          swap.timelock,
          wallet,
          constants.AddressZero,
          0,
          constants.HashZero,
          sig.v,
          sig.r,
          sig.s,
        ]),
      };
    }

    const calls: Call[] = [];
    const sig = await signRedeem(swap, {
      caller: coordinator.address,
      destination: wallet,
      sweepToken: constants.AddressZero,
      minAmountOut: swap.amount,
      callsHash: callsHash(calls),
    });

    return {
      swap,
      to: coordinator.address,
      data: coordinator.interface.encodeFunctionData('redeemAndExecute', [
        swap.preimage,
        swap.amount,
        swap.sender,
        swap.timelock,
        calls,
        constants.AddressZero,
        swap.amount,
        wallet,
        sig.v,
        sig.r,
        sig.s,
      ]),
    };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function deployRequest(
    factory: Contract,
    verifier: Contract,
    index: number,
    to: string,
    data: string,
    tokenAmount: BigNumber | number
  ): UserDefinedDeployRequest {
    return {
      request: {
        from: gaslessAccount.address,
        to,
        data,
        tokenContract: constants.AddressZero,
        tokenAmount,
        index,
      },
      relayData: {
        callForwarder: factory.address,
        callVerifier: verifier.address,
      },
    };
  }

  function relayRequest(
    wallet: string,
    to: string,
    data: string,
    tokenAmount: BigNumber | number
  ): UserDefinedRelayRequest {
    return {
      request: {
        from: gaslessAccount.address,
        to,
        data,
        tokenContract: constants.AddressZero,
        tokenAmount,
      },
      relayData: {
        callForwarder: wallet,
        callVerifier: fullRelayVerifier.address,
      },
    };
  }

  async function relay(request: UserDefinedEnvelopingRequest) {
    const { hash } = await relayClient.relayTransaction(request);
    const receipt = await provider.waitForTransaction(hash as string);
    expect(receipt.status, 'relayed transaction reverted').to.be.equal(1);

    return receipt;
  }

  async function lockSwap(claimAddress: string): Promise<Swap> {
    const preimage = utils.hexlify(utils.randomBytes(32));
    const preimageHash = utils.sha256(preimage);
    const { timestamp } = await provider.getBlock('latest');
    const timelock = BigNumber.from(timestamp + 24 * 60 * 60);

    const tx = await (htlc.connect(lp) as HTLCNative)[
      'create(bytes32,address,uint256)'
    ](preimageHash, claimAddress, timelock, { value: SWAP_AMOUNT });
    await tx.wait();

    return {
      preimage,
      preimageHash,
      amount: SWAP_AMOUNT,
      sender: lp.address,
      claimAddress,
      timelock,
    };
  }

  async function signRedeem(
    swap: Swap,
    auth: {
      caller: string;
      destination: string;
      sweepToken: string;
      minAmountOut: BigNumber;
      callsHash: string;
    }
  ) {
    const signature = await gaslessAccount._signTypedData(
      {
        name: 'HTLCNative',
        version: '1',
        chainId,
        verifyingContract: htlc.address,
      },
      REDEEM_TYPES,
      {
        preimage: swap.preimage,
        amount: swap.amount,
        sender: swap.sender,
        timelock: swap.timelock,
        ...auth,
      }
    );

    return utils.splitSignature(signature);
  }

  function callsHash(calls: Call[]) {
    return utils.keccak256(
      utils.defaultAbiCoder.encode(
        ['tuple(address target, uint256 value, bytes callData)[]'],
        [calls]
      )
    );
  }

  async function assertClaimed(swap: Swap, userBefore: BigNumber) {
    const key = await htlc.computeKey(
      swap.preimageHash,
      swap.amount,
      constants.AddressZero,
      swap.sender,
      swap.claimAddress,
      swap.timelock
    );
    const [state, preimage] = await htlc.swapState(key);

    expect(state).to.be.equal(SWAP_REDEEMED);
    expect(preimage).to.be.equal(swap.preimage);
    expect(
      (await provider.getBalance(gaslessAccount.address)).sub(userBefore)
    ).to.be.equal(swap.amount.sub(FEE));
  }
});

function randomIndex() {
  return Math.floor(Math.random() * 1_000_000_000);
}

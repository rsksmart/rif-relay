import { Event as SolidityEvent, ContractTransaction } from 'ethers';
import { Result as SolidityEventArg } from '@ethersproject/abi';
import { ethers as hardhat } from 'hardhat';
import { NonRevertTestToken, TestToken, TetherToken } from 'typechain-types';

const INITIAL_SMART_WALLET_TOKEN_AMOUNT = 100;

const TEST_TOKEN_NAME = 'TestToken';
const NON_REVERT_TEST_TOKEN_NAME = 'NonRevertTestToken';
const TETHER_TOKEN_NAME = 'TetherToken';

type TokenName =
  | typeof TEST_TOKEN_NAME
  | typeof NON_REVERT_TEST_TOKEN_NAME
  | typeof TETHER_TOKEN_NAME;
type TokenToTest = TestToken | NonRevertTestToken | TetherToken;

async function getLogArguments(contractTransaction: ContractTransaction) {
  const receipt = await contractTransaction.wait();

  // console.log(receipt);

  const eventResult = receipt.events?.find((event) => event.event == 'Result');

  const { args } = eventResult as SolidityEvent;

  const { success, error } = args as SolidityEventArg;
  const successArgument = success as boolean;
  const errorArgument = error as string;

  return { successArgument, errorArgument };
}

async function mintTokens(
  token: TokenToTest,
  tokenName: TokenName,
  amount: number,
  recipient: string
) {
  if (tokenName === TETHER_TOKEN_NAME) {
    await (token as TetherToken).issue(amount);
    await (token as TetherToken).transfer(recipient, amount);
  } else {
    await (token as TestToken | NonRevertTestToken).mint(
      INITIAL_SMART_WALLET_TOKEN_AMOUNT,
      recipient
    );
  }
}

async function prepareToken(tokenName: TokenName) {
  let token: TokenToTest;
  const tokenFactory = await hardhat.getContractFactory(`${tokenName}`);

  switch (tokenName) {
    case NON_REVERT_TEST_TOKEN_NAME:
      token = (await tokenFactory.deploy()) as NonRevertTestToken;
      break;
    case TEST_TOKEN_NAME:
      token = (await tokenFactory.deploy()) as TestToken;
      break;
    case TETHER_TOKEN_NAME:
      token = (await tokenFactory.deploy(
        5000,
        TETHER_TOKEN_NAME,
        'TET',
        18
      )) as TetherToken;
      break;
    default:
      throw new Error('Unknown token name');
  }

  return token;
}

export {
  getLogArguments,
  mintTokens,
  prepareToken,
  TEST_TOKEN_NAME,
  NON_REVERT_TEST_TOKEN_NAME,
  TETHER_TOKEN_NAME,
  INITIAL_SMART_WALLET_TOKEN_AMOUNT,
};

export type { TokenToTest, TokenName };

import { expect } from "chai";
import { ethers } from "hardhat";
import { CustomSmartWallet__factory, IForwarder, TestForwarderTarget, UtilToken } from "../../typechain-types";
import {
    createSmartWalletFactory,
    createSmartWallet,
    signEnvelopingRequest,
} from '../TestUtils';
import { BigNumber, constants } from "ethers";
import { EnvelopingTypes } from "@rsksmart/rif-relay-contracts";
import { CustomSmartWalletInterface } from "typechain-types/@rsksmart/rif-relay-contracts/contracts/smartwallet/CustomSmartWallet";
import { LogDescription } from "ethers/lib/utils";

async function fillTokens(
    token: UtilToken,
    recipient: string,
    amount: string
): Promise<void> {
    await token.mint(amount, recipient);
}

async function getTokenBalance(
    token: UtilToken,
    account: string
): Promise<BigNumber> {
    return token.balanceOf(account);
}

function createRequest(
    request: Partial<IForwarder.ForwardRequestStruct>,
    relayData: Partial<EnvelopingTypes.RelayDataStruct>
): EnvelopingTypes.RelayRequestStruct {
    const baseRequest: EnvelopingTypes.RelayRequestStruct = {
        request: {
            relayHub: constants.AddressZero,
            from: constants.AddressZero,
            to: constants.AddressZero,
            value: '0',
            gas: '1000000',
            nonce: '0',
            data: '0x',
            tokenContract: constants.AddressZero,
            tokenAmount: '1',
            tokenGas: '50000',
            validUntilTime: '0'
        },
        relayData: {
            gasPrice: '1',
            feesReceiver: constants.AddressZero,
            callForwarder: constants.AddressZero,
            callVerifier: constants.AddressZero
        }
    };

    return {
        request: {
            ...baseRequest.request,
            ...request
        },
        relayData: {
            ...baseRequest.relayData,
            ...relayData
        }
    };
}

describe("Custom Smart Wallet using TestToken", function () {

    describe("#verifyAndCall", function(){
        
        let recipient: TestForwarderTarget;
        let recipientFunction: string;

        beforeEach(async function(){
            const testForwarderTargetFactory = await ethers.getContractFactory('TestForwarderTarget');
            recipient = await testForwarderTargetFactory.deploy();
            recipientFunction = recipient.interface.encodeFunctionData('emitMessage', ['hello']);
        });

        it('should call function with custom logic', async function() {
            const successCustomLogicFactory = await ethers.getContractFactory('SuccessCustomLogic');
            const customLogic = await successCustomLogicFactory.deploy();

            const customSmartWalletFactory = await ethers.getContractFactory('CustomSmartWallet');
            const template = await customSmartWalletFactory.deploy();

            const factory = await createSmartWalletFactory(template, true);

            const [otherAccount, worker] = await ethers.getSigners();
            const wallet = ethers.Wallet.createRandom();


            const smartWallet = await createSmartWallet(
                otherAccount?.address as string,
                wallet.address,
                factory,
                wallet,
                undefined,
                undefined,
                undefined,
                undefined,
                0,
                0,
                customLogic.address,
            );

            const utilTokenFactory = await ethers.getContractFactory('UtilToken');
            const token = await utilTokenFactory.deploy();

            await fillTokens(token, smartWallet.address, '1000');
            const relayData = {
                callForwarder: smartWallet.address
            };

            const initialWorkerTokenBalance = await getTokenBalance(
                token,
                worker?.address as string
            );
            const initialSWalletTokenBalance = await getTokenBalance(
                token,
                smartWallet.address
            );
            const initialNonce = await smartWallet.nonce();

            const relayRequest = createRequest(
                {
                    data: recipientFunction,
                    to: recipient.address,
                    nonce: initialNonce.toString(),
                    relayHub: worker?.address,
                    tokenContract: token.address,
                    from: wallet.address
                },
                relayData
            );
            const { signature, suffixData } = await signEnvelopingRequest(
                relayRequest,
                wallet
            );

            const result = await smartWallet.execute(
                suffixData,
                relayRequest.request,
                worker?.address as string,
                signature,
                {
                    from: worker?.address as string
                }
            );

            const transactionRecept = await result.wait();
            
            const customSWInterface: CustomSmartWalletInterface = CustomSmartWallet__factory.createInterface();
            const parsedLogs: LogDescription[] = transactionRecept.logs.map((log) =>
                customSWInterface.parseLog(log)
            );

            const logDescription = parsedLogs.find((log) => log.name == 'LogicCalled');
            expect(logDescription, 'Should call custom logic').length.at.least(1);

            const tknBalance = await getTokenBalance(token, worker?.address as string);
            const swTknBalance = await getTokenBalance(
                token,
                smartWallet.address
            );

            expect(tknBalance.sub(initialWorkerTokenBalance), 'Incorrect new worker token balance').to.equal(BigNumber.from(1));
            expect(
                initialSWalletTokenBalance.sub(swTknBalance).toString(), 
                'Incorrect new smart wallet token balance'
            ).to.equal(BigNumber.from(1));

            expect(
                await smartWallet.nonce(), 
                'verifyAndCall should increment nonce'
            ).to.equal(
                initialNonce.add(BigNumber.from(1)),
            );
        });

        it("should call function from custom logic with wallet's address", async function() {
            const successCustomLogicFactory = await ethers.getContractFactory('ProxyCustomLogic');
            const customLogic = await successCustomLogicFactory.deploy();

            const customSmartWalletFactory = await ethers.getContractFactory('CustomSmartWallet');
            const template = await customSmartWalletFactory.deploy();

            const factory = await createSmartWalletFactory(template, true);

            const [otherAccount, worker] = await ethers.getSigners();
            const wallet = ethers.Wallet.createRandom();


            const smartWallet = await createSmartWallet(
                otherAccount?.address as string,
                wallet.address,
                factory,
                wallet,
                undefined,
                undefined,
                undefined,
                undefined,
                0,
                0,
                customLogic.address,
            );

            const utilTokenFactory = await ethers.getContractFactory('UtilToken');
            const token = await utilTokenFactory.deploy();

            await fillTokens(token, smartWallet.address, '1000');
            const relayData = {
                callForwarder: smartWallet.address
            };

            const initialWorkerTokenBalance = await getTokenBalance(
                token,
                worker?.address as string
            );
            const initialSWalletTokenBalance = await getTokenBalance(
                token,
                smartWallet.address
            );
            const initialNonce = await smartWallet.nonce();

            const relayRequest = createRequest(
                {
                    data: recipientFunction,
                    to: recipient.address,
                    nonce: initialNonce.toString(),
                    relayHub: worker?.address,
                    tokenContract: token.address,
                    from: wallet.address
                },
                relayData
            );
            const { signature, suffixData } = await signEnvelopingRequest(
                relayRequest,
                wallet
            );

            const result = await smartWallet.execute(
                suffixData,
                relayRequest.request,
                worker?.address as string,
                signature,
                {
                    from: worker?.address as string
                }
            );

            const transactionRecept = await result.wait();
            
            const customSWInterface: CustomSmartWalletInterface = CustomSmartWallet__factory.createInterface();
            const parsedLogs: LogDescription[] = transactionRecept.logs.map((log) =>
                customSWInterface.parseLog(log)
            );

            const logDescription = parsedLogs.find((log) => log.name == 'LogicCalled');
            expect(logDescription, 'Should call custom logic').length.at.least(1);

            const eventFilter = recipient.filters.TestForwarderMessage();
            const logs = await recipient.queryFilter(eventFilter)

            expect(logs.length, 'TestRecipient should emit').to.equal(1);
            expect(
                logs[0]!.args.origin,
                'test "from" account is the tx.origin'
            ).to.equal(worker);
            expect(
                logs[0]!.args.msgSender,
                'msg.sender must be the smart wallet address'
            ).to.equal(smartWallet.address);

            const tknBalance = await getTokenBalance(token, worker?.address as string);
            const swTknBalance = await getTokenBalance(
                token,
                smartWallet.address
            );

            expect(tknBalance.sub(initialWorkerTokenBalance), 'Incorrect new worker token balance').to.equal(BigNumber.from(1));
            expect(
                initialSWalletTokenBalance.sub(swTknBalance).toString(), 
                'Incorrect new smart wallet token balance'
            ).to.equal(BigNumber.from(1));

            expect(
                await smartWallet.nonce(), 
                'verifyAndCall should increment nonce'
            ).to.equal(
                initialNonce.add(BigNumber.from(1)),
            );
        });

        /*it("should revert if logic revert", async function() {
            const failureCustomLogicFactory = await ethers.getContractFactory('FailureCustomLogic');
            const customLogic = await failureCustomLogicFactory.deploy();

            const customSmartWalletFactory = await ethers.getContractFactory('CustomSmartWallet');
            const template = await customSmartWalletFactory.deploy();

            const factory = await createSmartWalletFactory(template, true);

            const [otherAccount, worker] = await ethers.getSigners();
            const wallet = ethers.Wallet.createRandom();


            const smartWallet = await createSmartWallet(
                otherAccount?.address as string,
                wallet.address,
                factory,
                wallet,
                undefined,
                undefined,
                undefined,
                undefined,
                0,
                0,
                customLogic.address,
            );

            const utilTokenFactory = await ethers.getContractFactory('UtilToken');
            const token = await utilTokenFactory.deploy();

            await fillTokens(token, smartWallet.address, '1000');
            const relayData = {
                callForwarder: smartWallet.address
            };

            const initialWorkerTokenBalance = await getTokenBalance(
                token,
                worker?.address as string
            );
            const initialSWalletTokenBalance = await getTokenBalance(
                token,
                smartWallet.address
            );
            const initialNonce = await smartWallet.nonce();

            const relayRequest = createRequest(
                {
                    data: recipientFunction,
                    to: recipient.address,
                    nonce: initialNonce.toString(),
                    relayHub: worker?.address,
                    tokenContract: token.address,
                    from: wallet.address
                },
                relayData
            );
            const { signature, suffixData } = await signEnvelopingRequest(
                relayRequest,
                wallet
            );

            const result = await smartWallet.execute(
                suffixData,
                relayRequest.request,
                worker?.address as string,
                signature,
                {
                    from: worker?.address as string
                }
            );

            const transactionRecept = await result.wait();
            
            const customSWInterface: CustomSmartWalletInterface = CustomSmartWallet__factory.createInterface();
            const parsedLogs: LogDescription[] = transactionRecept.logs.map((log) =>
                customSWInterface.parseLog(log)
            );

            const logDescription = parsedLogs.find((log) => log.name == 'LogicCalled');
            expect(logDescription, 'Should call custom logic').length.at.least(1);

            const eventFilter = recipient.filters.TestForwarderMessage();
            const logs = await recipient.queryFilter(eventFilter)

            expect(logs.length, 'TestRecipient should emit').to.equal(1);
            expect(
                logs[0]!.args.origin,
                'test "from" account is the tx.origin'
            ).to.equal(worker);
            expect(
                logs[0]!.args.msgSender,
                'msg.sender must be the smart wallet address'
            ).to.equal(smartWallet.address);

            const tknBalance = await getTokenBalance(token, worker?.address as string);
            const swTknBalance = await getTokenBalance(
                token,
                smartWallet.address
            );

            expect(tknBalance.sub(initialWorkerTokenBalance), 'Incorrect new worker token balance').to.equal(BigNumber.from(1));
            expect(
                initialSWalletTokenBalance.sub(swTknBalance).toString(), 
                'Incorrect new smart wallet token balance'
            ).to.equal(BigNumber.from(1));

            expect(
                await smartWallet.nonce(), 
                'verifyAndCall should increment nonce'
            ).to.equal(
                initialNonce.add(BigNumber.from(1)),
            );
        });*/
    });
});

import { RelayClient, configure } from '@rsksmart/rif-relay-client';
import { HttpProvider } from 'web3-core';
import {
    ProfilingProvider,
    ContractInteractor,
    constants,
    isRsk,
    Environment
} from '@rsksmart/rif-relay-common';
import { PrefixedHexString } from 'ethereumjs-tx';
import Transaction from 'ethereumjs-tx/dist/transaction';
import { getTestingEnvironment } from '../TestUtils';

contract('ContractInteractor', function () {
    // TODO: these tests create an entire instance of the client to test one method.
    context('#_validateCompatibility()', function () {
        it('should not throw if the hub address is not configured', async function () {
            const relayClient = new RelayClient(
                web3.currentProvider as HttpProvider,
                { logLevel: 5 }
            );
            await relayClient._init();
        });
    });

    context('#broadcastTransaction()', function () {
        let provider: ProfilingProvider;
        let contractInteractor: ContractInteractor;
        let sampleTransactionHash: PrefixedHexString;
        let sampleTransactionData: PrefixedHexString;

        before(async function () {
            const env: Environment = await getTestingEnvironment();
            let pk =
                '46e6ef4a356fa3fa3929bf4b59e6b3eb9d0521ea660fd2879c67bd501002ac2b';
            let address = '0xb473D6BE09D0d6a23e1832046dBE258cF6E8635B';
            let gasPrice = 0;
            let txOpts = {};

            if (isRsk(env)) {
                pk =
                    'c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4';
                address = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826';
                gasPrice = 1;
                txOpts = { chainId: env.chainId };
            }

            provider = new ProfilingProvider(
                web3.currentProvider as HttpProvider
            );
            contractInteractor = new ContractInteractor(
                provider,
                configure({})
            );
            const nonce = await web3.eth.getTransactionCount(address);

            const transaction = new Transaction(
                {
                    to: constants.ZERO_ADDRESS,
                    gasLimit: '0x5208',
                    gasPrice,
                    nonce
                },
                txOpts
            );

            transaction.sign(Buffer.from(pk, 'hex'));
            sampleTransactionData =
                '0x' + transaction.serialize().toString('hex');
            sampleTransactionHash =
                '0x' + transaction.hash(true).toString('hex');
        });

        it('should sent the transaction to the blockchain directly', async function () {
            const txHash = await contractInteractor.broadcastTransaction(
                sampleTransactionData
            );
            assert.equal(txHash, sampleTransactionHash);
            assert.equal(provider.methodsCount.size, 1);
            assert.equal(
                provider.methodsCount.get('eth_sendRawTransaction'),
                1
            );
        });
    });
});

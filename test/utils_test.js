const ethUtils = require('ethereumjs-util');
const ethWallet = require('ethereumjs-wallet');
const utils = require('../src/js/relayclient/utils');
const testutils = require('./testutils');

const NUMBER_OF_SIGNATURES_TO_TRY = 600;

describe("utilities", () => {
    it('sanitizes ' + NUMBER_OF_SIGNATURES_TO_TRY + ' signatures', async function() {
        this.timeout(10000);

        const hash = web3.utils.sha3('test string');

        // Truffle requires a '0x' prefix whereas RSK doesn't allow for one
        const privateKeyPrefix = (await testutils.isRsk()) ? '' : '0x'

        for (let i = 0; i < NUMBER_OF_SIGNATURES_TO_TRY; i++) {
            const account = ethWallet.generate();
            privateKey = privateKeyPrefix + account.privKey.toString('hex');

            const address = await web3.eth.personal.importRawKey(privateKey, 'password');
            await web3.eth.personal.unlockAccount(address, 'password');

            sig = await web3.eth.sign(hash, address);

            // This would throw an exception in case anything goes wrong
            ethUtils.fromRpcSig(utils.sanitizeJsonRpcSignature(sig, hash, address, web3));
        }
    });
})

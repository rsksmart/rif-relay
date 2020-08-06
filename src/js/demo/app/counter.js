const Web3 = require('web3');
const RelayProvider = require('../../relayclient/RelayProvider');
const Contract = require('truffle-contract');
const counterABI = require('./counter-abi');

const Counter = function(url, address) {
    this.client = new Web3(url);
    this.address = address;
    this.client.setProvider(new RelayProvider(this.client.currentProvider, {}));
    this.contract = Contract({
        abi: counterABI
    });
    this.contract.setProvider(this.client.currentProvider);
};

Counter.prototype.ensureContractInstance = async function() {
    if (this.contractInstance == null) {
        this.contractInstance = await this.contract.at(this.address);
    }
};

Counter.prototype.getCount = async function(account) {
    await this.ensureContractInstance();
    return await this.contractInstance.get({ from: account.address });
};

Counter.prototype.increment = async function(account) {
    await this.ensureContractInstance();
    this.client.currentProvider.relayClient.useKeypairForSigning(account);
    // gasPrice in null will make the RelayClient choose a gasPrice dependant on
    // the current network gas price
    return await this.contractInstance.increment({ from: account.address, gasPrice: null });
};

module.exports = {
    Counter,
};

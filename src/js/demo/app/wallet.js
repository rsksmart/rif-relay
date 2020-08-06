const ethWallet = require('ethereumjs-wallet');

const Wallet = function(store) {
    this.store = store;
    this.accounts = [];
    this.load();
};

Wallet.prototype.load = function() {
    try {
        const walletData = this.store.load();
        if (walletData != null) {
            this.accounts = JSON.parse(walletData).map(acc => ({
                address: acc.address,
                privateKey: Buffer.from(acc.privateKey, 'hex'),
            }));
        }
    } catch (e) {
        this.accounts = []
        this.save();
    }
};

Wallet.prototype.save = function() {
    const walletData = JSON.stringify(this.accounts.map(acc => ({
        address: acc.address,
        privateKey: acc.privateKey.toString('hex'),
    })));
    this.store.save(walletData);
};

Wallet.prototype.newAccount = function() {
    let keyPair = ethWallet.generate();
    const account = {
        privateKey: keyPair.privKey,
        address: "0x" + keyPair.getAddress().toString('hex')
    };
    this.accounts.push(account);
    this.save();
    return account;
};

Wallet.prototype.get = function(identifier) {
    if (typeof identifier === 'number') {
        return this.accounts[identifier];
    }

    if (typeof identifier === 'string') {
        return this.accounts.find(a => a.address === identifier);
    }
};

Wallet.prototype.getCount = function() {
    return this.accounts.length;
};

Wallet.prototype.reset = function() {
    this.accounts = [];
    this.save();
}

module.exports = {
    Wallet,
};

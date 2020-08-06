const $ = require('jquery');
const Cookie = require('js-cookie');
const { Counter } = require('./counter');
const { Wallet } = require('./wallet');
const { rpcHost, contractAddress } = require('./config.json');

let counter;
let wallet;
let incrementing = false;

const initializeWallet = function() {
    const store = {
        load: () => Cookie.get('wallet'),
        save: (data) => Cookie.set('wallet', data),
    }
    wallet = new Wallet(store);
}

const disable = (row) => {
    $('.counter-row-refresh', row).attr('disabled', true);
    $('.counter-row-increment', row).attr('disabled', true);
    $('.counter-row-count .count', row).css('display', 'none');
    $('.counter-row-count .loading', row).css('display', '');
};

const enable = (row) => {
    $('.counter-row-count .count', row).css('display', '');
    $('.counter-row-count .loading', row).css('display', 'none');
    $('.counter-row-refresh', row).attr('disabled', false);
    $('.counter-row-increment', row).attr('disabled', incrementing);
};

const setIncrementsEnabled = (enabled) => {
    $('.counter-row-increment').attr('disabled', !enabled);
};

const refresh = async (account, row, quiet) => {
    !quiet && disable(row);

    const count = await counter.getCount(account);
    $('.counter-row-count .count', row).text(count);

    !quiet && enable(row);
};

const increment = async (account, row) => {
    disable(row);
    setIncrementsEnabled(false);

    incrementing = true;
    try {
        await counter.increment(account);
    } catch (e) {
        console.log('ERROR TRYING TO INCREMENT', e);
    }
    await refresh(account, row, true);
    incrementing = false;

    enable(row);
    setIncrementsEnabled(true);
};

const renderAccount = (account) => {
    const newRow = $('.counter-row-template').clone();
    newRow.removeClass('counter-row-template').addClass('counter-row');
    newRow.css('display', '');
    $('.counter-row-address', newRow).text(account.address);
    $('.counter-row-refresh', newRow).click(() => refresh(account, newRow));
    $('.counter-row-increment', newRow).click(() => increment(account, newRow));
    $('.counters-body').append(newRow);
    // This is asynchronous, but we don't want to wait, otherwise we'll stall
    // other potentially rendering accounts
    refresh(account, newRow);
};

const newAccount = () => {
    renderAccount(wallet.newAccount());
};

const resetAccounts = () => {
    wallet.reset();
    $('.counters-body').empty();
};

$(async () => {
    $('.rpc-host').text(rpcHost);
    $('.contract-address').text(contractAddress);
    counter = new Counter(rpcHost, contractAddress);
    initializeWallet();

    for (let i = 0; i < wallet.getCount(); i++) {
        await renderAccount(wallet.get(i));
    }

    $('.btn-new-account').click(newAccount);
    $('.btn-reset-accounts').click(resetAccounts);
});

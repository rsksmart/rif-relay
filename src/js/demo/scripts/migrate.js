const truffleConfig = require('../../../../truffle.js');
var fs = require('fs');
var RelayHub = artifacts.require("./RelayHub.sol");
var Counter = artifacts.require("./Counter.sol");

const CONFIG_PATH = '../app/config.json';

const deployContracts = async () => {
    const relayHub = await RelayHub.new();
    const counter = await Counter.new(relayHub.address);

    return { relayHub, counter };
};

module.exports = async function(callback) {
    const network = process.argv[process.argv.length-1];
    const networkConfig = truffleConfig.networks[network];
    const host = `http://${networkConfig.host}:${networkConfig.port}`;

    let relayHub, counter;
    let create = true;

    if (fs.existsSync(CONFIG_PATH)) {
        try {
            // Grab addresses of existing contracts
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
            counter = await Counter.at(config.contractAddress);
            const relayHubAddress = await counter.getHubAddr();
            relayHub = await RelayHub.at(relayHubAddress);
            create = false;
        } catch (e) {
            console.log('Error while trying to grab existing contracts:', e);
        }
    }

    if (create) {
        ({ relayHub, counter } = await deployContracts());
    }

    console.log('Node RPC host -', host);
    console.log('RelayHub address -', relayHub.address);
    console.log('Counter address -', counter.address);

    callback();
};

#!/usr/bin/env node

const Web3 = require('web3');

const web3 = new Web3('http://localhost:4444');

const deployVerifierAddress = ''; // the DeployVerifier contract address
const customDeployVerifierAddress = ''; // the CustomSmartWalletDeployVerifier contract address
const relayVerifierAddress = ''; // the RelayVerifier (first address) contract address
const customRelayVerifierAddress = ''; // the RelayVerifier (second address, when truffle says replacing) contract address

async function getTokens() {
    const deployVerifier = await new web3.eth.Contract(require('../build/contracts/DeployVerifier.json').abi, deployVerifierAddress);
    const deployVerifierEvents = await deployVerifier.getPastEvents('AllowedToken', {fromBlock: 0});

    const customDeployVerifier = await new web3.eth.Contract(require('../build/contracts/CustomSmartWalletDeployVerifier.json').abi, customDeployVerifierAddress);
    const customDeployVerifierEvents = await customDeployVerifier.getPastEvents('AllowedToken', {fromBlock: 0});

    const relayVerifier = await new web3.eth.Contract(require('../build/contracts/RelayVerifier.json').abi, relayVerifierAddress);
    const relayVerifierEvents = await relayVerifier.getPastEvents('AllowedToken', {fromBlock: 0});

    const customRelayVerifier = await new web3.eth.Contract(require('../build/contracts/RelayVerifier.json').abi, customRelayVerifierAddress);
    const customRelayVerifierEvents = await customRelayVerifier.getPastEvents('AllowedToken', {fromBlock: 0});

    return {
        deployVerifier: [...new Set(deployVerifierEvents.map(event => event.returnValues.tokenAddress))],
        customDeployVerifier: [...new Set(customDeployVerifierEvents.map(event => event.returnValues.tokenAddress))],
        relayVerifier: [...new Set(relayVerifierEvents.map(event => event.returnValues.tokenAddress))],
        customRelayVerifier: [...new Set(customRelayVerifierEvents.map(event => event.returnValues.tokenAddress))]
    };
}

getTokens().then(tokens => {
    console.log('Tokens', tokens);
});

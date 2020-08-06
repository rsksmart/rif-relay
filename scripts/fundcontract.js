#!/usr/bin/env node
const Web3 = require('web3')
const irelayhub = require( '../src/js/relayclient/IRelayHub')

const FUND_AMOUNT = 0.04;

async function fundcontract(hubaddr, contaddr, fromaddr, fund, web3) {
    let rhub = new web3.eth.Contract(irelayhub, hubaddr)
    let balance = await rhub.methods.balanceOf(contaddr).call();

    if ( balance >= fund ) {
        console.log( "already has a balance of "+(balance/1e18)+" eth. NOT adding more")
    } else {
        let ret = await rhub.methods.depositFor(contaddr).send({ from: fromaddr, value: fund });
        console.log(ret)
    }

}

async function run() {
    let hubaddr = process.argv[2]
    let contaddr = process.argv[3]
    let ethNodeUrl = process.argv[5] || 'http://localhost:8545'

    console.log({hubaddr, contaddr, ethNodeUrl})

    let fromaccount = process.argv[4] || 0;

    if (!hubaddr) {
        console.log("usage: fundcontract.js {hubaddr} {contaddr} {from-account} {nodeurl}")
        console.log(`fund amount is fixed on ${FUND_AMOUNT} eth`)
        console.log("node url defaults to 'http://localhost:8545'")
        process.exit(1)
    }

    const web3 = new Web3(new Web3.providers.HttpProvider(ethNodeUrl))

    let accounts = await web3.eth.getAccounts()
    fundcontract(hubaddr, contaddr, accounts[fromaccount], FUND_AMOUNT*1e18, web3)
}

run()

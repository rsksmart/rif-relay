import { isBN } from 'bn.js'

export default async function inTransaction (txHash, emitter, eventName, eventArgs = {}) {
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    const logs = decodeLogs(receipt.logs, emitter, eventName);
    return inLogs(logs, eventName, eventArgs);
}

function isWeb3Contract (contract) {
    return 'options' in contract && typeof contract.options === 'object';
}

function isTruffleContract (contract) {
    return 'abi' in contract && typeof contract.abi === 'object';
}

function decodeLogs (logs, emitter, eventName) {
    let abi;
    if (isWeb3Contract(emitter)) {
      abi = emitter.options.jsonInterface;
    } else if (isTruffleContract(emitter)) {
      abi = emitter.abi;
    } else {
      throw new Error('Unknown contract object');
    }
  
    let eventABI = abi.filter(x => x.type === 'event' && x.name === eventName);
    if (eventABI.length === 0) {
      throw new Error(`No ABI entry for event '${eventName}'`);
    } else if (eventABI.length > 1) {
      throw new Error(`Multiple ABI entries for event '${eventName}', only uniquely named events are supported`);
    }
  
    eventABI = eventABI[0];
  
    // The first topic will equal the hash of the event signature
    const eventSignature = `${eventName}(${eventABI.inputs.map(input => input.type).join(',')})`;
    const eventTopic = web3.utils.sha3(eventSignature);
    
    // Only decode events of type 'EventName'
    return logs
      .map(log => web3.eth.abi.decodeLog(eventABI.inputs, log.data, log.topics.slice(1)))
      .map(decoded => ({ event: eventName, args: decoded }));
  }

function inLogs (logs, eventName, eventArgs = {}) {
    const events = logs.filter(e => e.event === eventName);
    expect(events.length > 0).to.equal(true, `No '${eventName}' events found`);
  
    const exception = [];
    const event = events.find(function (e) {
      for (const [k, v] of Object.entries(eventArgs)) {
        try {
          contains(e.args, k, v);
        } catch (error) {
          exception.push(error);
          return false;
        }
      }
      return true;
    });
  
    if (event === undefined) {
      throw exception[0];
    }
  
    return event;
  }
  
function contains (args, key, value) {
    expect(key in args).to.equal(true, `Event argument '${key}' not found`);
  
    if (value === null) {
      expect(args[key]).to.equal(null,
        `expected event argument '${key}' to be null but got ${args[key]}`);
    } else if (isBN(args[key]) || isBN(value)) {
      const actual = isBN(args[key]) ? args[key].toString() : args[key];
      const expected = isBN(value) ? value.toString() : value;
      expect(args[key]).to.be.bignumber.equal(value,
        `expected event argument '${key}' to have value ${expected} but got ${actual}`);
    } else {
      expect(args[key]).to.be.eql(value,
        `expected event argument '${key}' to have value ${value} but got ${args[key]}`);
    }
  }
  
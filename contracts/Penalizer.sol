/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";

import "./utils/RLPReader.sol";
import "./utils/RSKAddrValidator.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPenalizer.sol";

contract Penalizer is IPenalizer, Ownable {

    string public override versionPenalizer = "2.0.1+enveloping.penalizer.ipenalizer";
    
    mapping(bytes32 => bool) public penalizedTransactions;
    mapping(bytes32 => bool) public fulfilledTransactions;

    address private hub;

    using ECDSA for bytes32;

    function decodeTransaction(bytes memory rawTransaction) private pure returns (Transaction memory transaction) {
        (transaction.nonce,
        transaction.gasPrice,
        transaction.gasLimit,
        transaction.to,
        transaction.value,
        transaction.data) = RLPReader.decodeTransaction(rawTransaction);
        return transaction;
    }

    modifier relayManagerOnly(IRelayHub relayHub) {
        require(relayHub.isRelayManagerStaked(msg.sender), "Unknown relay manager");
        _;
    }

    function setHub(address relayHub) public override onlyOwner{
        hub = relayHub;
    }

    function getHub() external override view returns (address){
        return hub;
    }

    function penalizeRepeatedNonce(
        bytes memory unsignedTx1,
        bytes memory signature1,
        bytes memory unsignedTx2,
        bytes memory signature2,
        IRelayHub relayHub
    )
    external
    override
    relayManagerOnly(relayHub)
    {
        // Can be called by a relay manager only.
        // If a relay attacked the system by signing multiple transactions with the same nonce
        // (so only one is accepted), anyone can grab both transactions from the blockchain and submit them here.
        // Check whether unsignedTx1 != unsignedTx2, that both are signed by the same address,
        // and that unsignedTx1.nonce == unsignedTx2.nonce.
        // If all conditions are met, relay is considered an "offending relay".
        // The offending relay will be unregistered immediately, its stake will be forfeited and given
        // to the address who reported it (msg.sender), thus incentivizing anyone to report offending relays.
        // If reported via a relay, the forfeited stake is split between
        // msg.sender (the relay used for reporting) and the address that reported it.

        bytes32 txHash1 = keccak256(abi.encodePacked(unsignedTx1));
        bytes32 txHash2 = keccak256(abi.encodePacked(unsignedTx2));

        // check that transactions were not already penalized
        require(!penalizedTransactions[txHash1] || !penalizedTransactions[txHash2], "Transactions already penalized");

        address addr1 = txHash1.recover(signature1);
        address addr2 = txHash2.recover(signature2);

        require(addr1 == addr2, "Different signer");
        require(RSKAddrValidator.checkPKNotZero(addr1), "ecrecover failed");

        Transaction memory decodedTx1 = decodeTransaction(unsignedTx1);
        Transaction memory decodedTx2 = decodeTransaction(unsignedTx2);

        // checking that the same nonce is used in both transaction, with both signed by the same address
        // and the actual data is different
        // note: we compare the hash of the tx to save gas over iterating both byte arrays
        require(decodedTx1.nonce == decodedTx2.nonce, "Different nonce");

        bytes memory dataToCheck1 =
        abi.encodePacked(decodedTx1.data, decodedTx1.gasLimit, decodedTx1.to, decodedTx1.value);

        bytes memory dataToCheck2 =
        abi.encodePacked(decodedTx2.data, decodedTx2.gasLimit, decodedTx2.to, decodedTx2.value);

        require(keccak256(dataToCheck1) != keccak256(dataToCheck2), "tx is equal");

        penalizedTransactions[txHash1] = true;
        penalizedTransactions[txHash2] = true;

        relayHub.penalize(addr1, msg.sender);
    }

    modifier relayHubOnly() {
        require(msg.sender == hub, "Unknown Relay Hub");
        _;
    }

    function fulfill(bytes calldata txSignature) external override relayHubOnly() {
        bytes32 txId = keccak256(txSignature);
        require(!fulfilledTransactions[txId], "Transaction already fulfilled");
        fulfilledTransactions[txId] = true;
    }

    function fulfilled(bytes calldata txSignature) external view override returns (bool){
        return fulfilledTransactions[keccak256(txSignature)];
    }

    function claim(CommitmentReceipt calldata commitmentReceipt) external override {
        // relay hub and commitment QoS must be set
        require(hub != address(0), "relay hub not set");
        require(commitmentReceipt.commitment.enableQos, "commitment without QoS");

        // commitment must be signed by worker
        address workerAddress = commitmentReceipt.workerAddress;
        bytes memory workerSignature = commitmentReceipt.workerSignature;
        bytes32 commitmentHash = keccak256(
            abi.encode(
                commitmentReceipt.commitment.time, 
                commitmentReceipt.commitment.from, 
                commitmentReceipt.commitment.to, 
                commitmentReceipt.commitment.data, 
                commitmentReceipt.commitment.relayHubAddress, 
                commitmentReceipt.commitment.relayWorker, 
                commitmentReceipt.commitment.enableQos
            )
        );
        require(recoverSigner(commitmentHash, workerSignature) == workerAddress, "worker signature mismatch");
        
        // commitment fields must match 
        require(workerAddress == commitmentReceipt.commitment.relayWorker, "worker address does not match");
        require(hub == commitmentReceipt.commitment.relayHubAddress, "relay hub does not match");
        require(msg.sender == commitmentReceipt.commitment.from, "receiver must claim commitment");

        // skip qos check for now
        //require(commitmentReceipt.commitment.time <= block.timestamp, "too early to claim");

        bytes32 txId = keccak256(commitmentReceipt.commitment.signature);
        require(fulfilledTransactions[txId] == false, "can't penalize fulfilled tx");
        require(penalizedTransactions[txId] == false, "tx already penalized");
            
        (bool success, ) = hub.call(abi.encodeWithSignature("penalize(address,address)", workerAddress, msg.sender));
        require(success, "Relay Hub penalize call failed");
        penalizedTransactions[txId] = true;
    }

    function splitSignature(bytes memory signature) internal pure returns (uint8, bytes32, bytes32) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := and(mload(add(signature, 65)), 255)
        }
        if (v < 27) v += 27;

        return (v, r, s);
    }

    function recoverSigner(bytes32 message, bytes memory signature) internal pure returns (address) {
        uint8 v;
        bytes32 r;
        bytes32 s;

        (v, r, s) = splitSignature(signature);

        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, message));

        return ecrecover(prefixedHash, v, r, s);
    }
}

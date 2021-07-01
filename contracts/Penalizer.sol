// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";

import "./utils/RLPReader.sol";
import "./utils/RSKAddrValidator.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPenalizer.sol";

contract Penalizer is IPenalizer {

    string public override versionPenalizer = "2.0.1+enveloping.penalizer.ipenalizer";
    
    mapping(bytes32 => bool) public penalizedTransactions;
    mapping(bytes32 => bool) public fulfilledTransactions;

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

    modifier relayManagerOnly(IRelayHub hub) {
        require(hub.isRelayManagerStaked(msg.sender), "Unknown relay manager");
        _;
    }

    function penalizeRepeatedNonce(
        bytes memory unsignedTx1,
        bytes memory signature1,
        bytes memory unsignedTx2,
        bytes memory signature2,
        IRelayHub hub
    )
    public
    override
    relayManagerOnly(hub)
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

        hub.penalize(addr1, msg.sender);
    }

    function fulfill(
        address worker,
        bytes32 txSignature
    ) external override returns (bool) {
        bytes32 txHash = keccak256(abi.encodePacked(worker, txSignature));
        fulfilledTransactions[txHash] = true;
        return fulfilledTransactions[txHash];
    }

    function claim(CommitmentReceipt calldata commitmentReceipt) external override {

        // check if the commitment has enabled qos
        require(commitmentReceipt.commitment.enabledQos, "This commitment has not enabled QOS");

        // check the worker address and the signature
        address workerAddress = commitmentReceipt.workerAddress;
        bytes memory workerSignature = commitmentReceipt.workerSignature;
        bytes32 commitmentHash = keccak256(abi.encodePacked(commitmentReceipt.commitment.time, commitmentReceipt.commitment.from, commitmentReceipt.commitment.to, commitmentReceipt.commitment.data, commitmentReceipt.commitment.relayHubAddress, commitmentReceipt.commitment.relayWorker, commitmentReceipt.commitment.enabledQos));

        require(recoverSigner(commitmentHash, workerSignature) == workerAddress, "This commitment is not signed by the specified worker");
        require(workerAddress == commitmentReceipt.commitment.relayWorker, "The worker address in the receipt is not the same as the commitment");
        // we should check the address of the hub here to check if the specified hub is the same
        // but we need the hub instance (probably we need it on the constructor)
        // require(commitmentReceipt.commitment.relayHubAddress == hub.address)

        // check if the claimer is who made the relay transaction and not other
        require(msg.sender == commitmentReceipt.commitment.from, "Only the original sender can claim a commitment");

        // check if the time has past or not

        require(commitmentReceipt.commitment.time <= block.timestamp, "The time you agreed to wait is not due yet, this claim is not valid");

        // check if the transaction have been executed or not

        // check if the transaction was executed in time

    }

    function splitSignature(bytes memory signature) internal pure returns (uint8, bytes32, bytes32) {
        require(signature.length == 65);

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            // first 32 bytes, after the length prefix
            r := mload(add(signature, 32))
            // second 32 bytes
            s := mload(add(signature, 64))
            // final byte (first byte of the next 32 bytes)
            v := byte(0, mload(add(signature, 96)))
        }

        return (v, r, s);
    }

    function recoverSigner(bytes32 message, bytes memory signature) internal pure returns (address) {
        uint8 v;
        bytes32 r;
        bytes32 s;

        (v, r, s) = splitSignature(signature);

        return ecrecover(message, v, r, s);
    }
}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";

import "./utils/RLPReader.sol";
import "./utils/RSKAddrValidator.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPenalizer.sol";
import "./interfaces/IQualityofService.sol";

contract QualityofService is IQualityofService {
    
    mapping(bytes32 => bool) public penalizedTransactions;

    using ECDSA for bytes32;

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

    function fullfil(CommitmentResponse calldata res) external {
        keccak256(abi.encodePacked(unsignedTx1));
        bytes32 txHash1 = keccak256(abi.encodePacked(unsignedTx1));

        keccak256(res.signedTx)
    }

    function penalize(CommitmentResponse calldata res) external {
        bytes32 txHash1 = keccak256(abi.encodePacked(unsignedTx1));

        keccak256(res.signedTx)
    }
}

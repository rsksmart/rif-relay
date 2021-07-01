// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IRelayHub.sol";

interface IPenalizer {

    struct Transaction {
        uint256 nonce;
        uint256 gasPrice;
        uint256 gasLimit;
        address to;
        uint256 value;
        bytes data;
    }

    function penalizeRepeatedNonce(
        bytes calldata unsignedTx1,
        bytes calldata signature1,
        bytes calldata unsignedTx2,
        bytes calldata signature2,
        IRelayHub hub
    ) external;

    function versionPenalizer() external view returns (string memory);

    function fulfill(bytes memory txSignature, IRelayHub hub) external;

    function fulfilled(bytes calldata txSignature) external view returns (bool);

    struct CommitmentReceipt {
        Commitment commitment;
        bytes workerSignature;
        address workerAddress;
    }

    struct Commitment {
        uint256 time;
        address from;
        address to;
        bytes data;
        address relayHubAddress;
        address relayWorker;
        bool enabledQos;
        bytes signature;
    }

    function claim(CommitmentReceipt calldata commitmentReceipt) external;
}

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
        IRelayHub relayHub
    ) external;

    function versionPenalizer() external view returns (string memory);

    function setHub(address relayHub) external;

    function getHub() external view returns (address);

    function fulfill(bytes32 txhash) external;

    function fulfilled(bytes calldata txSignature) external view returns (bool);

    struct CommitmentReceipt {
        address workerAddress;
        Commitment commitment;
        bytes workerSignature;
    }

    struct Commitment {
        uint256 time;
        address from;
        address to;
        address relayHubAddress;
        address relayWorker;
        bool enableQos;
        bytes data;
        bytes signature;
    }

    function claim(CommitmentReceipt calldata commitmentReceipt) external;
}

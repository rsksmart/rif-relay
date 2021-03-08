// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

import "../interfaces/IForwarder.sol";

interface EnvelopingTypes {
    struct RelayData {
        uint256 gasPrice;
        bytes32 domainSeparator;
        address relayWorker;
        address callForwarder; 
        address callVerifier;
    }

    struct RelayRequest {
        IForwarder.ForwardRequest request;
        RelayData relayData;
    }

    struct DeployRequest {
        IForwarder.DeployRequest request;
        RelayData relayData;
    }
}

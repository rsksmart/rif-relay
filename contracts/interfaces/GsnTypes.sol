// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

import "../interfaces/IForwarder.sol";

interface GsnTypes {
    struct RelayData {
        uint256 gasPrice;
        uint256 clientId;
        bytes32 domainSeparator;
        bool isSmartWalletDeploy;
        address relayWorker;
        address callForwarder; // only set if this is a SmartWallet deploy request
        address callVerifier;
    }

    //note: must start with the ForwardRequest to be an extension of the generic forwarder
    struct RelayRequest {
        IForwarder.ForwardRequest request;
        RelayData relayData;
    }
}

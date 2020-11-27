// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../forwarder/IForwarder.sol";

interface ISmartWalletFactory {

    function nonce (address from) external view returns(uint256);


    function relayedUserSmartWalletCreation(
        IForwarder.ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes calldata sig
    ) external;

    event Deployed(address addr, uint256 salt); //Event triggered when a deploy is successful

}
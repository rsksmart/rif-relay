// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../forwarder/IForwarder.sol";

interface IProxyFactory {

    function nonce (address from) external view returns(uint256);

    function createUserSmartWallet(
        address owner,
        address recoverer,
        address logic,
        uint256 index,
        bytes calldata initParams,
        bytes calldata sig
    ) external;

    function relayedUserSmartWalletCreation(
        IForwarder.ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes calldata sig
    ) external;

    function getSmartWalletAddress(
        address owner,
        address recoverer,
        address logic,
        bytes32 initParamsHash,
        uint256 index
    ) external view returns (address);
    
    event Deployed(address addr, uint256 salt); //Event triggered when a deploy is successful
}

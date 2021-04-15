// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IForwarder.sol";

interface IWalletFactory {

    function nonce (address from) external view returns(uint256);

    function runtimeCodeHash() external view returns (bytes32);

    function relayedUserSmartWalletCreation(
        IForwarder.DeployRequest memory req,
        bytes32 domainSeparator,
        bytes32 suffixData,
        bytes calldata sig
    ) external;


    function getCreationBytecode() external view returns (bytes memory);

    event Deployed(address indexed addr, uint256 salt); //Event triggered when a deploy is successful

}
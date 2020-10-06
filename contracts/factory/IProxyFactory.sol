// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.12 <0.8.0;
pragma experimental ABIEncoderV2;

import "../forwarder/IForwarder.sol";

interface IProxyFactory {

    function getNonce(address from) external view returns(uint256);

    function createUserSmartWallet(
        address owner,
        address logic,
        uint256 logicInitGas,
        bytes calldata initParams,
        bytes calldata sig
    ) external;

    function relayedUserSmartWalletCreation(
        IForwarder.ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes calldata suffixData,
        bytes calldata sig
    ) external;

    function getSmartWalletAddress(
        address owner,
        address logic,
        bytes memory initParams
    ) external view returns (address);
}

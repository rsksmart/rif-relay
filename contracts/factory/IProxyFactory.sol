// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.12 <0.8.0;
pragma experimental ABIEncoderV2;

import "../smartwallet/ISmartWallet.sol";

interface IProxyFactory {

    function getNonce(address from) external view returns(uint256);

    function createUserSmartWallet(
        address owner,
        address logic,
        bytes calldata initParams,
        bytes calldata sig
    ) external;

    function relayedUserSmartWalletCreation(
        ISmartWallet.ForwardRequest memory req,
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

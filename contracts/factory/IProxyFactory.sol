// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./ISmartWalletFactory.sol";

interface IProxyFactory is ISmartWalletFactory{

    function createUserSmartWallet(
        address owner,
        address recoverer,
        address logic,
        uint256 index,
        bytes calldata initParams,
        bytes calldata sig
    ) external;

    function getSmartWalletAddress(
        address owner,
        address recoverer,
        address logic,
        bytes32 initParamsHash,
        uint256 index
    ) external view returns (address);
    
}

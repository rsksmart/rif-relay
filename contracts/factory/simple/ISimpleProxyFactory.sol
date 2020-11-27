// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../ISmartWalletFactory.sol";

interface ISimpleProxyFactory is ISmartWalletFactory{

    function createUserSmartWallet(
        address owner,
        address recoverer,
        uint256 index,
        bytes calldata sig
    ) external;

    function getSmartWalletAddress(
        address owner,
        address recoverer,
        uint256 index
    ) external view returns (address);
    
}

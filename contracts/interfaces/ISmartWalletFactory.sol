// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IWalletFactory.sol";

interface ISmartWalletFactory is IWalletFactory{
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

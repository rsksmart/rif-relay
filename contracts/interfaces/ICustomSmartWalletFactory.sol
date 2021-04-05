// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IWalletFactory.sol";

interface ICustomSmartWalletFactory is IWalletFactory{

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

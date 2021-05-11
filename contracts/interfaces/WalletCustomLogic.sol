// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IForwarder.sol";

interface WalletCustomLogic {

    function initialize(bytes memory initParams) external;

    function execute(
        bytes32 domainSeparator,
        bytes32 suffixData,
        IForwarder.ForwardRequest calldata forwardRequest,
        bytes calldata signature
    )
    external payable
    returns (bytes memory ret);
    
    function directExecute(address to, bytes calldata data) external payable returns (
        bytes memory ret  
    );
}
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./IForwarder.sol";

/**
 * Interface defining the methods that should be implemented
 * in order to provide custom logic to a CustomSmartWallet
 * @param id the object-id to add a version (32-byte string)
 * @param version the new version to add (32-byte string)
 * @param value value to attach to this version
 */
interface IWalletCustomLogic {

    /**
     * Setup any data required by the custom logic
     * @param initParams Data required in order to initilize custom logic
     */
    function initialize(bytes memory initParams) external;

    /**
     * Lets a relayer execute the custom logic
     */
    function execute(
        bytes32 domainSeparator,
        bytes32 suffixData,
        IForwarder.ForwardRequest calldata forwardRequest,
        bytes calldata signature
    )
    external payable
    returns (bytes memory ret);
    
    /**
     * Lets an account with RBTC execute the custom logic
     * @param to Target contract address
     * @param data Destination function 'msg.data'
     */
    function directExecute(address to, bytes calldata data) external payable returns (
        bytes memory ret  
    );
}
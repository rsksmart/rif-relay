// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@rsksmart/rif-relay-contracts/dist/contracts/interfaces/IForwarder.sol";

/**
 * Interface defining the methods that should be implemented
 * in order to provide custom logic to a CustomSmartWallet
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
        bytes32 suffixData,
        IForwarder.ForwardRequest calldata forwardRequest,
        address feesReceiver,
        bytes calldata signature
    )
    external payable
    returns (bytes memory ret);
    
    /**
     * Lets an account with RBTC execute the custom logic
     * @param to Target contract address
     * @param data Destination function 
     */
    function directExecute(address to, bytes calldata data) external payable returns (
        bytes memory ret  
    );
}
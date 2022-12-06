// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IForwarder {

    struct ForwardRequest {
        address relayHub;
        address from;
        address to;
        address tokenContract;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint256 tokenAmount;
        uint256 tokenGas;
        uint256 validUntilTime;
        bytes data;
    }

    struct DeployRequest {
        address relayHub;
        address from;
        address to; // In a deploy request, the to param inidicates an optional logic contract
        address tokenContract;
        address recoverer; // only used in SmartWallet deploy requests
        uint256 value;
        uint256 nonce;
        uint256 tokenAmount;
        uint256 tokenGas;
        uint256 validUntilTime;
        uint256 index; // only used in SmartWallet deploy requests
        bytes data;
    }

    

    function nonce()
    external view
    returns(uint256);

    /**
     * verify the transaction would execute.
     * validate the signature and the nonce of the request.
     * revert if either signature or nonce are incorrect.
     */
    function verify(
        bytes32 domainSeparator,
        bytes32 suffixData,
        ForwardRequest calldata forwardRequest,
        bytes calldata signature
    ) external view;

    /**
     * execute a transaction
     * @param forwardRequest - all transaction parameters
     * @param domainSeparator - domain used when signing this request
     * @param suffixData - the extension data used when signing this request.
     * @param signature - signature to validate.
     *
     * the transaction is verified, and then executed.
     * the success and ret of "call" are returned.
     * This method would revert only verification errors. target errors
     * are reported using the returned "success" and ret string
     */
    function execute(
        bytes32 domainSeparator,
        bytes32 suffixData,
        ForwardRequest calldata forwardRequest,
        bytes calldata signature
    )
    external payable
    returns (bool success, bytes memory ret);
    
    function directExecute(address to, bytes calldata data) external payable returns (
        bool success,
        bytes memory ret  
    );
}

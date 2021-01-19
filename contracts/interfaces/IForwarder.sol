// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IForwarder {

    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
        address tokenContract;
        uint256 tokenAmount;
    }

    struct DeployRequest {
        address from;
        address to; // In a deploy request, the to param inidicates an optional logic contract
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
        address tokenContract;
        uint256 tokenAmount;
        address recoverer; // only used in SmartWallet deploy requests
        uint256 index; // only used in SmartWallet deploy requests
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
        ForwardRequest calldata forwardRequest,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes calldata signature
    ) external view;

    /**
     * execute a transaction
     * @param forwardRequest - all transaction parameters
     * @param domainSeparator - domain used when signing this request
     * @param requestTypeHash - request type used when signing this request.
     * @param suffixData - the extension data used when signing this request.
     * @param signature - signature to validate.
     *
     * the transaction is verified, and then executed.
     * the success and ret of "call" are returned.
     * This method would revert only verification errors. target errors
     * are reported using the returned "success" and ret string
     */
    function execute(
        ForwardRequest calldata forwardRequest,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes calldata signature
    )
    external payable
    returns (uint256 lastSuccTx, bytes memory ret);
    
    function directExecute(address to, bytes calldata data) external payable returns (
        bool success,
        bytes memory ret  
    );
}

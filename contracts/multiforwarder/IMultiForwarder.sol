// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

interface IMultiForwarder {

    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    struct ForwardRequestDetail {
        ForwardRequest req;
        bytes32 domainSeparator;
        bytes32 requestTypeHash;
        bytes suffixData; 
        bytes signature;
    }

    function getNonce(address from)
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
        bytes calldata suffixData,
        bytes calldata signature   // @param signature - signature to validate.
    ) external view;

    /**
     * execute a transaction
     * @param reqList - All ForwardRequest to be relayed, which also include domainSeparator, typeHash and suffixData
     * the transaction is verified, and then executed.
     * the success and ret of "call" are returned.
     * This method would revert only verification errors. target errors
     * are reported using the returned "success" and ret string
     */
    function execute(
        ForwardRequestDetail[] calldata reqList
    )
    external payable
    returns (uint256 lastSuccTx, bytes memory lastRetTx, uint256 gasUsedByLastTx);

    /**
     * Register a new Request typehash.
     * @param typeName - the name of the request type.
     * @param typeSuffix - anything after the generic params can be empty string (if no extra fields are needed)
     *        if it does contain a value, then a comma is added first.
     */
    function registerRequestType(string calldata typeName, string calldata typeSuffix) external;
}

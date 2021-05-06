pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;


import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../interfaces/IForwarder.sol";
import "../utils/RSKAddrValidator.sol";

contract SuccessCustomLogic is IForwarder {
    using ECDSA for bytes32;

    event LogicCalled();

    function nonce() override external view returns(uint256) {
        return 0;
    }

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
    ) override external view {
        
    }


    function initialize(bytes memory initParams) public {
    }

    function execute(
        bytes32 domainSeparator,
        bytes32 suffixData,
        ForwardRequest memory req,
        bytes calldata sig
    ) override external payable returns (bool success, bytes memory ret) {
        emit LogicCalled();     
        (success, ret) = (true, "success");
    }

       function directExecute(address to, bytes calldata data) override external payable returns (
        bool success,
        bytes memory ret  
    ) {
        (success, ret) = (true, "success");    
    }
}

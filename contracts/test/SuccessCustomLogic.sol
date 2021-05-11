pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;


import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../interfaces/IForwarder.sol";
import "../utils/RSKAddrValidator.sol";

contract SuccessCustomLogic {
    using ECDSA for bytes32;

    event LogicCalled(string hola);
    event InitCalled();

    function initialize(bytes memory initParams) public {
        emit InitCalled();
    }

    function execute(
        bytes32 domainSeparator,
        bytes32 suffixData,
        IForwarder.ForwardRequest memory req,
        bytes calldata sig
    ) external payable returns (bytes memory ret) {
        emit LogicCalled("barroco");     
        ret = "success";
    }
}

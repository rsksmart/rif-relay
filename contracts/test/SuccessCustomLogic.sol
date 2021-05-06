pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;


import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../interfaces/IForwarder.sol";
import "../utils/RSKAddrValidator.sol";

contract SuccessCustomLogic {
    using ECDSA for bytes32;

    event LogicCalled();

    function initialize(bytes memory initParams) public {}

    function helloWorld() external payable returns (bool success, bytes memory ret) {
        emit LogicCalled();     
        (success, ret) = (true, "success");
    }
}

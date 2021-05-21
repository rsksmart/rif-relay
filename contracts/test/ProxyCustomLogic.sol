// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;


import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../interfaces/IForwarder.sol";
import "../interfaces/IWalletCustomLogic.sol";
import "../utils/RSKAddrValidator.sol";

contract ProxyCustomLogic is IWalletCustomLogic {
    using ECDSA for bytes32;

    event LogicCalled();
    event InitCalled();

    function initialize(bytes memory initParams) override public {
        emit InitCalled();
    }

    function execute(
        bytes32 domainSeparator,
        bytes32 suffixData,
        IForwarder.ForwardRequest memory req,
        bytes calldata sig
    ) override external payable returns (bytes memory ret) {
        emit LogicCalled();  
        bool  success;   
        (success, ret) = req.to.call{gas: req.gas, value: req.value}(req.data);
        require(success, "call failed");
    }

    function directExecute(address to, bytes calldata data) override external payable returns (
        bytes memory ret  
    ) {  
        emit LogicCalled();  
        bool success;              
        (success, ret) = to.call{value: msg.value}(data);
        require(success, "call failed");

    }
}

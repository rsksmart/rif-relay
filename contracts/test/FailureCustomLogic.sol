// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;


import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "@rsksmart/rif-relay-contracts/contracts/interfaces/IWalletCustomLogic.sol";
import "@rsksmart/rif-relay-contracts/contracts/utils/RSKAddrValidator.sol";

/* solhint-disable avoid-low-level-calls, no-unused-vars */
/**
* Example custom logic which always fail
*/
contract FailureCustomLogic is IWalletCustomLogic {
    using ECDSA for bytes32;

    event LogicCalled();
    event InitCalled();

    function initialize(bytes memory initParams) override public {
        emit InitCalled();
    }

    function execute(
        bytes32 suffixData,
        IForwarder.ForwardRequest memory req,
        address feesReceiver,
        bytes calldata sig
    ) override external payable returns (bytes memory ret) {
        revert("always fail");
    }

    function directExecute(address to, bytes calldata data) override external payable returns (
        bytes memory ret  
    ) {  
        revert("always fail");
    }
}

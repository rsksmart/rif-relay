// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./TestDeployVerifierEverythingAccepted.sol";

contract TestDeployVerifierConfigurableMisbehavior is TestDeployVerifierEverythingAccepted {
    bool public withdrawDuringPreRelayedCall;
    bool public returnInvalidErrorCode;
    bool public revertPostRelayCall;
    bool public overspendAcceptGas;
    bool public revertPreRelayCall;
    bool public expensiveGasLimits;
    int public expensiveGasLimitsIterations;

    function setWithdrawDuringPreRelayedCall(bool val) public {
        withdrawDuringPreRelayedCall = val;
    }
    function setReturnInvalidErrorCode(bool val) public {
        returnInvalidErrorCode = val;
    }
    function setRevertPostRelayCall(bool val) public {
        revertPostRelayCall = val;
    }
    function setRevertPreRelayCall(bool val) public {
        revertPreRelayCall = val;
    }
    function setOverspendAcceptGas(bool val) public {
        overspendAcceptGas = val;
    }

    function setExpensiveGasLimits(bool val) public {
        expensiveGasLimits = val;
    }
    function setExpensiveGasLimitsIterations(int val) public {
        expensiveGasLimitsIterations = val;
    }

    function verifyRelayedCall(
        /* solhint-disable-next-line no-unused-vars */
        EnvelopingTypes.DeployRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    override
    returns (bytes memory) {
        (signature, relayRequest);
        if (overspendAcceptGas) {
            uint i = 0;
            while (true) {
                i++;
            }
        }

        require(!returnInvalidErrorCode, "invalid code");

        if (revertPreRelayCall) {
            revert("revertPreRelayCall: Reverting");
        }
        return ("");
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}
}

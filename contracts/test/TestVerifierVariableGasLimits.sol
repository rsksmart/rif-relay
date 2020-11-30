// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./TestVerifierEverythingAccepted.sol";

contract TestVerifierVariableGasLimits is TestVerifierEverythingAccepted {

    string public override versionVerifier = "2.0.1+opengsn.test-vgl.iverifier";

    event SampleRecipientPreCallWithValues(
        uint256 gasleft,
        uint256 maxPossibleGas
    );

    event SampleRecipientPostCallWithValues(
        uint256 gasleft,
        uint256 gasUseWithoutPost
    );

    function preRelayedCall(
        /* solhint-disable-next-line no-unused-vars */
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    returns (bytes memory) {
        (signature, approvalData);
        emit SampleRecipientPreCallWithValues(
            gasleft(), maxPossibleGas);
        return ("");
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    {
        (context, success, gasUseWithoutPost, relayData);
        emit SampleRecipientPostCallWithValues(gasleft(), gasUseWithoutPost);
    }
}

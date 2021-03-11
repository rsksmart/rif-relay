// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./TestVerifierEverythingAccepted.sol";

contract TestVerifierVariableGasLimits is TestVerifierEverythingAccepted {

    string public override versionVerifier = "2.0.1+enveloping.test-vgl.iverifier";

    event SampleRecipientPreCallWithValues(
        uint256 gasleft
    );

    event SampleRecipientPostCallWithValues(
        uint256 gasleft
    );

    function verifyRelayedCall(
        /* solhint-disable-next-line no-unused-vars */
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    override
    returns (bytes memory) {
        (signature, relayRequest);
        emit SampleRecipientPreCallWithValues(gasleft());
        return ("");
    }
}

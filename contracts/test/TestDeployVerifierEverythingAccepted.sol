// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@rsksmart/rif-relay-contracts/contracts/interfaces/IDeployVerifier.sol";
import "@rsksmart/rif-relay-contracts/contracts/TokenHandler.sol";

contract TestDeployVerifierEverythingAccepted is IDeployVerifier, TokenHandler {

    function versionVerifier() external view override virtual returns (string memory){
        return "2.0.1+enveloping.test-pea.iverifier";
    }

    event SampleRecipientPreCall();
    event SampleRecipientPostCall(bool success);

    function verifyRelayedCall(
        /* solhint-disable-next-line no-unused-vars */
        EnvelopingTypes.DeployRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    override
    virtual
    returns (bytes memory) {
        (signature, relayRequest);
        emit SampleRecipientPreCall();
        return ("no revert here");
    }
}
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../verifier/BaseVerifier.sol";
import "../interfaces/IDeployVerifier.sol";

contract TestDeployVerifierEverythingAccepted is BaseVerifier, IDeployVerifier {


    function versionVerifier() external view override virtual returns (string memory){
        return "2.0.1+enveloping.test-pea.iverifier";
    }

    event SampleRecipientPreCall();
    event SampleRecipientPostCall(bool success);

    function preRelayedCall(
        /* solhint-disable-next-line no-unused-vars */
        EnvelopingTypes.DeployRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    returns (bytes memory) {
        (signature);
        (approvalData, maxPossibleGas);
        emit SampleRecipientPreCall();
        return ("no revert here");
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        EnvelopingTypes.RelayData calldata relayData
    )
    external
    override
    virtual
    {
        (context, relayData);
        emit SampleRecipientPostCall(success);
    }
}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./TestVerifierEverythingAccepted.sol";

contract TestVerifierStoreContext is TestVerifierEverythingAccepted {

    event SampleRecipientPreCallWithValues(
        address relay,
        address from,
        bytes encodedFunction,
        uint256 gasPrice,
        uint256 gasLimit,
        bytes approvalData,
        uint256 maxPossibleGas
    );

    event SampleRecipientPostCallWithValues(
        string context
    );

    /**
     * This demonstrates how preRelayedCall can return 'context' data for reuse in postRelayedCall.
     */
    function preRelayedCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    returns (bytes memory) {
        (signature, approvalData, maxPossibleGas);

        emit SampleRecipientPreCallWithValues(
            relayRequest.relayData.relayWorker,
            relayRequest.request.from,
            relayRequest.request.data,
            relayRequest.relayData.gasPrice,
            relayRequest.request.gas,
            approvalData,
            maxPossibleGas);
        return ("context passed from preRelayedCall to postRelayedCall");
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        EnvelopingTypes.RelayData calldata relayData
    )
    external
    override
    {
        (context, success, relayData);
        emit SampleRecipientPostCallWithValues(string(context));
    }
}

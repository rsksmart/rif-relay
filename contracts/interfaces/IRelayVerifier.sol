// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./EnvelopingTypes.sol";

interface IRelayVerifier {
    function versionVerifier() external view returns (string memory);

    /**
     * Called by Relay to validate the parameters of the request
     *
     *
     *  @param relayRequest - the full relay request structure
     *  @param signature - user's EIP712-compatible signature of the {@link relayRequest}.
     *              Note that in most cases the verifier shouldn't try use it at all. It is always checked
     *              by the forwarder immediately after verifyRelayedCall returns.
     */
    function verifyRelayedCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    ) external returns (bytes memory context);
}

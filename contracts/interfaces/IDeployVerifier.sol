// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";
import "./IBaseVerifier.sol";

interface IDeployVerifier is IBaseVerifier {


    /**
     * Called by Relay to validate the parameters of the request
     *
     *
     *  @param relayRequest - the full relay request structure
     *  @param signature - user's EIP712-compatible signature of the {@link relayRequest}.
     *              Note that in most cases the verifier shouldn't try use it at all. It is always checked
     *              by the forwarder immediately after preRelayedCall returns.
     *  @param approvalData - extra dapp-specific data (e.g. signature from trusted party)
     *  @param maxPossibleGas - based on values returned from {@link getGasLimits},
     *         the RelayHub will calculate the maximum possible amount of gas the user may be charged for.
     */
   function preRelayedCall(
        GsnTypes.DeployRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    ) external returns (bytes memory context);


    /**
     * This method may be called by the relayer after the actual relayed function call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     *
     *
     * @param context - the call context, as returned by the preRelayedCall
     * @param success - true if the relayed call succeeded, false if it reverted
     * @param relayData - the relay params of the request. can be used by relayHub.calculateCharge()
     */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        GsnTypes.RelayData calldata relayData
    ) external;
}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";

interface IDeployVerifier {


    /**
     * Called by Relay (and RelayHub), to validate if the verifier agrees to pay for this call.
     *
     * MUST be protected with relayHubOnly() in case it modifies state.
     *
     * The Verifier rejects by the following "revert" operations
     *  - preRelayedCall() method reverts
     *  - the forwarder reverts because of nonce or signature error
     *  - the verifier returned "rejectOnRecipientRevert", and the recipient contract reverted.
     * In any of the above cases, all verifier calls (and recipient call) are reverted.
     * In any other case, the verifier agrees to pay for the gas cost of the transaction (note
     *  that this includes also postRelayedCall revert)
     *
     * The rejectOnRecipientRevert flag means the Verifier "delegate" the rejection to the recipient
     *  code.  It also means the Verifier trust the recipient to reject fast: both preRelayedCall,
     *  forwarder check and receipient checks must fit into the GasLimits.acceptanceBudget,
     *  otherwise the TX is paid by the Verifier.
     *
     *  @param relayRequest - the full relay request structure
     *  @param signature - user's EIP712-compatible signature of the {@link relayRequest}.
     *              Note that in most cases the verifier shouldn't try use it at all. It is always checked
     *              by the forwarder immediately after preRelayedCall returns.
     *  @param approvalData - extra dapp-specific data (e.g. signature from trusted party)
     *  @param maxPossibleGas - based on values returned from {@link getGasLimits},
     *         the RelayHub will calculate the maximum possible amount of gas the user may be charged for.
     *         In order to convert this value to wei, the Verifier has to call "relayHub.calculateCharge()"
     *  return:
     *      a context to be passed to postRelayedCall
     *      rejectOnRecipientRevert - TRUE if verifier wants to reject the TX if the recipient reverts.
     *          FALSE means that rejects by the recipient will be completed on chain, and paid by the verifier.
     *          (note that in the latter case, the preRelayedCall and postRelayedCall are not reverted).
     */
   function preRelayedCall(
        GsnTypes.DeployRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    ) external returns (bytes memory context);


    /**
     * This method is called after the actual relayed function call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     *
     * MUST be protected with relayHubOnly() in case it modifies state.
     *
     * @param context - the call context, as returned by the preRelayedCall
     * @param success - true if the relayed call succeeded, false if it reverted
     * @param gasUseWithoutPost - the actual amount of gas used by the entire transaction, EXCEPT
     *        the gas used by the postRelayedCall itself.
     * @param relayData - the relay params of the request. can be used by relayHub.calculateCharge()
     *
     * Revert in this functions causes a revert of the client's relayed call (and preRelayedCall(), but the Verifier
     * is still committed to pay the relay for the entire transaction.
     */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external;

    function versionVerifier() external view returns (string memory);


    function acceptanceBudget() external view returns (uint256);
}

/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IRelayHub.sol";

contract TestRelayWorkerContract {

    function relayCall(
        IRelayHub hub,
        GsnTypes.RelayRequest memory relayRequest,
        bytes memory signature)
    public
    {
        hub.relayCall(relayRequest, signature);
    }
}

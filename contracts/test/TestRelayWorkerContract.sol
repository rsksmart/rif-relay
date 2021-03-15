// SPDX-License-Identifier:MIT
/* solhint-disable avoid-tx-origin */
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IRelayHub.sol";

contract TestRelayWorkerContract {

    function relayCall(
        IRelayHub hub,
        EnvelopingTypes.RelayRequest memory relayRequest,
        bytes memory signature)
    public
    {
        hub.relayCall(relayRequest, signature);
    }

    function deployCall(
        IRelayHub hub,
        EnvelopingTypes.DeployRequest memory deployRequest,
        bytes memory signature)
    public
    {
        hub.deployCall(deployRequest, signature);
    }
}

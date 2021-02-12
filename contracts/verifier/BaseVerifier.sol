// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/GsnTypes.sol";
import "../interfaces/IVerifier.sol";
import "../utils/GsnEip712Library.sol";

/**
 * Abstract base class to be inherited by a concrete Verifier
 * A subclass must implement:
 *  - preRelayedCall
 *  - postRelayedCall
 */
abstract contract BaseVerifier is Ownable {

    //overhead of forwarder verify+signature, plus hub overhead.
    uint256 constant public FORWARDER_HUB_OVERHEAD = 50000;

    //These parameters are documented in IVerifier.GasLimits
    uint256 constant public PRE_RELAYED_CALL_GAS_LIMIT = 100000;
    uint256 constant public POST_RELAYED_CALL_GAS_LIMIT = 110000;
    uint256 constant public VERIFIER_ACCEPTANCE_BUDGET = PRE_RELAYED_CALL_GAS_LIMIT + FORWARDER_HUB_OVERHEAD;

}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/EnvelopingTypes.sol";
import "../interfaces/IVerifier.sol";
import "../utils/Eip712Library.sol";

/**
 * Abstract base class to be inherited by a concrete Verifier
 * A subclass must implement:
 *  - preRelayedCall
 *  - postRelayedCall
 */
abstract contract BaseVerifier is Ownable {
    //overhead of forwarder verify+signature, plus hub overhead.
    uint256 constant public FORWARDER_HUB_OVERHEAD = 50000;
}

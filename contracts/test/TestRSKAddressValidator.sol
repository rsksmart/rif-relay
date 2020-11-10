// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "../utils/RSKAddrValidator.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";

contract TestRSKAddressValidator {
    using ECDSA for bytes32;

    function getSig(bytes32 messageHash, bytes memory sig) public returns (address) {
        return messageHash.recover(sig);
    }

    function compareAddressWithZeroPK(bytes32 messageHash, bytes memory sig) external returns (bool) {
        address addr = this.getSig(messageHash, sig);
        return RSKAddrValidator.checkPKNotZero(addr);
    }
}
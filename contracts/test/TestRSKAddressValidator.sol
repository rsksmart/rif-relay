// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

import "../utils/RSKAddrValidator.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";

contract TestRSKAddressValidator {
    using ECDSA for bytes32;

    function getAddress(bytes32 messageHash, bytes memory sig) public pure returns (address) {
        return messageHash.recover(sig);
    }

    function compareAddressWithZeroPK(bytes32 messageHash, bytes memory sig) external view returns (bool) {
        address addr = this.getAddress(messageHash, sig);
        return RSKAddrValidator.checkPKNotZero(addr);
    }

    function compareAddressWithSigner(bytes32 messageHash, bytes memory sig, address addr2) external view returns (bool) {
        address addr1 = this.getAddress(messageHash, sig);
        return addr1 == addr2;
    }
}
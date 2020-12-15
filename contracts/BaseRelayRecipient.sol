// SPDX-License-Identifier:MIT
// solhint-disable no-inline-assembly
pragma solidity ^0.6.12;

/**
 * A base contract to be inherited by any contract that want to receive relayed transactions
 * A subclass must use "_msgSender()" instead of "msg.sender"
 */
contract BaseRelayRecipient {
      function versionPaymaster() external view virtual returns (string memory){
        return "2.0.1+opengsn.test-pea.baselerayrecipient";
    }
}

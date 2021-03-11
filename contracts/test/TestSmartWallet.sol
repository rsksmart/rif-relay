// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IForwarder.sol";

// helper class for testing the forwarder.
contract TestSmartWallet {
    function callExecute(IForwarder sw, IForwarder.ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 suffixData, bytes memory sig) public payable {
         (bool relaySuccess, bytes memory ret) = sw.execute{value:msg.value}(domainSeparator, suffixData, req, sig);
       
        emit Result(relaySuccess, relaySuccess ? "" : this.decodeErrorMessage(ret));
    }

    event Result(bool success, string error);

    function decodeErrorMessage(bytes calldata ret) external pure returns (string memory message) {
        //decode evert string: assume it has a standard Error(string) signature: simply skip the (selector,offset,length) fields
        if ( ret.length>4+32+32 ) {
            return abi.decode(ret[4:], (string));
        }
        //unknown buffer. return as-is
        return string(ret);
    }

    function getChainId() public pure returns (uint256 id){
        /* solhint-disable-next-line no-inline-assembly */
        assembly { id := chainid() }
    }
}

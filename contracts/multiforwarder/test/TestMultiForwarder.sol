// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../MultiForwarder.sol";

// helper class for testing the forwarder.
contract TestMultiForwarder {
    function callExecute(MultiForwarder multiForwarder, MultiForwarder.ForwardRequestDetail[] memory reqList) public payable 
        returns (string memory){
        (uint256 lastSuccTx, bytes memory lastRetTx, uint256 gasUsedByLastTx) = multiForwarder.execute{value:msg.value}(reqList);
        string memory retValue = lastSuccTx != 0 ? "" : this.decodeErrorMessage(lastRetTx);
        emit Result(lastSuccTx, retValue, gasUsedByLastTx);
        return retValue;
    }

    event Result(uint256 lastSuccTx, string lastRetTx, uint256 gasUsedByLastTx);

    function decodeErrorMessage(bytes calldata ret) external pure returns (string memory message) {
        //decode evert string: assume it has a standard Error(string) signature: simply skip the (selector,offset,length) fields
        if ( ret.length>4+32+32 ) {
            return abi.decode(ret[4:], (string));
        }
        //unknown buffer. return as-is
        return string(ret);
    }
}

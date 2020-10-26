// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../SmartWallet.sol";

// helper class for testing the forwarder.
contract TestSmartWallet {
    function callExecute(SmartWallet sw, SmartWallet.ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public payable {
         (bool success, uint256 lastSuccTx, bytes memory ret) = sw.execute{value:msg.value}(req, domainSeparator, requestTypeHash, suffixData, sig);
       
        emit Result(success, success ? "" : this.decodeErrorMessage(ret), lastSuccTx);
    }

    event Result(bool success, string error, uint256 lastSuccTx);

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

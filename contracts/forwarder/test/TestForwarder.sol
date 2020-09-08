// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../Forwarder.sol";

// helper class for testing the forwarder.
contract TestForwarder {
    function callExecute(Forwarder forwarder, Forwarder.ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public payable {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory error) = req.tokenContract.call{gas: req.tokenGas}(
        abi.encodeWithSelector(IERC20.transfer.selector, req.tokenRecipient, req.paybackTokens)
        );

        if (!success){
            //re-throw the revert with the same revert reason.
            GsnUtils.revertWithData(error);
            return;
        }
        
        (success,error) = forwarder.execute{value:msg.value}(req, domainSeparator, requestTypeHash, suffixData, sig);
        emit Result(success, success ? "" : this.decodeErrorMessage(error));
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
}

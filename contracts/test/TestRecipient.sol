/* solhint-disable avoid-tx-origin */
/* solhint-disable avoid-low-level-calls */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

import "./TestVerifierConfigurableMisbehavior.sol";

contract TestRecipient {

    string public versionRecipient = "2.0.1+enveloping.test.irelayrecipient";
    bool public nextRevert;

    event Reverting(string message);

    function setNextRevert() public {
        nextRevert = true;
    }

    function testRevert() public {
        require(address(this) == address(0), "always fail");
        emit Reverting("if you see this revert failed...");
    }

     function testNextRevert() public {
        if(nextRevert){
            require(address(this) == address(0), "always fail");
            emit Reverting("if you see this revert failed...");
        }
        else{
            nextRevert = true;
        }   
    }

    address payable public verifier;

    function setWithdrawDuringRelayedCall(address payable _verifier) public {
        verifier = _verifier;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    event SampleRecipientEmitted(string message, address msgSender, address origin, uint256 msgValue, uint256 balance);
    event SampleRecipientEmittedNew(string message, address msgSender, address origin, uint256 msgValue, uint256 balance);

    function emitMessage(string memory message) public payable returns (string memory) {
   
        emit SampleRecipientEmitted(message, msg.sender, tx.origin, msg.value, address(this).balance);
        return "emitMessage return value";
    }


    function emitMessage3(string memory message) public payable returns (string memory) {

        emit SampleRecipientEmitted(message, msg.sender, tx.origin, msg.value, address(this).balance);
        emit SampleRecipientEmittedNew("result", msg.sender, tx.origin, msg.value, address(this).balance);
        emit SampleRecipientEmittedNew("result2", msg.sender, tx.origin, msg.value, address(this).balance);
        emit SampleRecipientEmittedNew("result3", msg.sender, tx.origin, msg.value, address(this).balance);
        emit SampleRecipientEmittedNew("result4", msg.sender, tx.origin, msg.value, address(this).balance);

        return message;
    }


 function transferTokens(address tokenRecipient, address tokenAddr, uint256 tokenAmount) public payable {

          if (tokenAmount > 0) {
            (bool success, bytes memory ret ) = tokenAddr.call(abi.encodeWithSelector(
                hex"a9059cbb",
                tokenRecipient,
                tokenAmount));

            require(
            success && (ret.length == 0 || abi.decode(ret, (bool))),
            "Unable to pay for deployment");
        }
        emit SampleRecipientEmitted("Payment Successful", msg.sender, tx.origin, msg.value, address(this).balance);
    }

    // solhint-disable-next-line no-empty-blocks
    function dontEmitMessage(string memory message) public {}

    function emitMessageNoParams() public {
        emit SampleRecipientEmitted("Method with no parameters", msg.sender, tx.origin, 0, address(this).balance);
    }

    //return (or revert) with a string in the given length
    function checkReturnValues(uint len, bool doRevert) public view returns (string memory) {
        (this);
        string memory mesg = "this is a long message that we are going to return a small part from. we don't use a loop since we want a fixed gas usage of the method itself.";
        require( bytes(mesg).length>=len, "invalid len: too large");

        /* solhint-disable no-inline-assembly */
        //cut the msg at that length
        assembly { mstore(mesg, len) }
        require(!doRevert, mesg);
        return mesg;
    }

    //function with no return value (also test revert with no msg.
    function checkNoReturnValues(bool doRevert) public view {
        (this);
        /* solhint-disable-next-line reason-string */
        require(!doRevert);
    }
}
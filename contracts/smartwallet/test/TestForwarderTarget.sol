// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

contract TestForwarderTarget {

    string public  versionRecipient = "2.0.1+enveloping.test.recipient";


    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    event TestForwarderMessage(string message, address msgSender, address origin);

    function emitMessage(string memory message) public {

        // solhint-disable-next-line avoid-tx-origin
        emit TestForwarderMessage(message, msg.sender, tx.origin);
    }


    function mustReceiveEth(uint value) public payable {
        require( msg.value == value, "didn't receive value");
    }

    event Reverting(string message);

    function testRevert() public {
        require(address(this) == address(0), "always fail");
        emit Reverting("if you see this revert failed...");
    }
}

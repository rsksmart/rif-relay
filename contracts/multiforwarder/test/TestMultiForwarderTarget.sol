// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "../../BaseRelayRecipient.sol";

contract TestMultiForwarderTarget is BaseRelayRecipient {

    string public override versionRecipient = "2.0.0-beta.1+opengsn.test.recipient";

    constructor(address multiforwarder) public {
        trustedForwarder = multiforwarder;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    event TestMultiForwarderMessage(string message, address realSender, address msgSender, address origin);

    function emitMessage(string memory message) public {

        // solhint-disable-next-line avoid-tx-origin
        emit TestMultiForwarderMessage(message, _msgSender(), msg.sender, tx.origin);
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

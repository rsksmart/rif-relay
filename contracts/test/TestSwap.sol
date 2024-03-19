// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

contract TestSwap {

    function claim(
        bytes32 preimage,
        uint amount,
        address refundAddress,
        uint timelock
    ) external {
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Could not transfer Ether");
    }

     // solhint-disable-next-line no-empty-blocks
     receive() external payable {}

}
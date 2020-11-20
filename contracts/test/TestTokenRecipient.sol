// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestTokenRecipient is ERC20("Test Recipient Token Contract", "TKNR") {
    function mint(uint amount, address to) public {
        _mint(msg.sender, amount);
        _transfer(msg.sender, to, amount);
    }
}
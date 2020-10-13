// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20("Test Token", "TKN") {
    function mint(uint amount, address to) public {
        _mint(msg.sender, amount);
        _transfer(msg.sender, to, amount);
    }
}
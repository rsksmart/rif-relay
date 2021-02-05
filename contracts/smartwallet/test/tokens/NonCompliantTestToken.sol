// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

import "../NonCompliantERC20.sol";


contract NonCompliantTestToken is NonCompliantERC20("NCTest Token", "NTKN"){

    
    function mint(uint amount, address to) public {
        _mint(msg.sender, amount);
        _transfer(msg.sender, to, amount);
    }

}
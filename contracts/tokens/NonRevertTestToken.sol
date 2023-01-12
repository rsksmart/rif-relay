// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;

import "./ERC20Mod.sol";

contract NonRevertTestToken is ERC20Mod("NonRevert Test Token", "NRTKN") {
    function mint(uint amount, address to) public {
        _mint(msg.sender, amount);
        _transfer(msg.sender, to, amount);
    }

     function transfer(address recipient, uint256 amount) public virtual override returns (bool success) {
        address sender = _msgSender();
        if( (sender != address(0)) && (recipient != address(0)) && (_balances[sender] >= amount)){
                _balances[sender] = _balances[sender].sub(amount);
                _balances[recipient] = _balances[recipient].add(amount);
                emit Transfer(sender, recipient, amount);
                success = true;
        }
    }
}
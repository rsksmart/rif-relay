// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.4.16 <0.8.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract TutorialToken is ERC20("TutorialToken", "TT" ) {

    uint256 public INITIAL_SUPPLY = 12000;


    constructor() public {
        _setupDecimals(2);
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}

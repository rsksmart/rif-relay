// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.6.12 <0.8.0;

import "./ERC20.sol";

contract TutorialToken is ERC20("TutorialToken", "TT" ) {

    uint256 public INITIAL_SUPPLY = 12000;


    constructor() public {
        _setupDecimals(2);
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}

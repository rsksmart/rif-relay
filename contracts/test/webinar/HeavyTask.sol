/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable avoid-tx-origin */
/* solhint-disable bracket-align */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";


contract HeavyTask {
    using SafeMath for uint256;


    event ValueCalculated(bytes32 value);
    
    // maps relay managers to the number of their workers
    mapping(uint256 => mapping(bytes32 => bytes32) ) public dataStorage;

    bool public greenCode;

    constructor(
    ) public {
        greenCode = false;
    }

    
    function resetGreenCode() external{
        greenCode = false;
    }
  
    /**
    New relay worker addresses can be added (as enabled workers) as long as they don't have a relay manager aldeady assigned.
     */
    function performTask(address infoA, uint256 infoB, bytes memory infoC)
        external
    {
        require(greenCode == false, "Only runs when not in green");
  
        for(uint256 steps = 0; steps < 10; steps++){
            bytes32 value = keccak256(abi.encodePacked(infoA,keccak256(abi.encodePacked(infoB,keccak256(abi.encodePacked(infoC))))));
            bytes32 key = keccak256(abi.encodePacked("Key_",value));
            dataStorage[steps][key] =  value;
            emit ValueCalculated(value);
        }
        
        greenCode = true;
    }

  
}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "../utils/GsnUtils.sol"; 

contract TestGSNUtils {
  //helper: send value to another contract
    function getBytesParam(bytes memory data, uint index) external pure returns (bytes memory) {
        return GsnUtils.getBytesParam(data, index);
    }

    function getParam(bytes memory data, uint index) external pure returns (uint) {
        return GsnUtils.getParam(data, index);
    }

    function _isContract(address _addr) external view returns (bool isContract){
        return GsnUtils._isContract(_addr);
    }
}

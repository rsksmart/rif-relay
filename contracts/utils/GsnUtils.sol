/* solhint-disable no-inline-assembly */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "../utils/MinLibBytes.sol";

library GsnUtils {

    /**
     * extract method sig from encoded function call
     */
    function getMethodSig(bytes memory msgData) internal pure returns (bytes4) {
        return MinLibBytes.readBytes4(msgData, 0);
    }

    /**
     * extract parameter from encoded-function block.
     * see: https://solidity.readthedocs.io/en/develop/abi-spec.html#formal-specification-of-the-encoding
     * the return value should be casted to the right type (uintXXX/bytesXXX/address/bool/enum)
     */
    function getParam(bytes memory msgData, uint index) internal pure returns (uint) {
        return MinLibBytes.readUint256(msgData, 4 + index * 32);
    }


    /**
     * extract BYTES parameter with length from encoded-function block.
     * see: https://solidity.readthedocs.io/en/develop/abi-spec.html#formal-specification-of-the-encoding
     * param msgData: abi encoded data
     * param index: index of the encoded parameter
     */
    function getBytesParam(bytes memory msgData, uint index) internal pure returns (bytes memory) {
        uint256 myArgPos = 4 + index * 32;
        uint256 lengthOffset = MinLibBytes.readUint256(msgData, myArgPos);
        uint256 length = MinLibBytes.readUint256(msgData, 4+lengthOffset);
        // Value is next to legth, we get the offset by adding 32
        uint256 valueOffset = lengthOffset+32;
        bytes32 paramBytes32 = MinLibBytes.readBytes32(msgData, 4+valueOffset);
        bytes memory result = bytes32ToBytesWithLength(paramBytes32, length);
        return result;
    }

    function bytes32ToBytesWithLength(bytes32 data, uint256 length) internal pure returns (bytes memory) {
        bytes memory result = new bytes(length);
        uint256 i = 0;
        while (i < 32 && data[i] != 0) {
            result[i] = data[i];
            ++i;
        }
        return result;
    }

    /**
     * Check if a contract has code in it
     * Should NOT be used on contructor, it fails
     * See: https://stackoverflow.com/a/54056854
     */
    function _isContract(address _addr) public view returns (bool isContract){
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }

    //re-throw revert with the same revert data.
    function revertWithData(bytes memory data) internal pure {
        assembly {
            revert(add(data,32), mload(data))
        }
    }

}

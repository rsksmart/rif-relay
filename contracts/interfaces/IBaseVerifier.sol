// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";

interface IBaseVerifier {

    function versionVerifier() external view returns (string memory);

}

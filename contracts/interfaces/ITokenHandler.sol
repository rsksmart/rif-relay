// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface ITokenHandler {
    /**
     * Returns a list of accepted tokens
     */
    function getAcceptedTokens() external view returns (address[] memory);

    /**
     * Returns a true if a token is accepted
     */
    function acceptsToken(address token) external view returns (bool);
}

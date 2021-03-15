// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../factory/ProxyFactory.sol";
import "./BaseVerifier.sol";

import "../interfaces/IVerifier.sol";


/* solhint-disable no-inline-assembly */
/* solhint-disable avoid-low-level-calls */

/**
 * A verifier for relay transactions.
 * - each request is paid for by the caller.
 * - acceptRelayedCall - verify the caller can pay for the request in tokens.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract RelayVerifier is BaseVerifier, IVerifier{
    using SafeMath for uint256;

    address private factory;

    constructor(address proxyFactory) public {
        factory = proxyFactory;
    }

    function versionVerifier() external override virtual view returns (string memory){
        return "rif.enveloping.token.iverifier@2.0.1";
    }

    mapping (address => bool) public tokens;

    /* solhint-disable no-unused-vars */
    function preRelayedCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    returns (bytes memory context) {
        require(tokens[relayRequest.request.tokenContract], "Token contract not allowed");

        address payer = relayRequest.relayData.callForwarder;
        if(relayRequest.request.tokenContract != address(0)){
            require(relayRequest.request.tokenAmount <= IERC20(relayRequest.request.tokenContract).balanceOf(payer), "balance too low");
        }

        // Check for the codehash of the smart wallet sent
        bytes32 smartWalletCodeHash;
        assembly { smartWalletCodeHash := extcodehash(payer) }

        require(ProxyFactory(factory).runtimeCodeHash() == smartWalletCodeHash, "SW different to template");

        return (abi.encode(payer, relayRequest.request.tokenAmount, relayRequest.request.tokenContract));
    }
    /* solhint-enable no-unused-vars */

    /* solhint-disable no-empty-blocks */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        EnvelopingTypes.RelayData calldata relayData
    )
    external
    override
    virtual
     {
        // for now we dont produce any refund
        // so there is nothing to be done here
    }


    function acceptToken(address token) external onlyOwner {
        require(token != address(0), "Token cannot be zero address");
        tokens[token] = true;
    }
}
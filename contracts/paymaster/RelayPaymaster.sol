// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../factory/ProxyFactory.sol";
import "./BasePaymaster.sol";

/**
 * A paymaster for relay transactions.
 * - each request is paid for by the caller.
 * - acceptRelayedCall - verify the caller can pay for the request in tokens.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract RelayPaymaster is BasePaymaster {
    using SafeMath for uint256;

    address private factory;

    constructor(address proxyFactory) public {
        factory = proxyFactory;
    }

    function versionPaymaster() external override virtual view returns (string memory){
        return "2.0.1+opengsn.token.ipaymaster";
    }

    mapping (address => bool) public tokens;

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    relayHubOnly
    returns (bytes memory context, bool revertOnRecipientRevert) {
        address payer = relayRequest.relayData.forwarder;
        require(tokens[relayRequest.request.tokenContract], "Token contract not allowed");
        IERC20 token = IERC20(relayRequest.request.tokenContract);
        uint256 tokenAmount = relayRequest.request.tokenAmount;
        require(tokenAmount <= token.balanceOf(payer), "balance too low");

        // Check for the codehash of the smart wallet sent
        {
            bytes32 smartWalletCodeHash;
            assembly { smartWalletCodeHash := extcodehash(payer) }

            bytes32 swTemplateCodeHash = ProxyFactory(factory).getRuntimeCodeHash();
            
            require(swTemplateCodeHash == smartWalletCodeHash, "SW different to template");
        }

        //We dont do that here
        //token.transferFrom(payer, address(this), tokenPrecharge);
        return (abi.encode(payer, tokenAmount, token), true);
    }

    /* solhint-disable no-empty-blocks */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    virtual
    relayHubOnly {
        // for now we dont produce any refund
        // so there is nothing to be done here
    }
    /* solhint-enable no-empty-blocks */

    function acceptToken(address token) external onlyOwner {
        tokens[token] = true;
    }
}
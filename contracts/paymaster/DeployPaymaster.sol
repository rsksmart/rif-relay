// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../factory/ProxyFactory.sol";
import "./BasePaymaster.sol";

/**
 * A paymaster to be used on deploys.
 * - We maintain the interface but not the functions, mainly to be
 * - GSN compatible
 */
contract DeployPaymaster is BasePaymaster {

    address private factory;

    constructor(address proxyFactory) public {
        factory = proxyFactory;
    }

    function versionPaymaster() external override virtual view returns (string memory){
        return "2.0.1+opengsn.token.ipaymaster";
    }

    mapping (address => bool) public tokens;

    /* solhint-disable no-unused-vars */
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
        require(tokens[relayRequest.request.tokenContract], "Token contract not allowed");
        IERC20 token = IERC20(relayRequest.request.tokenContract);

        require(relayRequest.request.factory == factory, "factory should be the trusted one!");

        address contractAddr = ProxyFactory(relayRequest.request.factory)
            .getSmartWalletAddress(
            relayRequest.request.from, 
            relayRequest.request.recoverer, 
            relayRequest.request.to, 
            (relayRequest.request.data.length == 0 ? bytes32(0) : keccak256(relayRequest.request.data)), 
            relayRequest.request.index);

        require(!GsnUtils._isContract(contractAddr), "Address already created!");
        require(relayRequest.request.tokenAmount <= token.balanceOf(contractAddr), "balance too low");

        //We dont do that here
        //token.transferFrom(payer, address(this), tokenPrecharge);
        return (abi.encode(contractAddr, relayRequest.request.tokenAmount, token), true);
    }
    /* solhint-ensable no-unused-vars */

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
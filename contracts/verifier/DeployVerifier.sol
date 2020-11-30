// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../factory/ProxyFactory.sol";
import "./BaseVerifier.sol";
import "../utils/GsnUtils.sol";

/**
 * A Verifier to be used on deploys.
 * - We maintain the interface but not the functions, mainly to be
 * - GSN compatible
 */
contract DeployVerifier is BaseVerifier {

    address private factory;
    uint public override acceptanceBudget;
    mapping (address => bool) public tokens;

    constructor(address proxyFactory) public {
        factory = proxyFactory;
    }

    function versionVerifier() external override virtual view returns (string memory){
        return "rif.enveloping.token.iverifier@2.0.1";
    }


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
    returns (bytes memory context) 
{
        require(tokens[relayRequest.request.tokenContract], "Token contract not allowed");
        require(relayRequest.relayData.callForwarder == factory, "Invalid factory");

        address contractAddr = ProxyFactory(relayRequest.relayData.callForwarder)
            .getSmartWalletAddress(
            relayRequest.request.from, 
            relayRequest.request.recoverer, 
            relayRequest.request.to, 
            keccak256(relayRequest.request.data), 
            relayRequest.request.index);

        require(!GsnUtils._isContract(contractAddr), "Address already created!");

        IERC20 token = IERC20(relayRequest.request.tokenContract);
        require(relayRequest.request.tokenAmount <= token.balanceOf(contractAddr), "balance too low");

        //We dont do that here
        //token.transferFrom(payer, address(this), tokenPrecharge);
        return (abi.encode(contractAddr, relayRequest.request.tokenAmount, token));
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
     {
     // for now we dont produce any refund
        // so there is nothing to be done here
    }

    function acceptToken(address token) external onlyOwner {
        tokens[token] = true;
    }

    function setAcceptanceBudget(uint256 budget) external onlyOwner {
        acceptanceBudget = budget;
    }
}
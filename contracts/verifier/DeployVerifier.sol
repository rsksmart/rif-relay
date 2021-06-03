// SPDX-License-Identifier:MIT
// solhint-disable no-inline-assembly
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../factory/SmartWalletFactory.sol";
import "../interfaces/IDeployVerifier.sol";
import "../interfaces/ITokenHandler.sol";
import "../interfaces/EnvelopingTypes.sol";

/**
 * A Verifier to be used on deploys.
 */
contract DeployVerifier is IDeployVerifier, ITokenHandler, Ownable {

    address private factory;
    mapping (address => bool) public tokens;
    address[] public acceptedTokens;

    constructor(address walletFactory) public {
        factory = walletFactory;
    }

    function versionVerifier() external override virtual view returns (string memory){
        return "rif.enveloping.token.iverifier@2.0.1";
    }

    /* solhint-disable no-unused-vars */
    function verifyRelayedCall(
        EnvelopingTypes.DeployRequest calldata relayRequest,
        bytes calldata signature
    )
    external 
    override 
    virtual
    returns (bytes memory context) 
    {
        require(tokens[relayRequest.request.tokenContract], "Token contract not allowed");
        require(relayRequest.relayData.callForwarder == factory, "Invalid factory");

        address contractAddr = SmartWalletFactory(relayRequest.relayData.callForwarder)
            .getSmartWalletAddress(
            relayRequest.request.from, 
            relayRequest.request.recoverer, 
            relayRequest.request.index);

        require(!_isContract(contractAddr), "Address already created!");

        if(relayRequest.request.tokenContract != address(0)){
            require(relayRequest.request.tokenAmount <= IERC20(relayRequest.request.tokenContract).balanceOf(contractAddr), "balance too low");
        }

        return (abi.encode(contractAddr, relayRequest.request.tokenAmount, relayRequest.request.tokenContract));
    }

    function acceptToken(address token) external onlyOwner {
        require(token != address(0), "Token cannot be zero address");
        tokens[token] = true;
        acceptedTokens.push(token);
    }

    function getAcceptedTokens() external override view returns (address[] memory){
        return acceptedTokens;
    }

    function acceptsToken(address token) external override view returns (bool){
        return tokens[token];
    }

    /**
     * Check if a contract has code in it
     * Should NOT be used in a contructor, it fails
     * See: https://stackoverflow.com/a/54056854
     */
    function _isContract(address _addr) internal view returns (bool){
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }
}

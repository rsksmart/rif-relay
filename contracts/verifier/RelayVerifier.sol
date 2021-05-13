// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IWalletFactory.sol";
import "../interfaces/IRelayVerifier.sol";

/* solhint-disable no-inline-assembly */
/* solhint-disable avoid-low-level-calls */

/**
 * A verifier for relay transactions.
 */
contract RelayVerifier is IRelayVerifier, Ownable {
    using SafeMath for uint256;

    address private factory;
    event AllowedToken(address indexed tokenAddress);

    constructor(address walletFactory) public {
        factory = walletFactory;
    }

    function versionVerifier() external override virtual view returns (string memory){
        return "rif.enveloping.token.iverifier@2.0.1";
    }

    mapping (address => bool) public tokens;

    /* solhint-disable no-unused-vars */
    function verifyRelayedCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
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

        require(IWalletFactory(factory).runtimeCodeHash() == smartWalletCodeHash, "SW different to template");

        return (abi.encode(payer, relayRequest.request.tokenAmount, relayRequest.request.tokenContract));
    }

    function acceptToken(address token) external onlyOwner {
        require(token != address(0), "Token cannot be zero address");
        tokens[token] = true;
        emit AllowedToken(token);
    }
}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IDeployVerifier.sol";
import "../interfaces/ITokenHandler.sol";

contract TestDeployVerifierEverythingAccepted is IDeployVerifier, ITokenHandler {

    function versionVerifier() external view override virtual returns (string memory){
        return "2.0.1+enveloping.test-pea.iverifier";
    }

    event SampleRecipientPreCall();
    event SampleRecipientPostCall(bool success);

    mapping (address => bool) public tokens;
    address[] public acceptedTokens;

    function verifyRelayedCall(
        /* solhint-disable-next-line no-unused-vars */
        EnvelopingTypes.DeployRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    override
    virtual
    returns (bytes memory) {
        (signature, relayRequest);
        emit SampleRecipientPreCall();
        return ("no revert here");
    }

    function acceptToken(address token) external {
        require(token != address(0), "Token cannot be zero address");
        require(tokens[token] == false, "Token is already accepted");
        tokens[token] = true;
        acceptedTokens.push(token);
    }

    function getAcceptedTokens() external override view returns (address[] memory){
        return acceptedTokens;
    }

    function acceptsToken(address token) external override view returns (bool){
        return tokens[token];
    }
}

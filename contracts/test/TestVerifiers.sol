// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IRelayVerifier.sol";

contract TestVerifiers {

    event Deposited(address indexed verifier, address indexed from, uint256 amount);
    event Accepted(uint256 tokenAmount, address from);

    IRelayVerifier public verifierContract;

    constructor ( address verifier) public {
        verifierContract =  IRelayVerifier(verifier);
    }

    function verifyRelayedCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    virtual
    returns (bytes memory context) {
        (context) = verifierContract.verifyRelayedCall(relayRequest, signature);
        emit Accepted(relayRequest.request.tokenAmount, relayRequest.request.from);
    }

    function depositFor(address target) public payable {
        emit Deposited(target, msg.sender, msg.value);
    }
}

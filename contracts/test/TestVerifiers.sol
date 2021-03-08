// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IVerifier.sol";

contract TestVerifiers {

    event Deposited(address indexed verifier, address indexed from, uint256 amount);
    event Accepted(uint256 tokenAmount, address from);

    IVerifier public verifierContract;

    constructor ( address verifier) public {
        verifierContract =  IVerifier(verifier);
    }

    function preRelayedCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    virtual
    returns (bytes memory context) {
        (context) = verifierContract.preRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
        emit Accepted(relayRequest.request.tokenAmount, relayRequest.request.from);
    }

    function depositFor(address target) public payable {
        emit Deposited(target, msg.sender, msg.value);
    }
}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IDeployVerifier.sol";

contract TestDeployVerifier {

    event Deposited(address indexed verifier, address indexed from, uint256 amount);
    event Accepted(uint256 tokenAmount, address from);

    IDeployVerifier public verifierContract;

    constructor ( address verifier) public {
        verifierContract =  IDeployVerifier(verifier);
    }

    function verifyRelayedCall(
        EnvelopingTypes.DeployRequest calldata deployRequest,
        bytes calldata signature
    )
    external
    virtual
    returns (bytes memory context) {
        (context) = verifierContract.verifyRelayedCall(deployRequest, signature);
        emit Accepted(deployRequest.request.tokenAmount, deployRequest.request.from);
    }

    function depositFor(address target) public payable {
        emit Deposited(target, msg.sender, msg.value);
    }
}

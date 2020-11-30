// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IPaymaster.sol";

contract TestPaymasters {

    event Deposited(address indexed paymaster, address indexed from, uint256 amount);
    event Accepted(uint256 tokenAmount, address from);

    IPaymaster public paymasterContract;

    constructor ( address paymaster) public {
        paymasterContract =  IPaymaster(paymaster);
    }

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    virtual
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (context, revertOnRecipientRevert) = paymasterContract.preRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
        emit Accepted(relayRequest.request.tokenAmount, relayRequest.request.from);
    }

    function depositFor(address target) public payable {
        emit Deposited(target, msg.sender, msg.value);
    }
}

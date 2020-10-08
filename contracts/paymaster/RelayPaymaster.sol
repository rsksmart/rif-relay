// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../forwarder/IForwarder.sol";
import "./EnvelopingBasePaymaster.sol";

/**
 * A paymaster for relay transactions.
 * - each request is paid for by the caller.
 * - acceptRelayedCall - verify the caller can pay for the request in tokens.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract RelayPaymaster is EnvelopingBasePaymaster {
    using SafeMath for uint256;

    function versionPaymaster() external override virtual view returns (string memory){
        return "2.0.0-beta.1+opengsn.token.ipaymaster";
    }

    IERC20[] public tokens;

    uint public gasUsedByPost;

    /**
     * set gas used by postRelayedCall, for proper gas calculation.
     * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall)
     */
    function setPostGasUsage(uint _gasUsedByPost) external onlyOwner {
        gasUsedByPost = _gasUsedByPost;
    }

    // return the payer of this request.
    // for account-based target, this is the target account.
    function getPayer(GsnTypes.EnvelopingRequest calldata envelopingRequest) public virtual view returns (address) {
        (this);
        return envelopingRequest.request.from;
    }

    function getToken(GsnTypes.EnvelopingRequest calldata envelopingRequest) public virtual view returns (IERC20) {
        (this);
        return IERC20(envelopingRequest.request.tokenContract);
    }

    function getTokenAmount(GsnTypes.EnvelopingRequest calldata envelopingRequest) public virtual view returns (uint256) {
        (this);
        return envelopingRequest.request.tokenAmount;
    }

    event Received(uint eth);
    receive() external override payable {
        emit Received(msg.value);
    }

    function preRelayedCallInternal(
        GsnTypes.EnvelopingRequest calldata envelopingRequest
    )
    public
    returns (bytes memory context, bool revertOnRecipientRevert) {
        address payer = this.getPayer(envelopingRequest);
        IERC20 token = this.getToken(envelopingRequest);
        uint256 tokenAmount = this.getTokenAmount(envelopingRequest);

        _verifyForwarder(envelopingRequest);

        require(GsnUtils._isContract(payer), "Addr MUST be a contract");

        require(tokenAmount <= token.balanceOf(payer), "balance too low");
        //We dont do that here
        //token.transferFrom(payer, address(this), tokenPrecharge);
        return (abi.encode(payer, tokenAmount, token), true);
    }

     function preRelayedCall(
        GsnTypes.EnvelopingRequest calldata envelopingRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    relayHubOnly
    returns (bytes memory context, bool revertOnRecipientRevert) {
        return preRelayedCallInternal(envelopingRequest);
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.EnvelopingRequest calldata envelopingRequest
    )
    external
    override
    virtual
    relayHubOnly {
        // for now we dont produce any refund
        // so there is nothing to be done here
    }

    event TokensCharged(uint gasUseWithoutPost, uint gasJustPost, uint ethActualCharge, uint tokenActualCharge);
}
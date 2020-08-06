pragma solidity ^0.5.5;

import "../GsnUtils.sol";
import "../IRelayHub.sol";
import "../RelayRecipient.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

contract Counter is RelayRecipient, Ownable {
    mapping(address => uint) private count;

    constructor(IRelayHub rhub) public {
        setRelayHub(rhub);
    }

    function deposit() public payable {
        getRelayHub().depositFor.value(msg.value)(address(this));
    }

    function withdraw(address payable dest) public onlyOwner {
        uint256 balance = getRelayHub().balanceOf(address(this));
        getRelayHub().withdraw(balance, dest);
        msg.sender.transfer(balance);
    }

    function() external payable {}

    function reset() public {
        address sender = getSender();
        count[sender] = 0;
    }

    function get() public view returns (uint) {
        address sender = getSender();
        return count[sender];
    }

    function increment() public {
        address sender = getSender();
        count[sender]++;
    }

    function acceptRelayedCall(address relay, address from, bytes calldata encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes calldata approvalData, uint256 maxPossibleCharge) external view returns (uint256, bytes memory) {
        return (0, "");
    }

    function preRelayedCall(bytes calldata context) external returns (bytes32)
    {
        return "";
    }

    function postRelayedCall(bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal) external
    {
    }
}

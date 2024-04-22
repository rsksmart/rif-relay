// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

import "@rsksmart/rif-relay-contracts/contracts/interfaces/NativeSwap.sol";

contract TestSwap is NativeSwap {

    uint8 constant public version = 3;

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public TYPEHASH_REFUND;

    mapping (bytes32 => bool) public override swaps;

    function addSwap(bytes32 hash) public {
        swaps[hash] = true;
    }

    function claim(
        bytes32 preimage,
        uint amount,
        address refundAddress,
        uint timelock
    ) external {
        claim(preimage, amount, msg.sender, refundAddress, timelock);
    }

    function claim(
        bytes32 preimage,
        uint amount,
        address claimAddress,
        address refundAddress,
        uint timelock
    ) public {

        bytes32 preimageHash = sha256(abi.encodePacked(preimage));

        bytes32 hash = hashValues(
            preimageHash,
            amount,
            claimAddress,
            refundAddress,
            timelock
        );

        checkSwapIsLocked(hash);

        delete swaps[hash];

        (bool success, ) = payable(claimAddress).call{value: amount}("");
        require(success, "Could not transfer RBTC");
    }

    function hashValues(
        bytes32 preimageHash,
        uint amount,
        address claimAddress,
        address refundAddress,
        uint timelock
    ) public override pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            preimageHash,
            amount,
            claimAddress,
            refundAddress,
            timelock
        ));
    }

    function checkSwapIsLocked(bytes32 hash) private view {
        require(swaps[hash] == true, "NativeSwap: swap has no RBTC");
    }

     // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

}
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

import "@rsksmart/rif-relay-contracts/contracts/interfaces/NativeSwap.sol";

contract TestSwap is NativeSwap {

    uint8 constant public version = 3;

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public TYPEHASH_REFUND;

    event Lockup(
        bytes32 indexed preimageHash,
        uint amount,
        address claimAddress,
        address indexed refundAddress,
        uint timelock
    );


    mapping (bytes32 => bool) public override swaps;

    function lock(
        bytes32 preimageHash,
        address claimAddress,
        address refundAddress,
        uint timelock
    ) external payable {
        _lockEther(preimageHash, msg.value, claimAddress, refundAddress, timelock);
    }


    function _lockEther(bytes32 preimageHash, uint amount, address claimAddress, address refundAddress, uint timelock) private {
        // Locking zero WEI in the contract is pointless
        require(amount > 0, "EtherSwap: locked amount must not be zero");

        // Hash the values of the swap
        bytes32 hash = hashValues(
            preimageHash,
            amount,
            claimAddress,
            refundAddress,
            timelock
        );

        // Make sure no swap with this value hash exists yet
        require(swaps[hash] == false, "EtherSwap: swap exists already");

        // Save to the state that funds were locked for this swap
        swaps[hash] = true;

        // Emit the "Lockup" event
        emit Lockup(preimageHash, amount, claimAddress, refundAddress, timelock);
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

        _checkSwapIsLocked(hash);

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

    function _checkSwapIsLocked(bytes32 hash) private view {
        require(swaps[hash] == true, "NativeSwap: swap has no RBTC");
    }
}
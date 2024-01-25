// SPDX-License-Identifier:MIT
// solhint-disable no-inline-assembly
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@rsksmart/rif-relay-contracts/contracts/factory/SmartWalletFactory.sol";
import "@rsksmart/rif-relay-contracts/contracts/interfaces/IDeployVerifier.sol";
import "@rsksmart/rif-relay-contracts/contracts/interfaces/EnvelopingTypes.sol";
import "@rsksmart/rif-relay-contracts/contracts/TokenHandler.sol";

struct ClaimInfo {
    bytes32 preimage;
    uint amount;
    address refundAddress;
    uint timelock;
}

/**
 * A Verifier to be used on deploys.
 */
contract BoltzDeployVerifier is IDeployVerifier, TokenHandler {
    address private _factory;

    constructor(address walletFactory) public {
        _factory = walletFactory;
    }

    function versionVerifier()
        external
        view
        virtual
        override
        returns (string memory)
    {
        return "rif.enveloping.token.iverifier@2.0.1";
    }

    /* solhint-disable no-unused-vars */
    function verifyRelayedCall(
        EnvelopingTypes.DeployRequest calldata relayRequest,
        bytes calldata signature
    ) external virtual override returns (bytes memory context) {
        require(
            relayRequest.relayData.callForwarder == _factory,
            "Invalid factory"
        );

        address contractAddr = SmartWalletFactory(
            relayRequest.relayData.callForwarder
        ).getSmartWalletAddress(
                relayRequest.request.from,
                relayRequest.request.recoverer,
                relayRequest.request.index
            );

        require(!_isContract(contractAddr), "Address already created!");

        if (relayRequest.request.tokenContract != address(0)) {
            require(
                tokens[relayRequest.request.tokenContract],
                "Token contract not allowed"
            );
            
            require(
                relayRequest.request.tokenAmount <=
                    IERC20(relayRequest.request.tokenContract).balanceOf(
                        contractAddr
                    ),
                "Token balance too low"
            );
        } else {
            if(relayRequest.request.to != address(0)){
                ClaimInfo memory claim = abi.decode(
                    relayRequest.request.data[4:],
                    (ClaimInfo)
                );
    
                require(
                    relayRequest.request.tokenAmount <= claim.amount,
                    "Native balance too low"
                );
            }else{
                require(
                    relayRequest.request.tokenAmount <= address(contractAddr).balance,
                    "Native balance too low"
                );
            }
        }

        return (
            abi.encode(
                contractAddr,
                relayRequest.request.tokenAmount,
                relayRequest.request.tokenContract
            )
        );
    }

    /**
     * Check if a contract has code in it
     * Should NOT be used in a contructor, it fails
     * See: https://stackoverflow.com/a/54056854
     */
    function _isContract(address _addr) internal view returns (bool) {
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }
}

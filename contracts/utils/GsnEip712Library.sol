// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/GsnTypes.sol";
import "../interfaces/IForwarder.sol";
import "../factory/ISmartWalletFactory.sol";
import "./MinLibBytes.sol";
/**
 * Bridge Library to map Enveloping RelayRequest into a call of a SmartWallet
 */
library GsnEip712Library {


    function execute(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature) internal returns (bool forwarderSuccess, uint256 lastSuccTx, bytes memory ret) {

        if(relayRequest.relayData.isSmartWalletDeploy){
            // The gas limit for the deploy creation is injected here, since the gasCalculation
            // estimate is done against the whole relayedUserSmartWalletCreation function in
            // the relayClient

            /* solhint-disable-next-line avoid-low-level-calls */
            (forwarderSuccess,) = relayRequest.relayData.callForwarder.call{gas: relayRequest.request.gas}(
                abi.encodeWithSelector(ISmartWalletFactory.relayedUserSmartWalletCreation.selector,
                relayRequest.request, relayRequest.relayData.domainSeparator, 
                keccak256("RelayRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenContract,uint256 tokenAmount,address recoverer,uint256 index,RelayData relayData)RelayData(bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)"),
                hashRelayData(relayRequest.relayData), signature
            ));
        }
        else{
            /* solhint-disable-next-line avoid-low-level-calls */
            (forwarderSuccess, ret) = relayRequest.relayData.callForwarder.call(
                abi.encodeWithSelector(IForwarder.execute.selector,
                relayRequest.request, relayRequest.relayData.domainSeparator,
                keccak256("RelayRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenContract,uint256 tokenAmount,address recoverer,uint256 index,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)"), 
                hashRelayData(relayRequest.relayData), signature
                ));
            
            if ( forwarderSuccess ) {
                (lastSuccTx, ret) = abi.decode(ret, (uint256, bytes)); // decode return value of execute:
            }

            MinLibBytes.truncateInPlace(ret, 1024); // maximum length of return value/revert reason for 'execute' method. Will truncate result if exceeded.
        }
    }


    function hashRelayData(GsnTypes.RelayData calldata req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                keccak256("RelayData(uint256 gasPrice,bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)"), // RELAYDATA_TYPEHASH
                req.gasPrice,
                req.domainSeparator,
                req.isSmartWalletDeploy,
                req.relayWorker,
                req.callForwarder,
                req.callVerifier
            ));
    }
}

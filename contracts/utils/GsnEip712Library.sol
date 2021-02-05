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



  function deploy(GsnTypes.DeployRequest calldata relayRequest, bytes calldata signature) internal returns (bool deploySuccess) {

            // The gas limit for the deploy creation is injected here, since the gasCalculation
            // estimate is done against the whole relayedUserSmartWalletCreation function in
            // the relayClient

            /* solhint-disable-next-line avoid-low-level-calls */
            (deploySuccess,) = relayRequest.relayData.callForwarder.call{gas: relayRequest.request.gas}(
                abi.encodeWithSelector(ISmartWalletFactory.relayedUserSmartWalletCreation.selector,
                relayRequest.request, relayRequest.relayData.domainSeparator, 
                keccak256("RelayRequest(address relayHub,address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenContract,uint256 tokenAmount,address recoverer,uint256 index,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)"),
                hashRelayData(relayRequest.relayData), signature
            ));
        
    }

    //forwarderSuccess = Did the call to IForwarder.execute() revert or not?
    //relaySuccess = Did the destination-contract call revert or not?
    //ret = if !forwarderSuccess it is the revert reason of IForwarder, otherwise it is the destination-contract return data, wich might be
    // a revert reason if !relaySuccess
    function execute(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature) internal returns (bool forwarderSuccess, bool relaySuccess, bytes memory ret) {
            /* solhint-disable-next-line avoid-low-level-calls */
            (forwarderSuccess, ret) = relayRequest.relayData.callForwarder.call(
                abi.encodeWithSelector(IForwarder.execute.selector,
                relayRequest.request, relayRequest.relayData.domainSeparator,
                keccak256("RelayRequest(address relayHub,address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenContract,uint256 tokenAmount,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)"), 
                hashRelayData(relayRequest.relayData), signature
                ));
            
            if ( forwarderSuccess ) {
                (relaySuccess, ret) = abi.decode(ret, (bool, bytes)); // decode return value of execute:
            }

            MinLibBytes.truncateInPlace(ret, 1024); // maximum length of return value/revert reason for 'execute' method. Will truncate result if exceeded.
    }


    function hashRelayData(GsnTypes.RelayData calldata req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                keccak256("RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)"), // RELAYDATA_TYPEHASH
                req.gasPrice,
                req.domainSeparator,
                req.relayWorker,
                req.callForwarder,
                req.callVerifier
            ));
    }
}

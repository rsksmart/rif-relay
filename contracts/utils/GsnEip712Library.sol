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

    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256("RelayRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 tokenAmount,address recoverer,uint256 index,RelayData relayData)RelayData(uint256 gasPrice,uint256 clientId,bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)");


    function splitRequest(
        GsnTypes.RelayRequest calldata req
    )
    internal
    pure
    returns (
        IForwarder.ForwardRequest memory forwardRequest,
        bytes32 suffixData
    ) {
        forwardRequest = IForwarder.ForwardRequest(
            req.request.from,
            req.request.to,
            req.request.value,
            req.request.gas,
            req.request.nonce,
            req.request.data,
            req.request.tokenRecipient,
            req.request.tokenContract,
            req.request.tokenAmount,
            req.request.recoverer,
            req.request.index
        );
        suffixData = hashRelayData(req.relayData);
    }

   function verifySignature(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature) internal view returns(bool callSuccess){
        (IForwarder.ForwardRequest memory forwardRequest, bytes32 suffixData) = splitRequest(relayRequest);

        (callSuccess,) = relayRequest.relayData.callForwarder.staticcall(
            abi.encodeWithSelector(
                IForwarder.verify.selector,
                forwardRequest,
                relayRequest.relayData.domainSeparator,
                RELAY_REQUEST_TYPEHASH,
                suffixData,
                signature
            )
        );
    }


    function execute(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature) internal returns (bool forwarderSuccess, bool callSuccess, uint256 lastSuccTx, bytes memory ret) {
        (IForwarder.ForwardRequest memory forwardRequest, bytes32 suffixData) = splitRequest(relayRequest);


        if(relayRequest.relayData.isSmartWalletDeploy){
            //The gas limit for the deploy creation is injected here, since the gasCalculation
            //estimate is done against the whole relayedUserSmartWalletCreation function in
            //the relayClient
            /* solhint-disable-next-line avoid-low-level-calls */
            (forwarderSuccess,) = relayRequest.relayData.callForwarder.call{gas: forwardRequest.gas}(
                abi.encodeWithSelector(ISmartWalletFactory.relayedUserSmartWalletCreation.selector,
                forwardRequest, relayRequest.relayData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, signature
            ));
        }
        else{
                /* solhint-disable-next-line avoid-low-level-calls */
                (forwarderSuccess, ret) = relayRequest.relayData.callForwarder.call(
                abi.encodeWithSelector(IForwarder.execute.selector,
                forwardRequest, relayRequest.relayData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, signature
                ));
            
                if ( forwarderSuccess ) {
                    //decode return value of execute:
                    (callSuccess, lastSuccTx, ret) = abi.decode(ret, (bool, uint256, bytes));
                }

                MinLibBytes.truncateInPlace(ret, 1024); // maximum length of return value/revert reason for 'execute' method. Will truncate result if exceeded.
        }
    }


    function hashRelayData(GsnTypes.RelayData calldata req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                keccak256("RelayData(uint256 gasPrice,uint256 clientId,bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)"), // RELAYDATA_TYPEHASH
                req.gasPrice,
                req.clientId,
                req.domainSeparator,
                req.isSmartWalletDeploy,
                req.relayWorker,
                req.callForwarder,
                req.callVerifier
            ));
    }
}

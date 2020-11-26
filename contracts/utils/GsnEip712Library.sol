// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/GsnTypes.sol";
import "../forwarder/IForwarder.sol";
import "../factory/IProxyFactory.sol";
import "./MinLibBytes.sol";
/**
 * Bridge Library to map Enveloping RelayRequest into a call of a SmartWallet
 */
library GsnEip712Library {

    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256("RelayRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 tokenAmount,address factory,address recoverer,uint256 index,RelayData relayData)RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster,address forwarder,bytes paymasterData,uint256 clientId)");
    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

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
            req.request.factory,
            req.request.recoverer,
            req.request.index
        );
        suffixData = hashRelayData(req.relayData);
    }

    //verify that the recipient trusts the given forwarder
    // MUST be called by paymaster

   function verifySignature(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature) internal view returns(bool callSuccess){
        (IForwarder.ForwardRequest memory forwardRequest, bytes32 suffixData) = splitRequest(relayRequest);

        (callSuccess,) = relayRequest.relayData.forwarder.staticcall(
            abi.encodeWithSelector(
                IForwarder.verify.selector,
                forwardRequest,
                domainSeparator(relayRequest.relayData.forwarder),
                RELAY_REQUEST_TYPEHASH,
                suffixData,
                signature
            )
        );
    }


    function execute(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature) internal returns (bool forwarderSuccess, bool callSuccess, uint256 lastSuccTx, bytes memory ret) {
        (IForwarder.ForwardRequest memory forwardRequest, bytes32 suffixData) = splitRequest(relayRequest);


        if(address(0) == forwardRequest.factory){
            /* solhint-disable-next-line avoid-low-level-calls */
            (forwarderSuccess, ret) = relayRequest.relayData.forwarder.call(
                abi.encodeWithSelector(IForwarder.execute.selector,
                forwardRequest, domainSeparator(relayRequest.relayData.forwarder), RELAY_REQUEST_TYPEHASH, suffixData, signature
            ));
            
            if ( forwarderSuccess ) {
                //decode return value of execute:
                //ret includes
                (callSuccess, lastSuccTx, ret) = abi.decode(ret, (bool, uint256, bytes));
            }
            truncateInPlace(ret);
        }
        else {
            // Deploy of smart wallet
            //The gas limit for the deploy creation is injected here, since the gasCalculation
            //estimate is done against the whole relayedUserSmartWalletCreation function in
            //the relayClient
            /* solhint-disable-next-line avoid-low-level-calls */
            (forwarderSuccess,) = forwardRequest.factory.call{gas: forwardRequest.gas}(
                abi.encodeWithSelector(IProxyFactory.relayedUserSmartWalletCreation.selector,
                forwardRequest, domainSeparator(forwardRequest.factory), RELAY_REQUEST_TYPEHASH, suffixData, signature
            ));
        }
    }

    //truncate the given parameter (in-place) if its length is above the given maximum length
    // do nothing otherwise.
    //NOTE: solidity warns unless the method is marked "pure", but it DOES modify its parameter.
    function truncateInPlace(bytes memory data) internal pure {
        MinLibBytes.truncateInPlace(data, 1024); // maximum length of return value/revert reason for 'execute' method. Will truncate result if exceeded.
    }

    function domainSeparator(address verifier) internal pure returns (bytes32) {
        return hashDomain(EIP712Domain({
            name : "RSK Enveloping Transaction",
            version : "2",
            chainId : getChainID(),
            verifyingContract : verifier
            }));
    }

    function getChainID() internal pure returns (uint256 id) {
        /* solhint-disable no-inline-assembly */
        assembly {
            id := chainid()
        }
    }

    function hashDomain(EIP712Domain memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), // EIP712DOMAIN_TYPEHASH
                keccak256(bytes(req.name)),
                keccak256(bytes(req.version)),
                req.chainId,
                req.verifyingContract));
    }

    function hashRelayData(GsnTypes.RelayData calldata req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                keccak256("RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster,address forwarder,bytes paymasterData,uint256 clientId)"), // RELAYDATA_TYPEHASH
                req.gasPrice,
                req.pctRelayFee,
                req.baseRelayFee,
                req.relayWorker,
                req.paymaster,
                req.forwarder,
                keccak256(req.paymasterData),
                req.clientId
            ));
    }
}

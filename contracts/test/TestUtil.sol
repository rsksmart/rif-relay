// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../interfaces/GsnTypes.sol";
import "../utils/GsnEip712Library.sol";
import "../utils/GsnUtils.sol";

contract TestUtil {

    function libRelayRequestName() public pure returns (string memory) {
        return GsnEip712Library.RELAY_REQUEST_NAME;
    }

    function libRelayRequestType() public pure returns (string memory) {
        return string(GsnEip712Library.RELAY_REQUEST_TYPE);
    }

    function libRelayRequestTypeHash() public pure returns (bytes32) {
        return GsnEip712Library.RELAY_REQUEST_TYPEHASH;
    }

    function libRelayRequestSuffix() public pure returns (string memory) {
        return GsnEip712Library.RELAY_REQUEST_SUFFIX;
    }

    //helpers for test to call the library funcs:
    function callForwarderVerify(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    view {
        GsnEip712Library.verify(relayRequest, signature);
    }

    function callForwarderVerifyAndCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    returns (
        bool success,
        bytes memory ret,
        uint256 lastSuccTx
    ) {
        bool forwarderSuccess;
        (forwarderSuccess, success, ret, lastSuccTx) = GsnEip712Library.execute(relayRequest, signature);
        if ( !forwarderSuccess) {
            GsnUtils.revertWithData(ret);
        }
        emit Called(success, success == false ? ret : bytes(""), lastSuccTx);
    }

    event Called(bool success, bytes error, uint256 lastSuccTx);

    function splitRequest(
        GsnTypes.RelayRequest calldata relayRequest
    )
    external
    pure
    returns (
        IForwarder.ForwardRequest memory forwardRequest,
        bytes32 typeHash,
        bytes memory suffixData
    ) {
        (forwardRequest, suffixData) = GsnEip712Library.splitRequest(relayRequest);
        typeHash = GsnEip712Library.RELAY_REQUEST_TYPEHASH;
    }

    function libDomainSeparator(address forwarder) public pure returns (bytes32) {
        return GsnEip712Library.domainSeparator(forwarder);
    }

    function libGetChainID() public pure returns (uint256) {
        return GsnEip712Library.getChainID();
    }

    function libEncodedDomain(address forwarder) public pure returns (bytes memory) {
        GsnEip712Library.EIP712Domain memory req = GsnEip712Library.EIP712Domain({
            name : "GSN Relayed Transaction",
            version : "2",
            chainId : libGetChainID(),
            verifyingContract : forwarder
        });
        return abi.encode(
                GsnEip712Library.EIP712DOMAIN_TYPEHASH,
                keccak256(bytes(req.name)),
                keccak256(bytes(req.version)),
                req.chainId,
                req.verifyingContract
        );
    }

    function libEncodedData(GsnTypes.RelayData memory req) public pure returns (bytes memory) {
        return abi.encode(
                GsnEip712Library.RELAYDATA_TYPEHASH,
                req.gasPrice,
                req.pctRelayFee,
                req.baseRelayFee,
                req.relayWorker,
                req.paymaster,
                req.forwarder,
                keccak256(req.paymasterData),
                req.clientId
        );
    }

    function libEncodedRequest(
            IForwarder.ForwardRequest memory req, 
            bytes32 requestTypeHash,
            bytes32 suffixData) public pure returns (bytes memory) {
                
        return abi.encodePacked(
            requestTypeHash,
            abi.encode(
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                keccak256(req.data)
            ),
            suffixData
        );
    }

    // -------------------------------------------------------------------
    // Prototype code: signature verification of multiple relay requests
    // -------------------------------------------------------------------

    struct SplittedRelayRequest {
        IForwarder.ForwardRequest request;
        bytes32 encodedRelayData;
    }

    function mockExecute(
            GsnTypes.RelayRequest[] memory relayRequests, 
            address forwarder, 
            bytes memory signature) public pure returns (bytes32) {

        SplittedRelayRequest[] memory splittedRequests = new SplittedRelayRequest[](relayRequests.length);
        for (uint i = 0; i < relayRequests.length; i++) {
            splittedRequests[i] = SplittedRelayRequest({
                request: relayRequests[i].request,
                encodedRelayData: hashRelayData(relayRequests[i].relayData)
            });
        }

        bytes32 domainSeparator = keccak256(libEncodedDomain(forwarder));
        return eip712EncodeV4(splittedRequests, domainSeparator, signature);
    }

    function eip712EncodeV4(
            SplittedRelayRequest[] memory splittedRequests,
            bytes32 domainSeparator,
            bytes memory signature) public pure returns (bytes32 encoding) {

        bytes memory encodedSplittedRequests = encodeSplittedRequests(splittedRequests);
        encoding = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            keccak256(encodedSplittedRequests)
        ));
        // TODO: who the well signs the incomiong set of relay requests?
        // require(digest.recover(signature) == req.from, "signature mismatch");
    }

    function encodeSplittedRequests(
            SplittedRelayRequest[] memory splittedRequests) public pure returns (bytes memory) {

        bytes memory encoding = new bytes(32 * splittedRequests.length);
        for (uint i = 0; i < splittedRequests.length; i++) {
            bytes memory requestEncoding = libEncodedRequest(
                splittedRequests[i].request, 
                GsnEip712Library.RELAY_REQUEST_TYPEHASH,
                splittedRequests[i].encodedRelayData);
            bytes32 hashedRequestEncoding = keccak256(requestEncoding);
            uint ix = (i + 1) << 5;
            assembly {
                mstore(add(encoding, ix), hashedRequestEncoding)
            }
        }

        bytes32 encodingHash = keccak256(encoding);
        return abi.encodePacked(GsnEip712Library.MULTI_RELAY_REQUEST_TYPEHASH, encodingHash);
    }

    function hashRelayData(GsnTypes.RelayData memory req) internal pure returns (bytes32) {
        return keccak256(libEncodedData(req));
    }
}

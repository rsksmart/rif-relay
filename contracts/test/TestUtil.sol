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
        bytes memory ret
    ) {
        bool forwarderSuccess;
        uint256 lastSuccTx;
        (forwarderSuccess, success, lastSuccTx, ret) = GsnEip712Library.execute(relayRequest, signature);
        if ( !forwarderSuccess) {
            GsnUtils.revertWithData(ret);
        }
        emit Called(success, success == false ? ret : bytes(""));
    }

    event Called(bool success, bytes error);

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
}

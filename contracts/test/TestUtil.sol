// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/GsnTypes.sol";
import "../utils/GsnEip712Library.sol";
import "../utils/GsnUtils.sol";

contract TestUtil {


     bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256("RelayRequest(address relayHub,address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenContract,uint256 tokenAmount,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)");

    //helpers for test to call the library funcs:
    function callForwarderVerify(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    view {

            //(bool callSuccess,) = 
           relayRequest.relayData.callForwarder.staticcall(
            abi.encodeWithSelector(
                IForwarder.verify.selector,
                relayRequest.relayData.domainSeparator,
                GsnEip712Library.hashRelayData(relayRequest.relayData),
                relayRequest.request,
                signature
            )
        );
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

        (forwarderSuccess, success, ret) = GsnEip712Library.execute(relayRequest, signature);
        
       if ( !forwarderSuccess) {
           GsnUtils.revertWithData(ret);
        }
        
        emit Called(success, success == false ? ret : bytes(""));
    }

    event Called(bool success, bytes error);


    function splitRequest(
        GsnTypes.RelayRequest calldata req
    )
    external
    pure
    returns (
        IForwarder.ForwardRequest memory forwardRequest,
        bytes32 typeHash,
        bytes32 suffixData
    ) {
        forwardRequest = IForwarder.ForwardRequest(
            req.request.relayHub,
            req.request.from,
            req.request.to,
            req.request.tokenContract,
            req.request.value,
            req.request.gas,
            req.request.nonce,
            req.request.tokenAmount,
            req.request.data
        );
        suffixData = GsnEip712Library.hashRelayData(req.relayData);
        typeHash = RELAY_REQUEST_TYPEHASH;
    }




    function libGetChainID() public pure returns (uint256 id) {
        /* solhint-disable no-inline-assembly */
        assembly {
            id := chainid()
        }
    }

}

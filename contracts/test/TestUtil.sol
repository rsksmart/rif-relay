// SPDX-License-Identifier:MIT
// solhint-disable no-inline-assembly
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/EnvelopingTypes.sol";
import "../utils/Eip712Library.sol";

contract TestUtil {
    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256("RelayRequest(address relayHub,address from,address to,address tokenContract,uint256 value,uint256 gas,uint256 nonce,uint256 tokenAmount,uint256 tokenGas,bytes data,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)");

    //helpers for test to call the library funcs:
    function callForwarderVerify(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    view {

            //(bool callSuccess,) = 
           relayRequest.relayData.callForwarder.staticcall(
            abi.encodeWithSelector(
                IForwarder.verify.selector,
                relayRequest.relayData.domainSeparator,
                Eip712Library.hashRelayData(relayRequest.relayData),
                relayRequest.request,
                signature
            )
        );
    }

    function callForwarderVerifyAndCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    returns (
        bool success,
        bytes memory ret
    ) {
        bool forwarderSuccess;

        (forwarderSuccess, success, ret) = Eip712Library.execute(relayRequest, signature);
        
       if (!forwarderSuccess) {
           revertWithData(ret);
        }
        
        emit Called(success, success == false ? ret : bytes(""));
    }

    event Called(bool success, bytes error);

    //re-throw revert with the same revert data.
    function revertWithData(bytes memory data) internal pure {
        assembly {
            revert(add(data,32), mload(data))
        }
    }

    function splitRequest(
        EnvelopingTypes.RelayRequest calldata req
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
            req.request.tokenGas,
            req.request.enableQos,
            req.request.data
        );
        suffixData = Eip712Library.hashRelayData(req.relayData);
        typeHash = RELAY_REQUEST_TYPEHASH;
    }

    function libGetChainID() public pure returns (uint256 id) {
        assembly {
            id := chainid()
        }
    }
}

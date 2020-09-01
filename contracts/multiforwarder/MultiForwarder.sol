// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./IMultiForwarder.sol";

contract MultiForwarder is IMultiForwarder {
    using ECDSA for bytes32;

    string public constant GENERIC_PARAMS = "address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data";

    mapping(bytes32 => bool) public typeHashes;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    function getNonce(address from)
    public view override
    returns (uint256) {
        return nonces[from];
    }

    constructor() public {
        string memory requestType = string(abi.encodePacked("ForwardRequest(", GENERIC_PARAMS, ")"));
        registerRequestTypeInternal(requestType);
    }

    function verify(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes calldata suffixData,
        bytes calldata sig)
    external override view {
        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }


    function execute(
        ForwardRequestDetail[] memory reqList
    )
    external payable
    override
    returns (uint256 lastSuccTx, bytes memory lastRetTx, uint256 gasUsedByLastTx) {

        uint256 remainingGas = gasleft();

        for (uint i = 0; i < reqList.length; i++) {
            ForwardRequestDetail memory reqDetail = reqList[i];
            ForwardRequest memory req = reqDetail.req;
            _verifySig(req, reqDetail.domainSeparator, reqDetail.requestTypeHash, reqDetail.suffixData, reqDetail.signature);
            _verifyNonce(req);
            _updateNonce(req);

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory ret) = req.to.call{gas : req.gas, value : req.value}(abi.encodePacked(req.data, req.from));
            // TODO: currently, relayed transaction does not report exception string. when it does, this
            // will propagate the inner call exception description

            lastRetTx = ret;

            if (address(this).balance>0 ) {
                //can't fail: req.from signed (off-chain) the request, so it must be an EOA...
                payable(req.from).transfer(address(this).balance);
            }

            if (!success){
                // re-throw the revert with the same revert reason.
                // GsnUtils.revertWithData(ret);
                break;
            }
            
            lastSuccTx = i+1;
            gasUsedByLastTx = remainingGas - gasleft();
            remainingGas = gasleft();
        }

        return (lastSuccTx, lastRetTx, gasUsedByLastTx);
    }


    function _verifyNonce(ForwardRequest memory req) internal view {
        require(nonces[req.from] == req.nonce, "nonce mismatch");
    }

    function _updateNonce(ForwardRequest memory req) internal {
        nonces[req.from]++;
    }

    function registerRequestType(string calldata typeName, string calldata typeSuffix) external override {

        for (uint i = 0; i < bytes(typeName).length; i++) {
            bytes1 c = bytes(typeName)[i];
            require(c != "(" && c != ")", "invalid typename");
        }

        string memory requestType = string(abi.encodePacked(typeName, "(", GENERIC_PARAMS, ",", typeSuffix));
        registerRequestTypeInternal(requestType);
    }

    function registerRequestTypeInternal(string memory requestType) internal {

        bytes32 requestTypehash = keccak256(bytes(requestType));
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, string(requestType));
    }


    event RequestTypeRegistered(bytes32 indexed typeHash, string typeStr);


    function _verifySig(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes memory suffixData,
        bytes memory sig)
    internal
    view
    {

        require(typeHashes[requestTypeHash], "invalid request typehash");
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", domainSeparator,
                keccak256(_getEncoded(req, requestTypeHash, suffixData))
            ));
        require(digest.recover(sig) == req.from, "signature mismatch");
    }

    function _getEncoded(
        ForwardRequest memory req,
        bytes32 requestTypeHash,
        bytes memory suffixData
    )
    public
    pure
    returns (
        bytes memory
    ) {
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

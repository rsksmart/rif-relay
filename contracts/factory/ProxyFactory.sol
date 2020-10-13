// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.12 <0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./IProxyFactory.sol";

//import "@nomiclabs/buidler/console.sol";
/* solhint-disable no-inline-assembly */
/* solhint-disable avoid-low-level-calls */

/**
====================================================================================================================================================
                                           Documentation of the Proxy Code being deployed 
====================================================================================================================================================
A simple proxy that delegates every call to an address.
This ProxyA is the one instantiated per smart wallet, and it will receive the Forwarder as MC. So every call
made to this proxy will end up in MC.
MC is controlled by the same developer who created the factory, and .
For the transaction execution (execute() call), MC will do the signature verification and payment. Then it will 
execute the request, and, if a logic was defined, it will forward the flow to it before returning.




====================================================================================================================================================
                                                            PROXY A
====================================================================================================================================================
                                                    Constructor
====================================================================================================================================================
PC | OPCODE|   Mnemonic     |   Stack [top, bottom]                      | Comments
----------------------------------------------------------------------------------------------------------------------------------------------------
0  | 60 2D | PUSH1 2D       | [45]                                       | Size of runtime code
2  | 3D    | RETURNDATASIZE | [0, 45]                                    | Before any external call, returdatasize = 0 (cheaper than PUSH1 00)
3  | 81    | DUP2           | [45, 0, 45]                                |
4  | 60 09 | PUSH1 09       | [9, 45, 0, 45]                             | Size of constructor code
6  | 3D    | RETURNDATASIZE | [0, 9, 45, 0, 45]                          | 
7  | 39    | CODECOPY       | [0, 45]                                    | Mem[0:44] = address(this).code[9:53]
8  | F3    | RETURN         | []                                         | return Mem[0:44]                   

====================================================================================================================================================
                                                    Runtime Code
====================================================================================================================================================
PC | OPCODE|   Mnemonic     |   Stack [top, bottom]                       | Comments
----------------------------------------------------------------------------------------------------------------------------------
0  | 36    | CALLDATASIZE   | [msg.data.size]                             |
1  | 3D    | RETURNDATASIZE | [0, msg.data.size]                          |
2  | 3D    | RETURNDATASIZE | [0, 0, msg.data.size]                       |
3  | 37    | CALLDATACOPY   | []                                          | Mem[0:msg.data.size-1] = msg.data[0:msg.data.size-1]
4  | 3D    | RETURNDATASIZE | [0]                                         |
5  | 3D    | RETURNDATASIZE | [0, 0]                                      |
6  | 3D    | RETURNDATASIZE | [0, 0, 0]                                   |
7  | 3D    | RETURNDATASIZE | [0, 0, 0, 0]                                |
8  | 36    | CALLDATASIZE   | [msg.data.size, 0, 0, 0, 0]                 |
9  | 3D    | RETURNDATASIZE | [0, msg.data.size, 0, 0, 0, 0]              |
10 | 73 MC | PUSH20 MC      | [mcAddr,0, msg.data.size, 0, 0, 0, 0]       | mcAddr = address of master Copy, injected by factory
31 | 5A    | GAS            | [rGas, mcAddr,0, msg.data.size, 0, 0, 0, 0] | rGas = remaining gas
32 | F4    | DELEGATECALL   | [isSuccess, 0, 0]                           | isSuccess, Mem[0:0] = address(mcAddr).delegateCall.gas(rGas)(Mem[0:msg.data.size-1])
33 | 3D    | RETURNDATASIZE | [rds, isSuccess, 0, 0]                      | rds = size of what the logic called returned
34 | 92    | SWAP3          | [0, isSuccess, 0, rds]                      |
35 | 3D    | RETURNDATASIZE | [rds, 0, isSuccess, 0, rds]                 |
36 | 90    | SWAP1          | [0, rds, isSuccess, 0, rds]                 |
37 | 80    | DUP1           | [0, 0, rds, isSuccess, 0, rds]              |
38 | 3E    | RETURNDATACOPY | [isSuccess, 0, rds]                         | Mem[0:rds-1] = RETURNDATA[0:rds-1]
39 | 60 2B | PUSH1 2B       | [43, isSuccess, 0, rds]                     |
41 | 57    | JUMPI          | [0, rds]                                    | if(isSuccess) then jump to PC=43
42 | FD    | REVERT         | []                                          | revert(Mem[0, rds-1])
43 | 5B    | JUMPDEST       | [0, rds]                                    |
44 | F3    | RETURN         | []                                          | return(Mem[0, rds-1])
 */


/**Factory of Proxies to the SmartWallet (Forwarder)
The Forwarder itself is a Template with portions delegated to a custom logic (it is also a proxy) */
contract ProxyFactory is IProxyFactory {
    using ECDSA for bytes32;

    //change to internal after debug
    address public masterCopy; // this is the ForwarderProxy contract that will be proxied
    mapping(bytes32 => bool) public typeHashes;
    mapping(bytes32 => bool) public domains;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    event Deployed(address addr, uint256 salt); //Event triggered when a deploy is successful

    string public constant FORWARDER_PARAMS = "address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 tokenAmount,address factory";
    string public constant EIP712_DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

    /**
     * @param forwarderTemplate It implements all the payment and execution needs,
     * it pays for the deployment during initialization, and it pays for the transaction
     * execution on each execute() call.
     * It also acts a a proxy to a logic contract. Any unrecognized function will be forwarded to this custom logic (if it exists)
     */
    constructor(address forwarderTemplate) public {
        masterCopy = forwarderTemplate;
       
        string memory requestType = string(abi.encodePacked("ForwardRequest(", FORWARDER_PARAMS, ")"));
        registerRequestTypeInternal(requestType);

    }

    function getNonce(address from) public override view returns (uint256) {
        return nonces[from];
    }

    function createUserSmartWallet(
        address owner,
        address logic,
        bytes calldata initParams,
        bytes calldata sig
    ) external override {
        bytes memory packed = abi.encodePacked(
            "\x19\x10",
            owner,
            logic,
            initParams
        );

        bytes32 digest = keccak256(packed);
        require(digest.recover(sig) == owner, string(packed));

        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));

        //772d909b  =>  initialize(address owner,address logic,address tokenAddr,bytes initParams,bytes transferData)  
        bytes memory initData = abi.encodeWithSelector(
            hex"772d909b",
            owner,
            logic,
            address(0),
            initParams,
            hex"00"
        );

        deploy(getCreationBytecode(), salt, initData, gasleft());
    }

    function relayedUserSmartWalletCreation(
        IForwarder.ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes calldata suffixData,
        bytes calldata sig
    ) external override{


        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        _updateNonce(req);

        bytes32 salt = keccak256(
            abi.encodePacked(req.from, req.to, req.data)
        );

        //772d909b  =>  initialize(address owner,address logic,address tokenAddr,bytes initParams,bytes transferData)  
        //a9059cbb = transfer(address _to, uint256 _value) public returns (bool success)
        //initParams (req.data) must not contain the function selector for the logic initialization function
        bytes memory initData = abi.encodeWithSelector(
            hex"772d909b",
            req.from,
            req.to,
            req.tokenContract,
            req.data,
            abi.encodeWithSelector(
                hex"a9059cbb",
                req.tokenRecipient,
                req.tokenAmount
            )
        );

        deploy(getCreationBytecode(), salt, initData, req.gas);
    }

    /**
     * Calculates the Smart Wallet address for an owner EOA, wallet logic, and specific initialization params
     * @param owner - EOA of the owner of the smart wallet
     * @param logic - Custom logic to use in the smart wallet (address(0) if no extra logic needed)
     * @param initParams - If there's a custom logic, these are the params to call initialize(bytes) (function sig must not be included)
     */
    function getSmartWalletAddress(
        address owner,
        address logic,
        bytes memory initParams
    ) external override view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));

        bytes32 result = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(getCreationBytecode())
            )
        );

        return address(uint256(result));
    }

    function deploy(
        bytes memory code,
        bytes32 salt,
        bytes memory initdata,
        uint256 gasToUse
    ) internal returns (address addr) {
        //bytes memory pointerTo;
        //uint256 size;

        //Deployment of the Smart Wallet
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }

            /*size := extcodesize(addr)
            pointerTo := mload(0x40)
            mstore(
                0x40,
                add(pointerTo, and(add(add(size, 0x20), 0x1f), not(0x1f)))
            )
            mstore(pointerTo, size)
            extcodecopy(addr, add(pointerTo, 0x20), 0, size)*/
        }

        //Since the init code determines the address of the smart wallet, any initialization
        //require is done via the runtime code, to avoid the parameters impacting on the resulting address

        (bool success, ) = addr.call{gas:gasToUse}(initdata);
        require(success);

        //No info is returned, an event is emitted to inform the new deployment
        emit Deployed(addr, uint256(salt));
    }

    // Returns the proxy code to that is deployed on every Smart Wallet creation
    function getCreationBytecode() public view returns (bytes memory) {

            bytes memory payloadStart
         = hex"602D3D8160093D39F3363D3D373D3D3D3D363D73";
        bytes memory payloadEnd = hex"5AF43D923D90803E602B57FD5BF3";

        //The code to install
        return abi.encodePacked(payloadStart, masterCopy, payloadEnd);
    }

    function _getEncoded(
        IForwarder.ForwardRequest memory req,
        bytes32 requestTypeHash,
        bytes memory suffixData
    ) public pure returns (bytes memory) {
        return abi.encodePacked(
            requestTypeHash,
            abi.encode(
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                keccak256(req.data),
                req.tokenRecipient,
                req.tokenContract,
                req.tokenAmount,
                req.factory
            ),
            suffixData
        );
    }

    function _verifySig(
        IForwarder.ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes memory suffixData,
        bytes memory sig
    ) internal view {
        require(domains[domainSeparator], "unregistered domain separator");
        require(typeHashes[requestTypeHash], "unregistered request typehash");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(_getEncoded(req, requestTypeHash, suffixData))
            )
        );
        require(digest.recover(sig) == req.from, "signature mismatch");
    }

    function _verifyNonce(IForwarder.ForwardRequest memory req) internal view {
        require(nonces[req.from] == req.nonce, "nonce mismatch");
    }

    function _updateNonce(IForwarder.ForwardRequest memory req) internal {
        nonces[req.from]++;
    }

    function registerRequestTypeInternal(string memory requestType) internal {
        bytes32 requestTypehash = keccak256(bytes(requestType));
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, string(requestType));
    }

    function registerRequestType(
        string calldata typeName,
        string calldata typeSuffix
    ) external  {
        for (uint256 i = 0; i < bytes(typeName).length; i++) {
            bytes1 c = bytes(typeName)[i];
            require(c != "(" && c != ")", "invalid typename");
        }

        bytes memory suffixBytes = bytes(typeSuffix);

        if (suffixBytes.length == 0) {
            string memory requestType = string(
                abi.encodePacked(typeName, "(", FORWARDER_PARAMS, ")")
            );
            registerRequestTypeInternal(requestType);
        } else {
            string memory requestType = string(
                abi.encodePacked(typeName, "(", FORWARDER_PARAMS, ",", typeSuffix)
            );
            registerRequestTypeInternal(requestType);
        }
    }

    function registerDomainSeparator(string calldata name, string calldata version) external {
        uint256 chainId;
        /* solhint-disable-next-line no-inline-assembly */
        assembly { chainId := chainid() }

        bytes memory domainValue = abi.encode(
            keccak256(bytes(EIP712_DOMAIN_TYPE)),
            keccak256(bytes(name)),
            keccak256(bytes(version)),
            chainId,
            address(this));

        bytes32 domainHash = keccak256(domainValue);

        domains[domainHash] = true;
        emit DomainRegistered(domainHash, domainValue);
    }

    event RequestTypeRegistered(bytes32 indexed typeHash, string typeStr);
    event DomainRegistered(bytes32 indexed domainSeparator, bytes domainValue);

}

// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../interfaces/ICustomSmartWalletFactory.sol";
import "../utils/RSKAddrValidator.sol";

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

/** Factory of Proxies to the CustomSmartWallet (Forwarder)
The Forwarder itself is a Template with portions delegated to a custom logic (it is also a proxy) */
contract CustomSmartWalletFactory is ICustomSmartWalletFactory {
    using ECDSA for bytes32;
 
    bytes11 private constant RUNTIME_START = hex"363D3D373D3D3D3D363D73";
    bytes14 private constant RUNTIME_END = hex"5AF43D923D90803E602B57FD5BF3";
    address public masterCopy; // this is the ForwarderProxy contract that will be proxied
    bytes32 public constant DATA_VERSION_HASH = keccak256("2");

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    /**
     * @param forwarderTemplate It implements all the payment and execution needs,
     * it pays for the deployment during initialization, and it pays for the transaction
     * execution on each execute() call.
     * It also acts a a proxy to a logic contract. Any unrecognized function will be forwarded to this custom logic (if it exists)
     */
    constructor(address forwarderTemplate) public {
        masterCopy = forwarderTemplate;
    }


    function runtimeCodeHash() external override view returns (bytes32){
        return keccak256(
            abi.encodePacked(RUNTIME_START, masterCopy, RUNTIME_END)
        );
    }

    function nonce(address from) public view override returns (uint256) {
        return nonces[from];
    }

    function createUserSmartWallet(
        address owner,
        address recoverer,
        address logic,
        uint256 index,
        bytes calldata initParams,
        bytes calldata sig
    ) external override {
        bytes memory packed =
            abi.encodePacked(
                "\x19\x10",
                owner,
                recoverer,
                logic,
                index,
                initParams
            );
        (sig);
        require(
            RSKAddrValidator.safeEquals(keccak256(packed).recover(sig), owner),
            "Invalid signature"
        );

        //e6ddc71a  =>  initialize(address owner,address logic,address tokenAddr,address tokenRecipient,uint256 tokenAmount,uint256 tokenGas,bytes initParams)
        bytes memory initData =
            abi.encodeWithSelector(
                hex"e6ddc71a",
                owner,
                logic,
                address(0), // This "gas-funded" call does not pay with tokens
                address(0),
                0,
                0, //No token transfer
                initParams
            );

        deploy(
            getCreationBytecode(),
            keccak256(
                abi.encodePacked(
                    owner,
                    recoverer,
                    logic,
                    keccak256(initParams),
                    index
                )
            ),
            initData
        );
    }

    function relayedUserSmartWalletCreation(
        IForwarder.DeployRequest memory req,
        bytes32 domainSeparator,
        bytes32 suffixData,
        bytes calldata sig
    ) external override {
        (sig);
        require(msg.sender == req.relayHub, "Invalid caller");
        _verifySig(req, domainSeparator, suffixData, sig);
        nonces[req.from]++;

        //e6ddc71a  =>  initialize(address owner,address logic,address tokenAddr,address tokenRecipient,uint256 tokenAmount,uint256 tokenGas,bytes initParams)
        //a9059cbb = transfer(address _to, uint256 _value) public returns (bool success)
        //initParams (req.data) must not contain the function selector for the logic initialization function
        /* solhint-disable avoid-tx-origin */
        deploy(
            getCreationBytecode(),
            keccak256(
                abi.encodePacked(
                    req.from,
                    req.recoverer,
                    req.to,
                    keccak256(req.data),
                    req.index
                )
            ),
            abi.encodeWithSelector(
                hex"e6ddc71a",
                req.from,
                req.to,
                req.tokenContract,
                tx.origin,
                req.tokenAmount,
                req.tokenGas,
                req.enableQos,
                req.data
            )
        );
    }

    /**
     * Calculates the Smart Wallet address for an owner EOA, wallet logic, and specific initialization params
     * @param owner - EOA of the owner of the smart wallet
     * @param recoverer - Address of that can be used by some contracts to give specific roles to the caller (e.g, a recoverer)
     * @param logic - Custom logic to use in the smart wallet (address(0) if no extra logic needed)
     * @param initParamsHash - If there's a custom logic, these are the params to call initialize(bytes) (function sig must not be included). Only the hash value is passed
     * @param index - Allows to create many addresses for the same owner|recoverer|logic|initParams
     */
    function getSmartWalletAddress(
        address owner,
        address recoverer,
        address logic,
        bytes32 initParamsHash,
        uint256 index
    ) external view override returns (address) {
        return
            address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(this),
                                keccak256(
                                    abi.encodePacked(
                                        owner,
                                        recoverer,
                                        logic,
                                        initParamsHash,
                                        index
                                    )
                                ),
                                keccak256(getCreationBytecode())
                            )
                        )
                    )
                )
            );
    }

    function deploy(
        bytes memory code,
        bytes32 salt,
        bytes memory initdata
    ) internal returns (address addr) {
        //Deployment of the Smart Wallet
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }

        //Since the init code determines the address of the smart wallet, any initialization
        //required is done via the runtime code, to avoid the parameters impacting on the resulting address

        /* solhint-disable-next-line avoid-low-level-calls */
        (bool success, ) = addr.call(initdata);

        require(success, "Unable to initialize SW");

        //No info is returned, an event is emitted to inform the new deployment
        emit Deployed(addr, uint256(salt));
    }

    // Returns the proxy code to that is deployed on every Smart Wallet creation
    function getCreationBytecode() public view override returns (bytes memory) {
        //The code to install:  constructor, runtime start, master copy, runtime end
        return
            abi.encodePacked(
                hex"602D3D8160093D39F3",
                RUNTIME_START,
                masterCopy,
                RUNTIME_END
            );
    }

    function _getEncoded(
        IForwarder.DeployRequest memory req,
        bytes32 suffixData
    ) public pure returns (bytes memory) {
        return
            abi.encodePacked(
                keccak256(
                    "RelayRequest(address relayHub,address from,address to,address tokenContract,address recoverer,uint256 value,uint256 nonce,uint256 tokenAmount,uint256 tokenGas,bool enableQos,uint256 index,bytes data,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)"
                ),
                abi.encode(
                    req.relayHub,
                    req.from,
                    req.to,
                    req.tokenContract,
                    req.recoverer,
                    req.value,
                    req.nonce,
                    req.tokenAmount,
                    req.tokenGas,
                    req.enableQos,
                    req.index,
                    keccak256(req.data)
                ),
                suffixData
            );
    }

    function getChainID() internal pure returns (uint256 id) {
        /* solhint-disable no-inline-assembly */
        assembly {
            id := chainid()
        }
    }

    function _verifySig(
        IForwarder.DeployRequest memory req,
        bytes32 domainSeparator,
        bytes32 suffixData,
        bytes memory sig
    ) internal view {
        //Verify nonce
        require(nonces[req.from] == req.nonce, "nonce mismatch");

        //Verify Domain separator
        require(
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ), //EIP712DOMAIN_TYPEHASH
                    keccak256("RSK Enveloping Transaction"), // DOMAIN_NAME
                    DATA_VERSION_HASH,
                    getChainID(),
                    address(this)
                )
            ) == domainSeparator,
            "Invalid domain separator"
        );

        require(
            RSKAddrValidator.safeEquals(
                keccak256(
                    abi.encodePacked(
                        "\x19\x01",
                        domainSeparator,
                        keccak256(_getEncoded(req, suffixData))
                    )
                )
                    .recover(sig),
                req.from
            ),
            "signature mismatch"
        );
    }
}

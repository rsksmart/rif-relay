
// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.4.16 <0.8.0;


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
1  | 60 2D | PUSH1 2D       | [45]                                       | Size of runtime code
3  | 3D    | RETURNDATASIZE | [0, 45]                                    | Before any external call, returdatasize = 0 (cheaper than PUSH1 00)
4  | 81    | DUP2           | [45, 0, 45]                                |
5  | 60 09 | PUSH1 09       | [9, 45, 0, 45]                             | Size of constructor code
7  | 3D    | RETURNDATASIZE | [0, 9, 45, 0, 45]                          | 
8  | 39    | CODECOPY       | [0, 45]                                    | Mem[0:44] = address(this).code[9:53]
9  | F3    | RETURN         | []                                         | return Mem[0:44]                   

====================================================================================================================================================
                                                    Runtime Code
====================================================================================================================================================
PC | OPCODE|   Mnemonic     |   Stack [top, bottom]                       | Comments
----------------------------------------------------------------------------------------------------------------------------------
1  | 36    | CALLDATASIZE   | [msg.data.size]                             |
2  | 3D    | RETURNDATASIZE | [0, msg.data.size]                          |
3  | 3D    | RETURNDATASIZE | [0, 0, msg.data.size]                       |
4  | 37    | CALLDATACOPY   | []                                          | Mem[0:msg.data.size-1] = msg.data[0:msg.data.size-1]
5  | 3D    | RETURNDATASIZE | [0]                                         |
6  | 3D    | RETURNDATASIZE | [0, 0]                                      |
7  | 3D    | RETURNDATASIZE | [0, 0, 0]                                   |
8  | 3D    | RETURNDATASIZE | [0, 0, 0, 0]                                |
9  | 36    | CALLDATASIZE   | [msg.data.size, 0, 0, 0, 0]                 |
10 | 3D    | RETURNDATASIZE | [0, msg.data.size, 0, 0, 0, 0]              |
11 | 73 MC | PUSH20 MC      | [mcAddr,0, msg.data.size, 0, 0, 0, 0]       | mcAddr = address of master Copy, injected by factory
32 | 5A    | GAS            | [rGas, mcAddr,0, msg.data.size, 0, 0, 0, 0] | rGas = remaining gas
33 | F4    | DELEGATECALL   | [isSuccess, 0, 0]                           | isSuccess, Mem[0:0] = address(mcAddr).delegateCall.gas(rGas)(Mem[0:msg.data.size-1])
34 | 3D    | RETURNDATASIZE | [rds, isSuccess, 0, 0]                      | rds = size of what the logic called returned
35 | 92    | SWAP3          | [0, isSuccess, 0, rds]                      |
36 | 3D    | RETURNDATASIZE | [rds, 0, isSuccess, 0, rds]                 |
37 | 90    | SWAP1          | [0, rds, isSuccess, 0, rds]                 |
38 | 80    | DUP1           | [0, 0, rds, isSuccess, 0, rds]              |
39 | 3E    | RETURNDATACOPY | [isSuccess, 0, rds]                         | Mem[0:rds-1] = RETURNDATA[0:rds-1]
40 | 60 2D | PUSH1 2D       | [45, isSuccess, 0, rds]                     |
42 | 57    | JUMPI          | [0, rds]                                    | if(isSuccess) then jump to PC=45
43 | FD    | REVERT         | []                                          | revert(Mem[0, rds-1])
44 | 5B    | JUMPDEST       | [0, rds]                                    |
45 | F3    | RETURN         | []                                          | return(Mem[0, rds-1])
 */
/**Factory of Proxies to the SmartWallet (Forwarder)
The Forwarder itself is a Template with portions delegated to a custom logic (it is also a proxy) */
contract ProxyFactory {
   
    address internal masterCopy; // this is the ForwarderProxy contract that will be proxied

    event Deployed(address addr, uint256 salt); //Event triggered when a deploy is successful



    /**
    * @param forwarderTemplate It implements all the payment and execution needs,
    * it pays for the deployment during initialization, and it pays for the transaction
    * execution on each execute() call.
    * It also acts a a proxy to a logic contract. Any unrecognized function will be forwarded to this custom logic (if it exists)
    */
    constructor(address forwarderTemplate) public{
        masterCopy = forwarderTemplate;
    }


/**
* It deploys a SmartWallet for a User (EOA) 
*
* @param owner - The EOA that will own the Smart Wallet
*
* @param logic - The code that will be used to inject custom functionality to the Smart Wallet
*
* @param paymentToken - The token that will be used to pay for the deployment of the Smart Wallet
* 
* @param recipient - The beneficiary of the payment
*
* @param deployPrice - The amount of tokens to pay for the deployment
*
* @param initParams - Any parameters needed for the logic to initialize.
* They must NOT include the function signature, which is predefined as : initialize(bytes) = 439fab91
*
* @param sig - Signature of the parameters above, made by the owner
*/

    function createUserSmartWallet(
        address owner,
        address logic,
        address paymentToken,
        address recipient,
        uint256 deployPrice,
        bytes memory initParams,
        bytes memory sig
    ) external {

        // recover the address by proving ownership EIP-191-like
        //EIP-191: 0x19 + version, in this case 0x10 for version.
        bytes memory packed = abi.encodePacked(
            "\x19\x10",
            owner,
            logic,
            paymentToken,
            recipient,
            deployPrice,
            initParams
        );

        bytes32 digest = keccak256(packed);

        //uint256 salt = uint256(addr);
        // digest.recover(sig) does not work, maybe it needs some library
        address recovered = recoverSigner(digest, sig);

        require(recovered == owner, "signature mismatch");

        // The initialization (first call) will set addr as an external owner of this account.
        //The same could be performed with dynamic CREATE2 derivation in the target contract,
        //but it’s a bit more expensive each time (compared with a one time setting here).

        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));

        //fb618e21 = initialize(address owner, address forwarder, address tokenAddr, bytes memory transferData (funcSig + recipient + price), bytes memory initParams) external {}
        //a9059cbb = transfer(address _to, uint256 _value) public returns (bool success)

        //initParams must not contain the function signature
        bytes memory initData = abi.encodePacked(hex"fb618e21", owner, logic, paymentToken, hex"a9059cbb",recipient, deployPrice, initParams);

        deploy(
            getCreationBytecode(),
            salt,
            initData
        );
    }


    /**
    * Calculates the Smart Wallet address for an owner EOA, wallet logic, and specific initialization params
    * @param owner - EOA of the owner of the smart wallet
    * @param logic - Custom logic to use in the smart wallet (address(0) if no extra logic needed)
    * @param initParams - If there's a custom logic, these are the params to call initialize(bytes) (function sig must not be included)
    */
    function getAddress(address owner, address logic, bytes memory initParams) external view returns (address){

        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));
        bytes32 result = keccak256(abi.encodePacked(hex"ff",address(this),salt,keccak256(getCreationBytecode())));

        assembly {
            let ptr := mload(0x40) //Next free-memory uint8 slot
            mstore(ptr, result) 
            return(add(ptr, 0xC),0x14) // result[12:] => Mem[ptr:ptr+11] = discarded; Mem[ptr+12: ptr+31] = create2_address (20 bytes); 12=0xC, 20=0x14
        }

    }

    function deploy(
        bytes memory code,
        bytes32 salt,
        bytes memory initdata
    ) internal returns (address addr) {

        //Deployment of the Smart Wallet
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }

       
        //Since the init code determines the address of the smwart wallet, any initialization
        //require is done via the runtime code, to avoid the parameters impacting on the resulting address
        (bool success, ) = addr.call(initdata);
        require(success);

        //No info is returned, an event is emitted to inform the new deployment
        emit Deployed(addr, uint256(salt));
    }




    // Returns the proxy code to that is deployed on every Smart Wallet creation
    function getCreationBytecode() public view returns (bytes memory) {

        //constructorCode = hex"602D3D8160093D39F3";
        //runtimeCodeBeforeAddress = hex"363D3D373D3D3D3D363D73";
        //runtimeCodeAfterAddress = hex"5AF43D923D90803E602D57FD5BF3";


        bytes memory payloadStart = hex"602D3D8160093D39F3363D3D373D3D3D3D363D73";
        bytes memory payloadEnd = hex"5AF43D923D90803E602D57FD5BF3";

        //The code to install
        return abi.encodePacked(payloadStart, masterCopy, payloadEnd);
    }


    /// signature methods.
    function splitSignature(bytes memory sig)
        internal
        pure
        returns (
            uint8 v,
            bytes32 r,
            bytes32 s
        )
    {
        require(sig.length == 65);

        assembly {
            // first 32 bytes, after the length prefix.
            r := mload(add(sig, 32))
            // second 32 bytes.
            s := mload(add(sig, 64))
            // final byte (first byte of the next 32 bytes).
            v := byte(0, mload(add(sig, 96)))
        }

        return (v, r, s);
    }

    function recoverSigner(bytes32 message, bytes memory sig)
        internal
        pure
        returns (address)
    {
        (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);

        return ecrecover(message, v, r, s);
    }
}



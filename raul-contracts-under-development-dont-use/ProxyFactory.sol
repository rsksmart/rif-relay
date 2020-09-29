// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.12 <0.8.0;

import "@nomiclabs/buidler/console.sol";

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
39 | 60 2C | PUSH1 2C       | [43, isSuccess, 0, rds]                     |
41 | 57    | JUMPI          | [0, rds]                                    | if(isSuccess) then jump to PC=43
42 | FD    | REVERT         | []                                          | revert(Mem[0, rds-1])
43 | 5B    | JUMPDEST       | [0, rds]                                    |
44 | F3    | RETURN         | []                                          | return(Mem[0, rds-1])
 
 
 
 
 
 
 */
/**Factory of Proxies to the SmartWallet (Forwarder)
The Forwarder itself is a Template with portions delegated to a custom logic (it is also a proxy) */
contract ProxyFactory {
    //change to internal after debug
    address public masterCopy; // this is the ForwarderProxy contract that will be proxied

    event Deployed(address addr, uint256 salt); //Event triggered when a deploy is successful
    event DebugInfo(string reason, bytes content);

    /**
     * @param forwarderTemplate It implements all the payment and execution needs,
     * it pays for the deployment during initialization, and it pays for the transaction
     * execution on each execute() call.
     * It also acts a a proxy to a logic contract. Any unrecognized function will be forwarded to this custom logic (if it exists)
     */
    constructor(address forwarderTemplate) public {
        masterCopy = forwarderTemplate;
    }



    function createUserSmartWallet(
        address owner,
        address logic,
        uint256 logicInitGas,
        bytes calldata initParams,
        bytes calldata sig
    ) external {
        
         bytes memory packed = abi.encodePacked(
            "\x19\x10",
            owner,
            logic,
            logicInitGas,
            initParams
        );

        bytes32 digest = keccak256(packed);

        address recovered = recoverSigner(digest, sig);
        console.log("Recovered address:", recovered);
        require(recovered == owner, string(packed));

        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));
        
        console.log("Calculated salt");
        console.logBytes32(salt);

        bytes memory initData = abi.encodeWithSelector(
            hex"36c3d85a",
            owner,
            logic,
            address(0),
            logicInitGas,
            initParams,
            hex"00"
        );

        console.log("initData");
        console.logBytes(initData);

        deploy(getCreationBytecode(), salt, initData);
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
    function delegateUserSmartWalletCreation(
        address owner,
        address logic,
        address paymentToken,
        address recipient,
        uint256 deployPrice,
        uint256 logicInitGas,
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
            logicInitGas,
            initParams
        );
        

        console.log("MESSAGE.DATA");
        console.logBytes(msg.data);

        bytes32 digest = keccak256(packed);

        //uint256 salt = uint256(addr);
        // digest.recover(sig) does not work, maybe it needs some library
        address recovered = recoverSigner(digest, sig);
        console.log("Recovered address:", recovered);

        require(recovered == owner, string(packed));

        // The initialization (first call) will set addr as an external owner of this account.
        //The same could be performed with dynamic CREATE2 derivation in the target contract,
        //but it’s a bit more expensive each time (compared with a one time setting here).

        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));
        console.log("Calculated salt");
        console.logBytes32(salt);

        //17eb58b8 = initialize(address owner, address logic, address tokenAddr, uint256 logicInitGas, bytes memory initParams, bytes memory transferData (funcSig + recipient + price)) external {}
        //a9059cbb = transfer(address _to, uint256 _value) public returns (bool success)

        //initParams must not contain the function signature
        bytes memory initData = abi.encodeWithSelector(
            hex"17eb58b8",
            owner,
            logic,
            paymentToken,
            logicInitGas,
            initParams,
            abi.encodeWithSelector(hex"a9059cbb", recipient, deployPrice)  
        );

        console.log("initData");
        console.logBytes(initData);

        deploy(getCreationBytecode(), salt, initData);
    }

    /**
     * Calculates the Smart Wallet address for an owner EOA, wallet logic, and specific initialization params
     * @param owner - EOA of the owner of the smart wallet
     * @param logic - Custom logic to use in the smart wallet (address(0) if no extra logic needed)
     * @param initParams - If there's a custom logic, these are the params to call initialize(bytes) (function sig must not be included)
     */
    function getAddress(
        address owner,
        address logic,
        bytes memory initParams
    ) external returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(owner, logic, initParams));
        bytes32 result = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(getCreationBytecode())
            )
        );

        assembly {
            let ptr := mload(0x40) //Next free-memory uint8 slot
            mstore(ptr, result)
            return(add(ptr, 0xC), 0x14) // result[12:] => Mem[ptr:ptr+11] = discarded; Mem[ptr+12: ptr+31] = create2_address (20 bytes); 12=0xC, 20=0x14
        }
    }

    function deploy(
        bytes memory code,
        bytes32 salt,
        bytes memory initdata
    ) internal returns (address addr) {
        bytes memory pointerTo;
        uint256 size;

        console.log("Calling create2");
        //Deployment of the Smart Wallet
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }

            size := extcodesize(addr)
            pointerTo := mload(0x40)
            mstore(
                0x40,
                add(pointerTo, and(add(add(size, 0x20), 0x1f), not(0x1f)))
            )
            mstore(pointerTo, size)
            extcodecopy(addr, add(pointerTo, 0x20), 0, size)
        }

        console.log("Deployed Code is");
        console.logBytes(pointerTo);

        console.log("Size of code is", size);

        console.log("Address obtained:", addr);
        console.log("Init data is:");
        console.logBytes(initdata);

        //Since the init code determines the address of the smwart wallet, any initialization
        //require is done via the runtime code, to avoid the parameters impacting on the resulting address

        (bool success, ) = addr.call(initdata);
        console.log("Initialization result: ", success);
        require(success);

        //No info is returned, an event is emitted to inform the new deployment
        emit Deployed(addr, uint256(salt));
    }

    // Returns the proxy code to that is deployed on every Smart Wallet creation
    function getCreationBytecode() public view returns (bytes memory) {
        //constructorCode = hex"602D3D8160093D39F3";
        //runtimeCodeBeforeAddress = hex"363D3D373D3D3D3D363D73";
        //runtimeCodeAfterAddress = hex"5AF43D923D90803E602D57FD5BF3";

        //Working proxy done in solidity
        //bytes memory newByteCode = hex"608060405234801561001057600080fd5b506102c2806100206000396000f3fe608060405234801561001057600080fd5b506100456040518060400160405280601381526020017244656c65676174696e672063616c6c204f4e4560681b8152506100f1565b6040516000906060737c2c195cd6d34b8f845992d380aadb2730bb9c6f368484376000803685845af49350503d9050806000833e61009b6040518060600160405280602581526020016102686025913984610137565b6100d96040518060400160405280601a81526020017f5468652073697a65206f662074686520726573756c74207761730000000000008152506100f1565b6100e281610180565b8280156100ed578183f35b8183fd5b61013481604051602401610105919061022b565b60408051601f198184030181529190526020810180516001600160e01b031663104c13eb60e21b1790526101bf565b50565b61017c828260405160240161014d929190610245565b60408051601f198184030181529190526020810180516001600160e01b03166309710a9d60e41b1790526101bf565b5050565b61013481604051602401610194919061022b565b60408051601f198184030181529190526020810180516001600160e01b03166305f3bfab60e11b1790525b80516a636f6e736f6c652e6c6f67602083016000808483855afa5050505050565b60008151808452815b81811015610205576020818501810151868301820152016101e9565b818111156102165782602083870101525b50601f01601f19169290920160200192915050565b60006020825261023e60208301846101e0565b9392505050565b60006040825261025860408301856101e0565b9050826020830152939250505056fe54486520726573756c74206f6620746865206465656c6761746563616c6c4f4e4520776173a2646970667358221220cc21c8134f2bfa78de93972e313750b8285a930950d26c97b3963af1d9b1253564736f6c634300060c0033";
        //return abi.encodePacked(newByteCode);

        //bytes memory payloadStart = hex"602F3D8160093D39F336600080376000808080368173";
        //bytes memory payloadEnd = hex"5AF43D923D90803E602E57FD5BF3";


            bytes memory payloadStart
         = hex"602D3D8160093D39F3363D3D373D3D3D3D363D73";
        bytes memory payloadEnd = hex"5AF43D923D90803E602B57FD5BF3";

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

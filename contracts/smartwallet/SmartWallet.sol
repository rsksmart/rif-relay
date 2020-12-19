// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IForwarder.sol";
import "../utils/RSKAddrValidator.sol";

/* solhint-disable no-inline-assembly */
/* solhint-disable avoid-low-level-calls */

contract SmartWallet is IForwarder {
    using ECDSA for bytes32;

    bytes32 public currentVersionHash;
    uint256 public override nonce;
    

    /**It will only work if called through Enveloping */
    function setVersion(bytes32 versionHash) public {
       
        require(
            address(this) == msg.sender,
            "Caller must be the SmartWallet"
        );        
        
        currentVersionHash = versionHash;
    }

    function verify(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes calldata sig
    ) external override view {

        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    function getOwner() private view returns (bytes32 owner){
        assembly {
            owner := sload(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            )
        }
    }
    

    function directExecute(address to, bytes calldata data) external override payable returns (
            bool success,
            bytes memory ret  
        )
    {

        //Verify Owner
        require(
            getOwner() == keccak256(abi.encodePacked(msg.sender)),
            "Not the owner of the SmartWallet"
        );

       bytes32 logicStrg;
        assembly {
            logicStrg := sload(
                0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
            )
        }

        // If there's no extra logic, then call the destination contract
        if (logicStrg == bytes32(0)) {
            (success, ret) = to.call{value: msg.value}(data);
        } else {
            //If there's extra logic, delegate the execution
            (success, ret) = (address(uint160(uint256(logicStrg)))).delegatecall(msg.data);
        }

        //If any balance has been added then trasfer it to the owner EOA
        if (address(this).balance > 0) {
            //can't fail: req.from signed (off-chain) the request, so it must be an EOA...
            payable(msg.sender).transfer(address(this).balance);
        }
   
    }
    
    function execute(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes calldata sig
    )
        external
        override
        payable
        returns (
            uint256 lastTxSucc,
            bytes memory ret  
        )
    {

        bool success;
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        nonce++;

        (success, ret) = req.tokenContract.call(
            abi.encodeWithSelector(
                IERC20.transfer.selector,
                req.tokenRecipient,
                req.tokenAmount
            )
        );

        if (!success) {
            lastTxSucc = 2;
        }
        else{
            bytes32 logicStrg;
            assembly {
                logicStrg := sload(
                    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
                )
            }

            // If there's no extra logic, then call the destination contract
            if (logicStrg == bytes32(0)) {
                (success, ret) = req.to.call{gas: req.gas, value: req.value}(req.data);
            } else {
                //If there's extra logic, delegate the execution
                (success, ret) = (address(uint160(uint256(logicStrg)))).delegatecall(msg.data);
            }
     
            //If any balance has been added then trasfer it to the owner EOA
            if (address(this).balance > 0) {
                //can't fail: req.from signed (off-chain) the request, so it must be an EOA...
                payable(req.from).transfer(address(this).balance);
            }

            if (!success) {
                lastTxSucc = 1;
            }
            else{
                lastTxSucc = 0; // 0 == OK
            }
        }

  
    }

   

    function getChainID() private pure returns (uint256 id) {
        assembly {
            id := chainid()
        }
    }

    function _verifySig(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes32 suffixData,
        bytes memory sig
    ) private view {

        //Verify Owner
        require(
            getOwner() == keccak256(abi.encodePacked(req.from)),
            "Not the owner of the SmartWallet"
        );

        //Verify nonce
        require(nonce == req.nonce, "nonce mismatch");


        require(//REQUEST_TYPE_HASH
            keccak256("RelayRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 tokenAmount,address recoverer,uint256 index,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,bool isSmartWalletDeploy,address relayWorker,address callForwarder,address callVerifier)") == requestTypeHash,
            "Invalid request typehash"
        );

        require(
            keccak256(abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("RSK Enveloping Transaction"), //DOMAIN_NAME
                currentVersionHash,
                getChainID(),
                address(this))) == domainSeparator,
            "Invalid domain separator"
        );
        
        require(
            RSKAddrValidator.safeEquals(
                keccak256(abi.encodePacked(
                    "\x19\x01",
                    domainSeparator,
                    keccak256(_getEncoded(req, requestTypeHash, suffixData)))
                ).recover(sig), req.from), "signature mismatch"
        );
    }

    function _getEncoded(
        ForwardRequest memory req,
        bytes32 requestTypeHash,
        bytes32 suffixData
    ) private pure returns (bytes memory) {
        return
            abi.encodePacked(
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
                    req.recoverer,
                    req.index
                ),
                suffixData
            );
    }

    function isInitialized() external view returns (bool) {
        
        if (getOwner() == bytes32(0)) {
            return false;
        } else {
            return true;
        }
    }

    /**
     * This Proxy will first charge for the deployment and then it will pass the
     * initialization scope to the wallet logic.
     * This function can only be called once, and it is called by the Factory during deployment
     * @param owner - The EOA that will own the smart wallet
     * @param logic - The address containing the custom logic where to delegate everything that is not payment-related
     * @param tokenAddr - The Token used for payment of the deploy
     * @param versionHash - The version of the domain separator to be used
     * @param transferData - payment function and params to use when calling the Token.
     * sizeof(transferData) = transfer(4) + _to(20) + _value(32) = 56 bytes = 0x38
     * @param initParams - Initialization data to pass to the custom logic's initialize(bytes) function
     */

    function initialize(
        address owner,
        address logic,
        address tokenAddr,
        bytes32 versionHash,
        bytes memory initParams,
        bytes memory transferData
    ) external {

        require(getOwner() == bytes32(0), "already initialized");

        //To avoid re-entrancy attacks by external contracts, the first thing we do is set
        //the variable that controls "is initialized"
        //We set this instance as initialized, by
        //storing the logic address
        //Set the owner of this Smart Wallet
        //slot for owner = bytes32(uint256(keccak256('eip1967.proxy.owner')) - 1) = a7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
        bytes32 ownerCell = keccak256(abi.encodePacked(owner));

        assembly {
            sstore(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a,
                ownerCell
            )
        }

        //we need to initialize the contract
        if (tokenAddr != address(0)) {
            (bool success, ) = tokenAddr.call(transferData);
            require(success, "Unable to pay for deployment");
        }

        currentVersionHash = versionHash;

        //If no logic is injected at this point, then the Forwarder will never accept a custom logic (since
        //the initialize function can only be called once)
        if (logic != address(0) ) {

            //Initialize function of custom wallet logic must be initialize(bytes) = 439fab91
            (bool success, ) = logic.delegatecall(abi.encodeWithSelector(
                hex"439fab91",
                initParams
            ));

            require(
                success,
                "initialize call in logic failed"
            );

            bytes memory logicCell = abi.encodePacked(logic);

            assembly {
                //The slot used complies with EIP-1967, obtained as:
                //bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
                sstore(
                    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,
                    logicCell
                )
            }
        }
       
    }


    function _fallback() private {
        //Proxy code to the logic (if any)

        bytes32 logicStrg;
        assembly {
            logicStrg := sload(
                0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
            )
        }

        if (logicStrg != bytes32(0)  ) {
            //If the storage cell is not empty
            
            address logic = address(uint160(uint256(logicStrg)));

            assembly {
                let ptr := mload(0x40)

                // (1) copy incoming call data
                calldatacopy(ptr, 0, calldatasize())

                // (2) forward call to logic contract
                let result := delegatecall(
                    gas(),
                    logic,
                    ptr,
                    calldatasize(),
                    0,
                    0
                )
                let size := returndatasize()

                // (3) retrieve return data
                returndatacopy(ptr, 0, size)

                // (4) forward return data back to caller
                switch result
                    case 0 {
                        revert(ptr, size)
                    }
                    default {
                        return(ptr, size)
                    }
            }
        }
    }

    /**
     * @dev Fallback function that delegates calls to the address returned by `_implementation()`. Will run if call data
     * is empty.
     */
    receive() payable external {
        _fallback();
    }

    /**
     * @dev Fallback function that delegates calls to the address returned by `_implementation()`. Will run if no other
     * function in the contract matches the call data.
     */
    fallback() payable external  {
        _fallback();
    }
}

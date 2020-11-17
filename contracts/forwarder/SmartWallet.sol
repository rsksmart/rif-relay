// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IForwarder.sol";
import "../utils/GsnUtils.sol";
import "../utils/RSKAddrValidator.sol";

/* solhint-disable no-inline-assembly */
/* solhint-disable avoid-low-level-calls */

contract SmartWallet is IForwarder {
    using ECDSA for bytes32;
       
    bytes32 public constant DOMAIN_NAME = keccak256(
        "RSK Enveloping Transaction"
    );
    bytes32 public constant REQUEST_TYPE_HASH = keccak256("RelayRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 tokenAmount,address factory,address recoverer,uint256 index,RelayData relayData)RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster,address forwarder,bytes paymasterData,uint256 clientId)");
    bytes32 public constant EIP712DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );    

    bytes32 public currentVersionHash;

    mapping(bytes32 => bool) public typeHashes;
    mapping(bytes32 => bool) public domains;


    // Nonce of forwarder, used to prevent replay attacks
    uint256 private nonce;

    function getNonce() public view override returns (uint256) {
        return nonce;
    }


    /**It will only work if called through Enveloping */
    function setVersion(bytes32 versionHash) external {
        
        bytes32 swalletOwner; //hash of owner address
        
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            //First of all, verify the req.from is the owner of this smart wallet
            swalletOwner := sload(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            )
        }

        require(
            swalletOwner == keccak256(abi.encodePacked(msg.sender)),
            "Requestor is not the owner of the Smart Wallet"
        );        
        
        currentVersionHash = versionHash;
    }

    function verify(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes calldata suffixData,
        bytes calldata sig
    ) external override view {
        _verifyOwner(req);
        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    function execute(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes calldata suffixData,
        bytes calldata sig
    )
        external
        override
        payable
        returns (
            bool success,
            uint256 lastTxSucc,
            bytes memory ret  
        )
    {
        _verifyOwner(req);
        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        
        nonce++;

        // solhint-disable-next-line avoid-low-level-calls
        (success, ret) = req.tokenContract.call(
            abi.encodeWithSelector(
                IERC20.transfer.selector,
                req.tokenRecipient,
                req.tokenAmount
            )
        );

        if (!success) {
            return (success, 0, ret);
        }

        address logic;
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            logic := sload(
                0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
            )
        }

        // If there's no extra logic, then call the destination contract
        if (logic == address(0)) {
            /* solhint-disable-next-line avoid-low-level-calls */
            (success, ret) = req.to.call{gas: req.gas, value: req.value}(
                abi.encodePacked(req.data, req.from)
            );
        } else {
            //If there's extra logic, delegate the execution
            /* solhint-disable-next-line avoid-low-level-calls */
            (success, ret) = logic.delegatecall(msg.data);
        }

        //If any balance has been added then trasfer it to the owner EOA
        if (address(this).balance > 0) {
            //can't fail: req.from signed (off-chain) the request, so it must be an EOA...
            payable(req.from).transfer(address(this).balance);
        }

        if (!success) {
            return (success, 1, ret);
        }

        return (success, 2, ret);
    }

    function _verifyOwner(ForwardRequest memory req) internal view {
        bytes32 swalletOwner; //hash of owner address
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            //First of all, verify the req.from is the owner of this smart wallet
            swalletOwner := sload(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            )
        }

        require(
            swalletOwner == keccak256(abi.encodePacked(req.from)),
            "Requestor is not the owner of the Smart Wallet"
        );
    }

    function _verifyNonce(ForwardRequest memory req) internal view {
        require(nonce == req.nonce, "nonce mismatch");
    }


    function getChainID() internal pure returns (uint256 id) {
        /* solhint-disable no-inline-assembly */
        assembly {
            id := chainid()
        }
    }

    function _verifySig(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes memory suffixData,
        bytes memory sig
    ) internal view {
        require(
            REQUEST_TYPE_HASH == requestTypeHash,
            "Invalid request typehash"
        );

        require(
            keccak256(abi.encode(
                EIP712DOMAIN_TYPEHASH,
                DOMAIN_NAME,
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
        bytes memory suffixData
    ) public pure returns (bytes memory) {
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
                    req.factory,
                    req.recoverer,
                    req.index
                ),
                suffixData
            );
    }

    function isInitialized() external view returns (bool) {
        bytes32 swalletOwner;
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            swalletOwner := sload(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            )
        }
        if (swalletOwner == bytes32(0)) {
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
    ) external returns (bool) {

        bytes32 swalletOwner;
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            //This function can be called only if not initialized (i.e., owner not set)
            //The slot used complies with EIP-1967-like, obtained as:
            //slot for owner = bytes32(uint256(keccak256('eip1967.proxy.owner')) - 1) = a7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            swalletOwner := sload(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            )
        }

        if (swalletOwner == bytes32(0)) {
            //we need to initialize the contract
            if (tokenAddr != address(0)) {
                /* solhint-disable-next-line avoid-low-level-calls */
                (bool success, ) = tokenAddr.call(transferData);
                require(success, "Unable to pay for deployment");
            }

            currentVersionHash = versionHash;

            //If no logic is injected at this point, then the Forwarder will never accept a custom logic (since
            //the initialize function can only be called once)
            if (address(0) != logic) {
                //console.log("There is custom logic");

                //Initialize function of custom wallet logic must be initialize(bytes) = 439fab91
                bytes memory initP = abi.encodeWithSelector(
                    hex"439fab91",
                    initParams
                );
                /* solhint-disable-next-line avoid-low-level-calls */
                (bool success, ) = logic.delegatecall(initP);

                require(
                    success,
                    "initialize call in logic failed"
                );

                bytes memory logicCell = abi.encodePacked(logic);
                /* solhint-disable-next-line no-inline-assembly */
                assembly {
                    //The slot used complies with EIP-1967, obtained as:
                    //bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
                    sstore(
                        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,
                        logicCell
                    )
                }
            }

            //If it didnt revert it means success was true, we can then set this instance as initialized, by
            //storing the logic address
            //Set the owner of this Smart Wallet
            //slot for owner = bytes32(uint256(keccak256('eip1967.proxy.owner')) - 1) = a7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            bytes32 ownerCell = keccak256(abi.encodePacked(owner));
            /* solhint-disable-next-line no-inline-assembly */
            assembly {
                sstore(
                    0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a,
                    ownerCell
                )
            }

            return true;
        }
        return false;
    }

    /**
     * @dev Fallback function that delegates calls to the address returned by `_implementation()`. Will run if no other
     * function in the contract matches the call data.
     */
    fallback() external payable {
        _fallback();
    }

    function _fallback() internal {
        //Proxy code to the logic (if any)

        bytes32 logicStrg;
        /* solhint-disable-next-line no-inline-assembly */
        assembly {
            logicStrg := sload(
                0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
            )
        }

        if (bytes32(0) != logicStrg) {
            //If the storage cell is not empty
            
            address logic = address(uint160(uint256(logicStrg)));
            /* solhint-disable-next-line no-inline-assembly */
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
    receive() external payable {
        _fallback();
    }
}

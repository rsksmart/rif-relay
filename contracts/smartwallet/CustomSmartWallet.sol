// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../interfaces/IForwarder.sol";
import "../utils/RSKAddrValidator.sol";

/* solhint-disable no-inline-assembly */
/* solhint-disable avoid-low-level-calls */

contract CustomSmartWallet is IForwarder {
    using ECDSA for bytes32;

    uint256 public override nonce;
    bytes32 public constant DATA_VERSION_HASH = keccak256("2");

    function verify(
        bytes32 domainSeparator,
        bytes32 suffixData,
        ForwardRequest memory req,
        bytes calldata sig
    ) external override view {

        _verifySig(domainSeparator, suffixData, req, sig);
    }

    function getOwner() private view returns (bytes32 owner){
        assembly {
            owner := sload(
                0xa7b53796fd2d99cb1f5ae019b54f9e024446c3d12b483f733ccc62ed04eb126a
            )
        }
    }
    
    function recover(address owner, address factory, address swTemplate, address destinationContract,address logic, uint256 index, bytes32 initParamsHash, bytes calldata data) external payable returns (bool success, bytes memory ret){

        address wallet = 
            address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                factory,
                                keccak256(abi.encodePacked(owner, msg.sender, logic, initParamsHash, index)), //salt
                                keccak256(abi.encodePacked(hex"602D3D8160093D39F3363D3D373D3D3D3D363D73", swTemplate, hex"5AF43D923D90803E602B57FD5BF3"))
                            )
                        )
                    )
                )
            );


        require(wallet == address(this), "Invalid recoverer");

        if(destinationContract != address(0)){
            (success, ret) = destinationContract.call{value: msg.value}(data);
        }

        //If any balance has been added then trasfer it to the owner EOA
        if (address(this).balance > 0) {
            //sent any value left to the recoverer account
            payable(msg.sender).transfer(address(this).balance);
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
            // The logic contract address
            // IMPLEMENTATION_SLOT = bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
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
        bytes32 domainSeparator,
        bytes32 suffixData,
        ForwardRequest memory req,
        bytes calldata sig
    )
        external
        override
        payable
        returns (
            bool success,
            bytes memory ret  
        )
    {

        (sig);
        require(msg.sender == req.relayHub, "Invalid caller");

        _verifySig(domainSeparator, suffixData, req, sig);
        nonce++;

        if(req.tokenAmount > 0){
            /* solhint-disable avoid-tx-origin */
            (success, ret) = req.tokenContract.call{gas: req.tokenGas}(
                abi.encodeWithSelector(
                    hex"a9059cbb", 
                    tx.origin,
                    req.tokenAmount
                )
            );

            require(
                success && (ret.length == 0 || abi.decode(ret, (bool))),
                "Unable to pay for relay"
            );
        }

        bytes32 logicStrg;
        assembly {
            logicStrg := sload(
                0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
            )
        }

            //Why this require is not needed: in the case that the EVM implementation 
            //sends gasleft() as req.gas  if gasleft() < req.gas (see EIP-1930),  which would end in the call reverting
            //If the relayer made this on purpose in order to collect the payment, since all gasLeft()
            //was sent to this call, then the next line would give an out of gas, and, as a consequence, will
            //revert the whole transaction, and the payment will not happen
            //But it could happen that the destination call makes a gasleft() check and decides to revert if it is
            //not enough, in that case there might be enough gas to complete the relay and the token payment would be collected
            //For that reason, the next require line must be left uncommented, to avoid malicious relayer attacks to destination contract
            //methods that revert if the gasleft() is not enough to execute whatever logic they have.

            require(gasleft() > req.gas,"Not enough gas left");
            
        // If there's no extra logic, then call the destination contract
        if (logicStrg == bytes32(0)) {
            (success, ret) = req.to.call{gas: req.gas, value: req.value}(req.data);
        } else {
            //If there's extra logic, delegate the execution
            (success, ret) = (address(uint160(uint256(logicStrg)))).delegatecall(msg.data);
        }
    
        //If any balance has been added then trasfer it to the owner EOA
        uint256 balanceToTransfer = address(this).balance;
        if ( balanceToTransfer > 0) {
            //can't fail: req.from signed (off-chain) the request, so it must be an EOA...
            payable(req.from).transfer(balanceToTransfer);
        }
    }

    function getChainID() private pure returns (uint256 id) {
        assembly {
            id := chainid()
        }
    }

    function _verifySig(
        bytes32 domainSeparator,
        bytes32 suffixData,
        ForwardRequest memory req,
        bytes memory sig
    ) private view {

        //Verify Owner
        require(
            getOwner() == keccak256(abi.encodePacked(req.from)),
            "Not the owner of the SmartWallet"
        );

        //Verify nonce
        require(nonce == req.nonce, "nonce mismatch");

        require(
            keccak256(abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("RSK Enveloping Transaction"), //DOMAIN_NAME
                DATA_VERSION_HASH,
                getChainID(),
                address(this))) == domainSeparator,
            "Invalid domain separator"
        );
        
        require(
            RSKAddrValidator.safeEquals(
                keccak256(abi.encodePacked(
                    "\x19\x01",
                    domainSeparator,
                    keccak256(_getEncoded(suffixData, req)))
                ).recover(sig), req.from), "signature mismatch"
        );
    }

    function _getEncoded(
        bytes32 suffixData,
        ForwardRequest memory req
    ) private pure returns (bytes memory) {
        return
            abi.encodePacked(
                keccak256("RelayRequest(address relayHub,address from,address to,address tokenContract,uint256 value,uint256 gas,uint256 nonce,uint256 tokenAmount,uint256 tokenGas,bytes data,RelayData relayData)RelayData(uint256 gasPrice,bytes32 domainSeparator,address relayWorker,address callForwarder,address callVerifier)"), //requestTypeHash,
                abi.encode(
                    req.relayHub,
                    req.from,
                    req.to,
                    req.tokenContract,
                    req.value,
                    req.gas,
                    req.nonce,
                    req.tokenAmount,
                    req.tokenGas,
                    keccak256(req.data)
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
     * @param tokenRecipient - The recipient of the payment
     * @param tokenAmount - The amount to pay
     * @param initParams - Initialization data to pass to the custom logic's initialize(bytes) function
     */

    function initialize(
        address owner,
        address logic,
        address tokenAddr,
        address tokenRecipient,
        uint256 tokenAmount,
        uint256 tokenGas,
        bytes memory initParams
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
        if (tokenAmount > 0) {

            (bool success, bytes memory ret ) = tokenAddr.call{gas:tokenGas}(abi.encodeWithSelector(
                hex"a9059cbb",
                tokenRecipient,
                tokenAmount));

            require(
            success && (ret.length == 0 || abi.decode(ret, (bool))),
            "Unable to pay for deployment");
        }

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

            assembly {
                //The slot used complies with EIP-1967, obtained as:
                //bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
                sstore(
                    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,
                    logic
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

        if (bytes32(0) != logicStrg) {
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

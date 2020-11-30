/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable avoid-tx-origin */
/* solhint-disable bracket-align */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./utils/MinLibBytes.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./utils/GsnEip712Library.sol";
import "./interfaces/GsnTypes.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IVerifier.sol";
import "./interfaces/IForwarder.sol";
import "./interfaces/IStakeManager.sol";
    //TODO Enveloping
    //If req.token != address(0) then do not use the balances at all
    //If req.token == 0, then the relayHub will pay the worker with balance
contract RelayHub is IRelayHub {
    using SafeMath for uint256;

    uint256 public override minimumStake;
    uint256 public override minimumUnstakeDelay;
    uint256 public override maximumRecipientDeposit;
    uint256 public override gasOverhead;
    uint256 public override maxWorkerCount;
    address override public penalizer;
    IStakeManager override public stakeManager;
    string public override versionHub = "2.0.1+opengsn.hub.irelayhub";

    // maps relay worker's address to its manager's address
    mapping(address => address) public override workerToManager;

    // maps relay managers to the number of their workers
    mapping(address => uint256) public override workerCount;

    mapping(address => uint256) private balances;

    constructor (
        IStakeManager _stakeManager,
        address _penalizer,
        uint256 _maxWorkerCount,
        uint256 _gasOverhead,
        uint256 _maximumRecipientDeposit,
        uint256 _minimumUnstakeDelay,
        uint256 _minimumStake
    ) public {
        stakeManager = _stakeManager;
        penalizer = _penalizer;
        maxWorkerCount = _maxWorkerCount;
        gasOverhead = _gasOverhead;
        maximumRecipientDeposit = _maximumRecipientDeposit;
        minimumUnstakeDelay = _minimumUnstakeDelay;
        minimumStake =  _minimumStake;

        // V1 ONLY: to support kill, pause and unpause behavior
        /* contractOwner = msg.sender; */
    }

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external override /* whenNotPaused */ {
        address relayManager = msg.sender;
        require(
            isRelayManagerStaked(relayManager),
            "relay manager not staked"
        );
        require(workerCount[relayManager] > 0, "no relay workers");
        emit RelayServerRegistered(relayManager, baseRelayFee, pctRelayFee, url);
    }

    function addRelayWorkers(address[] calldata newRelayWorkers) external override /* whenNotPaused */ {
        address relayManager = msg.sender;
        workerCount[relayManager] = workerCount[relayManager] + newRelayWorkers.length;
        require(workerCount[relayManager] <= maxWorkerCount, "too many workers");

        require(
            isRelayManagerStaked(relayManager),
            "relay manager not staked"
        );

        for (uint256 i = 0; i < newRelayWorkers.length; i++) {
            require(workerToManager[newRelayWorkers[i]] == address(0), "this worker has a manager");
            workerToManager[newRelayWorkers[i]] = relayManager;
        }

        emit RelayWorkersAdded(relayManager, newRelayWorkers, workerCount[relayManager]);
    }

    function depositFor(address target) public override payable /* whenNotPaused */ {
        uint256 amount = msg.value;
        // V1 ONLY: comment out next line
        require(amount <= maximumRecipientDeposit, "deposit too big");

        balances[target] = balances[target].add(amount);

        // V1 ONLY: next line is needed for limiting deposits. Limits will be removed in v2 
        // require(balances[target] <= maximumRecipientDeposit, "deposit too big");

        emit Deposited(target, msg.sender, amount);
    }

    function balanceOf(address target) external override view returns (uint256) {
        return balances[target];
    }

    function withdraw(uint256 amount, address payable dest) public override {
        address payable account = msg.sender;
        require(balances[account] >= amount, "insufficient funds");

        balances[account] = balances[account].sub(amount);
        dest.transfer(amount);

        emit Withdrawn(account, dest, amount);
    }

    struct RelayCallData {
        bool success;
        //bytes4 functionSelector;
        bytes relayedCallReturnValue;
        RelayCallStatus status;
        bytes retData;
    }

    function relayCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature    )
    external
    override
    {
        (signature);
        RelayCallData memory vars;

        require(gasleft() >= gasOverhead.add(relayRequest.request.gas), "Not enough gas left");
        require(msg.sender == tx.origin, "RelayWorker cannot be a contract");
        require(workerToManager[msg.sender] != address(0), "Unknown relay worker");
        require(relayRequest.relayData.relayWorker == msg.sender, "Not a right worker");
        require(
            isRelayManagerStaked(workerToManager[msg.sender]),
            "relay manager not staked"
        );
        require(relayRequest.relayData.gasPrice <= tx.gasprice, "Invalid gas price");
      

        bool forwarderSuccess;
        uint256 lastSuccTrx;
        (forwarderSuccess, vars.success, lastSuccTrx, vars.relayedCallReturnValue) = GsnEip712Library.execute(relayRequest, signature);          
        if ( !forwarderSuccess ) {
            revertWithStatus(RelayCallStatus.RejectedByForwarder, vars.relayedCallReturnValue);
        }

        if (!vars.success) {
            emit TransactionRelayedButRevertedByRecipient(            
            workerToManager[msg.sender],
            msg.sender,
            relayRequest.request.from,
            relayRequest.request.to,
            relayRequest.relayData.isSmartWalletDeploy?bytes4(0):MinLibBytes.readBytes4(relayRequest.request.data, 0),
            vars.relayedCallReturnValue);// TODO: debate if its neccesary to have lastSuccTrx
        }
        else if(relayRequest.relayData.isSmartWalletDeploy){
            //In SmartWallet deploys the data attribute is used for initialization params of extra logic contract, 
            //this extra logic contract is defined in the "to" paramete
            emit SWDeployRelayed(
            workerToManager[msg.sender],
            msg.sender,
            relayRequest.request.from,
            relayRequest.relayData.callForwarder,
            vars.status,
            relayRequest.request.tokenAmount);
         }
         else{
            emit TransactionRelayed(
            workerToManager[msg.sender],
            msg.sender,
            relayRequest.request.from,
            relayRequest.request.to,
            MinLibBytes.readBytes4(relayRequest.request.data, 0),
            vars.status,
            relayRequest.request.tokenAmount);
            
            if ( vars.relayedCallReturnValue.length>0 ) {
                emit TransactionResult(vars.status, vars.relayedCallReturnValue);
            }
         }
    }


    /**
     * @dev Reverts the transaction with return data set to the ABI encoding of the status argument (and revert reason data)
     */
    function revertWithStatus(RelayCallStatus status, bytes memory ret) private pure {
        bytes memory data = abi.encode(status, ret);
       assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)
            revert(dataPtr, dataSize)
        }
    }

   /* function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) public override virtual view returns (uint256) {
        //       relayData.baseRelayFee + (gasUsed * relayData.gasPrice * (100 + relayData.pctRelayFee)) / 100;
        return relayData.baseRelayFee.add((gasUsed.mul(relayData.gasPrice).mul(relayData.pctRelayFee.add(100))).div(100));
    } */

    function isRelayManagerStaked(address relayManager) public override view returns (bool) {
        return stakeManager.isRelayManagerStaked(relayManager, address(this), minimumStake, minimumUnstakeDelay);
    }

    modifier penalizerOnly () {
        require(msg.sender == penalizer, "Not penalizer");
        _;
    }

    function penalize(address relayWorker, address payable beneficiary) external override penalizerOnly /* whenNotPaused */ {
        address relayManager = workerToManager[relayWorker];
        // The worker must be controlled by a manager with a locked stake
        require(relayManager != address(0), "Unknown relay worker");
        require(
            isRelayManagerStaked(relayManager),
            "relay manager not staked"
        );
        IStakeManager.StakeInfo memory stakeInfo = stakeManager.getStakeInfo(relayManager);
        stakeManager.penalizeRelayManager(relayManager, beneficiary, stakeInfo.stake);
    }

    // V1 ONLY: Support for destructable contracts
    // For v1 deployment only to support kill, pause and unpause behavior
    // This functionality is temporary and will be removed in v2
    /*
    address public contractOwner;
    bool public paused = false;

    modifier onlyOwner() {
        require(msg.sender == contractOwner, "Sender is not the owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is not paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Contract is paused");
        _;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(RSKAddrValidator.checkPKNotZero(newOwner), "Invalid new owner");
        contractOwner = newOwner;
    }

    function kill(address payable recipient) external onlyOwner whenPaused {
        require(RSKAddrValidator.checkPKNotZero(recipient), "Invalid recipient");

        // The recipient is not the owner of the contract's balance
        require(address(this).balance == 0, "Contract has balance");
        selfdestruct(recipient);
    }

    function pause() public onlyOwner {
        paused = true;
    }

    function unpause() public onlyOwner {
        paused = false;
    }
    */
}

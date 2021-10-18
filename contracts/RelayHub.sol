/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable avoid-tx-origin */
/* solhint-disable bracket-align */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "./utils/Eip712Library.sol";
import "./interfaces/EnvelopingTypes.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IForwarder.sol";

contract RelayHub is IRelayHub {
    using SafeMath for uint256;

    uint256 public override minimumStake;
    uint256 public override minimumUnstakeDelay;
    uint256 public override minimumEntryDepositValue;
    uint256 public override maxWorkerCount;
    address public override penalizer;

    string public override versionHub = "2.0.1+enveloping.hub.irelayhub";
    // bytes4(keccak256("fulfill(bytes32)"))
    bytes4 private constant FULFILL_SELECTOR = 0x5508ff94;

    // maps relay worker's address to its manager's address
    mapping(address => bytes32) public override workerToManager;

    // maps relay managers to the number of their workers
    mapping(address => uint256) public override workerCount;

    // maps relay managers to their stakes
    mapping(address => StakeInfo) public stakes;

    constructor(
        address _penalizer,
        uint256 _maxWorkerCount,
        uint256 _minimumEntryDepositValue,
        uint256 _minimumUnstakeDelay,
        uint256 _minimumStake
    ) public {
        require(
            _maxWorkerCount > 0 &&
            _minimumStake > 0 && 
            _minimumEntryDepositValue > 0 && 
            _minimumUnstakeDelay > 0, "invalid hub init params"   
        );

        penalizer = _penalizer;
        maxWorkerCount = _maxWorkerCount;
        minimumUnstakeDelay = _minimumUnstakeDelay;
        minimumStake = _minimumStake;
        minimumEntryDepositValue = _minimumEntryDepositValue;
    }

    function registerRelayServer(
        string calldata url
    ) external override {
        //relay manager is msg.sender
        //Check if Relay Manager is staked
        requireManagerStaked(msg.sender);

        require(workerCount[msg.sender] > 0, "no relay workers");
        emit RelayServerRegistered(msg.sender, url);
    }

    function disableRelayWorkers(address[] calldata relayWorkers)
        external
        override
    {
        //relay manager is msg.sender
        uint256 actualWorkerCount = workerCount[msg.sender];
        require(
            actualWorkerCount >= relayWorkers.length,
            "invalid quantity of workers"
        );
        workerCount[msg.sender] = actualWorkerCount - relayWorkers.length;

        //Check if Relay Manager is staked
        requireManagerStaked(msg.sender);

        bytes32 enabledWorker =
            bytes32(uint256(msg.sender) << 4) |
                0x0000000000000000000000000000000000000000000000000000000000000001;
        bytes32 disabledWorker = bytes32(uint256(msg.sender) << 4);

        for (uint256 i = 0; i < relayWorkers.length; i++) {
            //The relay manager can only disable its relay workers and only if they are enabled (right-most nibble as 1)
            require(
                workerToManager[relayWorkers[i]] == enabledWorker,
                "Incorrect Manager"
            );
            //Disabling a worker means putting the right-most nibble to 0
            workerToManager[relayWorkers[i]] = disabledWorker;
        }

        emit RelayWorkersDisabled(
            msg.sender,
            relayWorkers,
            workerCount[msg.sender]
        );
    }

    /**
    New relay worker addresses can be added (as enabled workers) as long as they don't have a relay manager aldeady assigned.
     */
    function addRelayWorkers(address[] calldata newRelayWorkers)
        external
        override
    {
        address relayManager = msg.sender;
        workerCount[relayManager] =
            workerCount[relayManager] +
            newRelayWorkers.length;
        require(
            workerCount[relayManager] <= maxWorkerCount,
            "too many workers"
        );

        //Check if Relay Manager is staked
        requireManagerStaked(relayManager);

        bytes32 enabledWorker =
            bytes32(uint256(relayManager) << 4) |
                0x0000000000000000000000000000000000000000000000000000000000000001;
        for (uint256 i = 0; i < newRelayWorkers.length; i++) {
            require(
                workerToManager[newRelayWorkers[i]] == bytes32(0),
                "this worker has a manager"
            );
            workerToManager[newRelayWorkers[i]] = enabledWorker;
        }

        emit RelayWorkersAdded(
            relayManager,
            newRelayWorkers,
            workerCount[relayManager]
        );
    }

    function deployCall(
        EnvelopingTypes.DeployRequest calldata deployRequest,
        bytes calldata signature
    ) external override {
        /* statement originally present in the GSN repo; 
         * we left it here because of a small gas improvement noticed on tests execution.
         */
        (signature);

        bytes32 managerEntry = workerToManager[msg.sender];

        //read last nibble which stores the isWorkerEnabled flag, it must be 1 (true)
        require(
            managerEntry &
                0x0000000000000000000000000000000000000000000000000000000000000001 ==
                0x0000000000000000000000000000000000000000000000000000000000000001,
            "Not an enabled worker"
        );

        address manager = address(uint160(uint256(managerEntry >> 4)));

        require(msg.sender == tx.origin, "RelayWorker cannot be a contract");
        require(
            msg.sender == deployRequest.relayData.relayWorker,
            "Not a right worker"
        );

        requireManagerStaked(manager);

        require(
            deployRequest.relayData.gasPrice <= tx.gasprice,
            "Invalid gas price"
        );

        bool deploySuccess;
        bytes memory ret;
        ( deploySuccess, ret) = Eip712Library.deploy(deployRequest, signature);

        if (!deploySuccess) {
            assembly {
                revert(
                    add(ret, 32),
                    mload(ret)
                )
            }
        }

        if (deployRequest.request.enableQos == true){
            bytes32 signatureHash = keccak256(signature);
            (bool success, ) = penalizer.call(abi.encodeWithSelector(FULFILL_SELECTOR, signatureHash));
            require(success, "Penalizer fulfill call failed");
        }
    }

    function relayCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    ) external override returns (bool destinationCallSuccess){
        /* statement originally present in the GSN repo; 
         * we left it here because of a small gas improvement noticed on tests execution.
         */
        (signature);
        require(msg.sender == tx.origin, "RelayWorker cannot be a contract");
        require(
            msg.sender == relayRequest.relayData.relayWorker,
            "Not a right worker"
        );
        require(
            relayRequest.relayData.gasPrice <= tx.gasprice,
            "Invalid gas price"
        );

        bytes32 managerEntry = workerToManager[msg.sender];
        //read last nibble which stores the isWorkerEnabled flag, it must be 1 (true)
        require(
            managerEntry &
                0x0000000000000000000000000000000000000000000000000000000000000001 ==
                0x0000000000000000000000000000000000000000000000000000000000000001,
            "Not an enabled worker"
        );

        address manager = address(uint160(uint256(managerEntry >> 4)));
        
        requireManagerStaked(manager);

        bool forwarderSuccess;
        bytes memory relayedCallReturnValue;
        //use succ as relay call success variable
        (forwarderSuccess, destinationCallSuccess, relayedCallReturnValue) = Eip712Library
            .execute(relayRequest, signature);

        if (!forwarderSuccess) {
            assembly {
                revert(
                    add(relayedCallReturnValue, 32),
                    mload(relayedCallReturnValue)
                )
            }
        }

        if (destinationCallSuccess) {
            emit TransactionRelayed(
                manager,
                msg.sender,
                keccak256(signature),
                relayedCallReturnValue
            );
        } else {
            emit TransactionRelayedButRevertedByRecipient(
                manager,
                msg.sender,
                keccak256(signature),
                relayedCallReturnValue
            );
        }

        if (relayRequest.request.enableQos == true){
            bytes32 signatureHash = keccak256(signature);
            (bool success, ) = penalizer.call(abi.encodeWithSelector(FULFILL_SELECTOR, signatureHash));
            require(success, "Penalizer fulfill call failed");
        }
    }

    modifier penalizerOnly() {
        require(msg.sender == penalizer, "Not penalizer");
        _;
    }

    /// Slash the stake of the relay relayManager. In order to prevent stake kidnapping, burns half of stake on the way.
    /// @param relayWorker - worker whose manager will be penalized
    /// @param beneficiary - address that receives half of the penalty amount
    function penalize(address relayWorker, address payable beneficiary)
        external
        override
        penalizerOnly
    {
        //Relay worker might be enabled or disabled
        address relayManager =
            address(uint160(uint256(workerToManager[relayWorker] >> 4)));
        require(relayManager != address(0), "Unknown relay worker");

        StakeInfo storage stakeInfo = stakes[relayManager];
        
        uint256 amount = stakeInfo.stake;

        //In the case the stake owner have already withrawn their funds
        require(amount > 0, "Unstaked relay manager");

        // Half of the stake will be burned (sent to address 0)
        stakeInfo.stake = 0;

        uint256 toBurn = SafeMath.div(amount, 2);
        uint256 reward = SafeMath.sub(amount, toBurn);

        // RBTC is burned and transferred
        address(0).transfer(toBurn);
        beneficiary.transfer(reward);
        emit StakePenalized(relayManager, beneficiary, reward);
    }

        function getStakeInfo(address relayManager)
        external
        view
        override
        returns (StakeInfo memory stakeInfo)
    {
        return stakes[relayManager];
    }
    // Put a stake for a relayManager and set its unstake delay.
    // If the entry does not exist, it is created, and the caller of this function becomes its owner.
    // If the entry already exists, only the owner can call this function.
    // @param relayManager - address that represents a stake entry and controls relay registrations on relay hubs
    // @param unstakeDelay - number of blocks to elapse before the owner can retrieve the stake after calling 'unlock'
    function stakeForAddress(address relayManager, uint256 unstakeDelay)
        external
        payable
        override
    {

        StakeInfo storage stakeInfo = stakes[relayManager];

        require(
            stakeInfo.owner == address(0) ||
                stakeInfo.owner == msg.sender,
            "not owner"
        );
        require(
            unstakeDelay >= stakeInfo.unstakeDelay,
            "unstakeDelay cannot be decreased"
        );
        require(msg.sender != relayManager, "caller is the relayManager");
        require(
            stakes[msg.sender].owner == address(0),
            "sender is a relayManager itself"
        );

        //If it is the initial stake, it must meet the entry value
        if (stakeInfo.owner == address(0)) {
            require(
                msg.value >= minimumEntryDepositValue,
                "Insufficient intitial stake"
            );
        }

        stakeInfo.owner = msg.sender;
        stakeInfo.stake += msg.value;
        stakeInfo.unstakeDelay = unstakeDelay;
        emit StakeAdded(
            relayManager,
            stakeInfo.owner,
            stakeInfo.stake,
            stakeInfo.unstakeDelay
        );
    }

    function unlockStake(address relayManager) external override {
        StakeInfo storage info = stakes[relayManager];
        require(info.owner == msg.sender, "not owner");
        require(info.withdrawBlock == 0, "already pending");
        info.withdrawBlock = block.number.add(info.unstakeDelay);
        emit StakeUnlocked(relayManager, msg.sender, info.withdrawBlock);
    }

    function withdrawStake(address relayManager) external override {
        StakeInfo storage info = stakes[relayManager];
        require(info.owner == msg.sender, "not owner");
        require(info.withdrawBlock > 0, "Withdrawal is not scheduled");
        require(info.withdrawBlock <= block.number, "Withdrawal is not due");
        uint256 amount = info.stake;
        delete stakes[relayManager];
        msg.sender.transfer(amount);
        emit StakeWithdrawn(relayManager, msg.sender, amount);
    }

    modifier ownerOnly(address relayManager) {
        StakeInfo storage info = stakes[relayManager];
        require(info.owner == msg.sender, "not owner");
        _;
    }

    modifier managerOnly() {
        StakeInfo storage info = stakes[msg.sender];
        require(info.owner != address(0), "not manager");
        _;
    }

    function requireManagerStaked(address relayManager) internal view {
        StakeInfo storage info = stakes[relayManager];

        require(
            info.stake >= minimumStake && //isAmountSufficient
                info.unstakeDelay >= minimumUnstakeDelay && //isDelaySufficient
                info.withdrawBlock == 0, //isStakeLocked
            "RelayManager not staked"
        );
    }

    function isRelayManagerStaked(address relayManager) external view override returns (bool) {
        StakeInfo storage info = stakes[relayManager];
        return info.stake >= minimumStake && //isAmountSufficient
            info.unstakeDelay >= minimumUnstakeDelay && //isDelaySufficient
            info.withdrawBlock == 0; //isStakeLocked
    }
}

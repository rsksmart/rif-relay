// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./EnvelopingTypes.sol";

interface IRelayHub {
    // Emitted when a relay server registers or updates its details
    // Looking at these events lets a client discover relay servers
    event RelayServerRegistered(
        address indexed relayManager,
        string relayUrl);

    // Emitted when relays are added by a relayManager
    event RelayWorkersAdded(
        address indexed relayManager,
        address[] newRelayWorkers,
        uint256 workersCount
    );

    // Emitted when relays are removed by a relayManager
    event RelayWorkersDisabled(
        address indexed relayManager,
        address[] relayWorkers,
        uint256 workersCount
    );

    // Emitted when a transaction is relayed. Note that the actual encoded function might be reverted: this will be
    // indicated in the status field.
    // Useful when monitoring a relay's operation and relayed calls to a contract.
    // Charge is the ether value deducted from the recipient's balance, paid to the relay's manager.
    event TransactionRelayed(
        address indexed relayManager,
        address relayWorker,
        bytes32 relayRequestSigHash,
        bytes relayedCallReturnValue);

    event TransactionRelayedButRevertedByRecipient(
        address indexed relayManager,
        address  relayWorker,
        bytes32 relayRequestSigHash,
        bytes reason);
    
    event TransactionResult(
        bytes returnValue
    );

    event Penalized(
        address indexed relayWorker,
        address sender,
        uint256 reward
    );

    /// Add new worker addresses controlled by sender who must be a staked Relay Manager address.
    /// Emits a RelayWorkersAdded event.
    /// This function can be called multiple times, emitting new events
    function addRelayWorkers(address[] calldata newRelayWorkers) external;

    // Disable a relayWorker account so it cannot relay calls anymore (e.g, if the account was compromised)
    // Once disabled, a relay worker cannot be re-enabled
    function disableRelayWorkers(address[] calldata relayWorkers) external; 

    function registerRelayServer(string calldata url) external;

    /// Relays a transaction. For this to succeed, multiple conditions must be met:
    ///  - the sender must be a registered Relay Worker that the user signed
    ///  - the transaction's gas price must be equal or larger than the one that was signed by the sender
    ///  - the transaction must have enough gas to run all internal transactions if they use all gas available to them
    ///
    /// If all conditions are met, the call will be relayed and the recipient charged.
    ///
    /// Arguments:
    /// @param relayRequest - all details of the requested relayed call
    /// @param signature - client's EIP-712 signature over the relayRequest struct
    ///
    /// Emits a TransactionRelayed event.
    /// destinationCallSuccess - indicates whether  the call to the destination contract's function was successfull or not,
    /// is can be false when TransactionRelayedButRevertedByRecipient is emitted.
    function relayCall(
        EnvelopingTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external returns (bool destinationCallSuccess);

    function deployCall(
        EnvelopingTypes.DeployRequest calldata deployRequest,
        bytes calldata signature    )
    external;
    
    function penalize(address relayWorker, address payable beneficiary) external;

    function setPenalizer(address _penalizer) external;

    /* getters */
    function penalizer() external view returns(address);

    // Minimum stake a relay can have. An attack to the network will never cost less than half this value.
    function minimumStake() external view returns (uint256);

    // Minimum unstake delay blocks of a relay manager's stake
    function minimumUnstakeDelay() external view returns (uint256);

    // maximum number of worker account allowed per manager
    function maxWorkerCount() external view returns (uint256);

    function workerToManager(address worker) external view returns(bytes32);

    function workerCount(address manager) external view returns(uint256);

    function isRelayManagerStaked(address relayManager) external view returns(bool);

    function versionHub() external view returns (string memory);

    /// Emitted when a stake or unstakeDelay are initialized or increased
    event StakeAdded(
        address indexed relayManager,
        address indexed owner,
        uint256 stake,
        uint256 unstakeDelay
    );

    /// Emitted once a stake is scheduled for withdrawal
    event StakeUnlocked(
        address indexed relayManager,
        address indexed owner,
        uint256 withdrawBlock
    );

    /// Emitted when owner withdraws relayManager funds
    event StakeWithdrawn(
        address indexed relayManager,
        address indexed owner,
        uint256 amount
    );

    /// Emitted when an authorized Relay Hub penalizes a relayManager
    event StakePenalized(
        address indexed relayManager,
        address indexed beneficiary,
        uint256 reward
    );

    // @param stake - amount of ether staked for this relay
    // @param unstakeDelay - number of blocks to elapse before the owner can retrieve the stake after calling 'unlock'
    // @param withdrawBlock - first block number 'withdraw' will be callable, or zero if the unlock has not been called
    // @param owner - address that receives revenue and manages relayManager's stake
    struct StakeInfo {
        uint256 stake;
        uint256 unstakeDelay;
        uint256 withdrawBlock;
        address payable owner;
    }

    // Put a stake for a relayManager and set its unstake delay.
    // If the entry does not exist, it is created, and the caller of this function becomes its owner.
    // If the entry already exists, only the owner can call this function.
    // @param relayManager - address that represents a stake entry and controls relay registrations on relay hubs
    // @param unstakeDelay - number of blocks to elapse before the owner can retrieve the stake after calling 'unlock'
    function stakeForAddress(address relayManager, uint256 unstakeDelay) external payable;

    function unlockStake(address relayManager) external;

    function withdrawStake(address relayManager) external;

    function getStakeInfo(address relayManager) external view returns (StakeInfo memory stakeInfo);

    //For initial stakes, this is the minimum stake value allowed for taking ownership of this address' stake
    function minimumEntryDepositValue() external view returns (uint256);
}

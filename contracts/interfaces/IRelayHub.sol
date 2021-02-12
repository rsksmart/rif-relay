// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";

interface IRelayHub {

    /// Emitted when a relay server registers or updates its details
    /// Looking at these events lets a client discover relay servers
    event RelayServerRegistered(
        address indexed relayManager,
        uint256 baseRelayFee,
        uint256 pctRelayFee,
        string relayUrl);

    /// Emitted when relays are added by a relayManager
    event RelayWorkersAdded(
        address indexed relayManager,
        address[] newRelayWorkers,
        uint256 workersCount
    );

    /// Emitted when relays are removed by a relayManager
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

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external;



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
    function relayCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external;

    function deployCall(
        GsnTypes.DeployRequest calldata deployRequest,
        bytes calldata signature    )
    external;
    

    function penalize(address relayWorker, address payable beneficiary) external;

    /// The fee is expressed as a base fee in wei plus percentage on actual charge.
    /// E.g. a value of 40 stands for a 40% fee, so the recipient will be
    /// charged for 1.4 times the spent amount.
    // function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) external view returns (uint256);

    /* getters */

    /// Returns the stake manager of this RelayHub.
    function stakeManager() external view returns(address);
    function penalizer() external view returns(address);

    // Minimum stake a relay can have. An attack to the network will never cost less than half this value.
    function minimumStake() external view returns (uint256);

    // Minimum unstake delay blocks of a relay manager's stake on the StakeManager
    function minimumUnstakeDelay() external view returns (uint256);

    // Maximum funds that can be deposited at once. Prevents user error by disallowing large deposits.
    function maximumRecipientDeposit() external view returns (uint256);

    // maximum number of worker account allowed per manager
    function maxWorkerCount() external view returns (uint256);

    function workerToManager(address worker) external view returns(bytes32);

    function workerCount(address manager) external view returns(uint256);

    function isRelayManagerStaked(address relayManager) external returns(bool);

    /**
    * @dev the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */

    // Gas cost of all relayCall() instructions after actual 'calculateCharge()'
    function gasOverhead() external view returns (uint256);

    function versionHub() external view returns (string memory);
}


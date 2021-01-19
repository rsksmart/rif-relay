// SPDX-License-Identifier:MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IStakeManager.sol";

contract StakeManager is IStakeManager {
    // V1 ONLY: constant requiered for stake limits in v1, to be removed when stake limits are lifted in v2
    // uint256 constant public MAXIMUM_STAKE = 520000000000000;

    using SafeMath for uint256;

    string public override versionSM = "2.0.1+opengsn.stakemanager.istakemanager";

    /// maps relay managers to their stakes
    mapping(address => StakeInfo) public stakes;
    function getStakeInfo(address relayManager) external override view returns (StakeInfo memory stakeInfo) {
        return stakes[relayManager];
    }

    /// maps relay managers to a map of addressed of their authorized hubs to the information on that hub
    mapping(address => mapping(address => RelayHubInfo)) public authorizedHubs;

    /// Put a stake for a relayManager and set its unstake delay.
    /// If the entry does not exist, it is created, and the caller of this function becomes its owner.
    /// If the entry already exists, only the owner can call this function.
    /// @param relayManager - address that represents a stake entry and controls relay registrations on relay hubs
    /// @param unstakeDelay - number of blocks to elapse before the owner can retrieve the stake after calling 'unlock'
    function stakeForAddress(address relayManager, uint256 unstakeDelay) external override payable /* whenNotPaused */ {
        require(stakes[relayManager].owner == address(0) || stakes[relayManager].owner == msg.sender, "not owner");
        require(unstakeDelay >= stakes[relayManager].unstakeDelay, "unstakeDelay cannot be decreased");
        require(msg.sender != relayManager, "caller is the relayManager");
        require(stakes[msg.sender].owner == address(0), "sender is a relayManager itself");
        stakes[relayManager].owner = msg.sender;
        stakes[relayManager].stake += msg.value;

        // V1 ONLY: Next line required in v1 for stake limits, limits will be lifted in v2
        // require(stakes[relayManager].stake <= MAXIMUM_STAKE, "stake too big");

        stakes[relayManager].unstakeDelay = unstakeDelay;
        emit StakeAdded(relayManager, stakes[relayManager].owner, stakes[relayManager].stake, stakes[relayManager].unstakeDelay);
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

    modifier ownerOnly (address relayManager) {
        StakeInfo storage info = stakes[relayManager];
        require(info.owner == msg.sender, "not owner");
        _;
    }

    modifier managerOnly () {
        StakeInfo storage info = stakes[msg.sender];
        require(info.owner != address(0), "not manager");
        _;
    }

    function authorizeHubByOwner(address relayManager, address relayHub) external ownerOnly(relayManager) override /* whenNotPaused */ {
        _authorizeHub(relayManager, relayHub);
    }

    function authorizeHubByManager(address relayHub) external managerOnly override /* whenNotPaused */ {
        _authorizeHub(msg.sender, relayHub);
    }

    function _authorizeHub(address relayManager, address relayHub) internal {
        authorizedHubs[relayManager][relayHub].removalBlock = uint(-1);
        emit HubAuthorized(relayManager, relayHub);
    }

    function unauthorizeHubByOwner(address relayManager, address relayHub) external override ownerOnly(relayManager) /* whenNotPaused */ {
        _unauthorizeHub(relayManager, relayHub);
    }

    function unauthorizeHubByManager(address relayHub) external override managerOnly /* whenNotPaused */ {
        _unauthorizeHub(msg.sender, relayHub);
    }

    function _unauthorizeHub(address relayManager, address relayHub) internal {
        RelayHubInfo storage hubInfo = authorizedHubs[relayManager][relayHub];
        require(hubInfo.removalBlock == uint(-1), "hub not authorized");
        uint256 removalBlock = block.number.add(stakes[relayManager].unstakeDelay);
        hubInfo.removalBlock = removalBlock;
        emit HubUnauthorized(relayManager, relayHub, removalBlock);
    }

    function isRelayManagerStaked(address relayManager, address relayHub, uint256 minAmount, uint256 minUnstakeDelay)
    external
    override
    view
    returns (bool) {
        StakeInfo storage info = stakes[relayManager];
        bool isAmountSufficient = info.stake >= minAmount;
        bool isDelaySufficient = info.unstakeDelay >= minUnstakeDelay;
        bool isStakeLocked = info.withdrawBlock == 0;
        bool isHubAuthorized = authorizedHubs[relayManager][relayHub].removalBlock == uint(-1);
        return
        isAmountSufficient &&
        isDelaySufficient &&
        isStakeLocked &&
        isHubAuthorized;
    }


    function requireManagerStaked(address relayManager, uint256 minAmount, uint256 minUnstakeDelay)
    external
    override
    view {
        StakeInfo storage info = stakes[relayManager];
        bool isAmountSufficient = info.stake >= minAmount;
        bool isDelaySufficient = info.unstakeDelay >= minUnstakeDelay;
        bool isStakeLocked = info.withdrawBlock == 0;
        bool isHubAuthorized = authorizedHubs[relayManager][msg.sender].removalBlock == uint(-1);
        require(
        isAmountSufficient &&
        isDelaySufficient &&
        isStakeLocked &&
        isHubAuthorized, "RelayManager not staked");
    }

    /// Slash the stake of the relay relayManager. In order to prevent stake kidnapping, burns half of stake on the way.
    /// @param relayManager - entry to penalize
    /// @param beneficiary - address that receives half of the penalty amount
    /// @param amount - amount to withdraw from stake
    function penalizeRelayManager(address relayManager, address payable beneficiary, uint256 amount) external override /* whenNotPaused */ {
        uint256 removalBlock =  authorizedHubs[relayManager][msg.sender].removalBlock;
        require(removalBlock != 0, "hub not authorized");
        require(removalBlock > block.number, "hub authorization expired");

        // Half of the stake will be burned (sent to address 0)
        require(stakes[relayManager].stake >= amount, "penalty exceeds stake");
        stakes[relayManager].stake = SafeMath.sub(stakes[relayManager].stake, amount);

        uint256 toBurn = SafeMath.div(amount, 2);
        uint256 reward = SafeMath.sub(amount, toBurn);

        // Ether is burned and transferred
        address(0).transfer(toBurn);
        beneficiary.transfer(reward);
        emit StakePenalized(relayManager, beneficiary, reward);
    }

    // V1 ONLY: Support for destructable contracts
    // For v1 deployment only to support kill, pause and unpause behavior
    // This functionality is temporary and will be removed in v2
    /*
    address public contractOwner;
    bool public paused = false;

    constructor() public {
        contractOwner = msg.sender;
    }

    modifier onlyContractOwner() {
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
    
    function transferOwnership(address newOwner) external onlyContractOwner {
        require(RSKAddrValidator.checkPKNotZero(newOwner), "Invalid new owner");
        contractOwner = newOwner;
    }

    function kill(address payable recipient) external onlyContractOwner whenPaused {
        require(RSKAddrValidator.checkPKNotZero(recipient), "Invalid recipient");

        // The recipient is not the owner of the contract's balance
        require(address(this).balance == 0, "Contract has balance");
        selfdestruct(recipient);
    }

    function pause() public onlyContractOwner {
        paused = true;
    }

    function unpause() public onlyContractOwner {
        paused = false;
    }
    */
}

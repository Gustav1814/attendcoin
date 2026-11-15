// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAttendCoin} from "./interfaces/IAttendCoin.sol";

interface IStudentRegistry {
    struct StudentRecord {
        bytes32 idHash;
        address wallet;
        bool active;
        uint64 registeredAt;
    }

    function studentIdOf(address wallet) external view returns (uint256);
    function getStudent(uint256 studentId) external view returns (StudentRecord memory);
}

/// @title RewardStore
/// @notice Catalogue of campus rewards that students buy with ATC.
///
/// Tokens are held in escrow when a student redeems. At the counter the vendor
/// calls `fulfill` and hands the reward over only once that transaction is
/// confirmed; until then the student may cancel. Fulfilling settles the escrow:
/// burned, or sent to the treasury, depending on `burnOnSettle`. A cancelled
/// redemption is refunded in full and the stock is restored.
///
/// Redemptions and per-student limits are keyed by studentId, not wallet, so
/// they survive an admin re-link in the registry. Refunds go to the student's
/// current wallet.
contract RewardStore is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IAttendCoin;

    bytes32 public constant STORE_MANAGER_ROLE = keccak256("STORE_MANAGER_ROLE");
    bytes32 public constant VENDOR_ROLE = keccak256("VENDOR_ROLE");

    enum Status {
        None,
        Pending,
        Fulfilled,
        Cancelled
    }

    struct Item {
        string name;
        string metadataURI;
        uint256 price;
        uint32 stock;
        uint32 perStudentLimit; // 0 = unlimited
        bool active;
    }

    struct Redemption {
        uint256 itemId;
        address student;
        uint256 price;
        uint64 createdAt;
        uint64 settledAt;
        Status status;
    }

    IAttendCoin public immutable token;
    IStudentRegistry public immutable registry;

    address public treasury;
    bool public burnOnSettle = true;

    uint256 public itemCount;
    mapping(uint256 => Item) private _items;

    uint256 public redemptionCount;
    mapping(uint256 => Redemption) private _redemptions;
    mapping(uint256 redemptionId => uint256 studentId) private _studentOf;
    mapping(uint256 studentId => uint256[]) private _redemptionsOf;
    mapping(uint256 itemId => mapping(uint256 studentId => uint32)) private _redeemedCount;

    uint256 public totalBurned;
    uint256 public totalToTreasury;

    event ItemCreated(uint256 indexed itemId, string name, uint256 price, uint32 stock, uint32 perStudentLimit);
    event ItemUpdated(uint256 indexed itemId, uint256 price, uint32 stock, uint32 perStudentLimit, bool active);
    event Redeemed(uint256 indexed redemptionId, uint256 indexed itemId, address indexed student, uint256 price);
    event Fulfilled(uint256 indexed redemptionId, address indexed vendor, bool burned);
    event Cancelled(uint256 indexed redemptionId, address indexed by);
    event SettlementModeUpdated(bool burnOnSettle, address treasury);

    error ZeroAddress();
    error InvalidId();
    error InvalidItem();
    error ItemUnavailable(uint256 itemId);
    error OutOfStock(uint256 itemId);
    error LimitReached(uint256 itemId);
    error NotRegistered(address account);
    error NotPending(uint256 redemptionId);
    error NotAllowed();
    error TreasuryNotAllowed(address treasury);

    constructor(address admin, IAttendCoin token_, IStudentRegistry registry_, address treasury_) {
        if (admin == address(0) || address(token_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        if (treasury_ == address(0)) revert ZeroAddress();
        token = token_;
        registry = registry_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(STORE_MANAGER_ROLE, admin);
    }

    // Catalogue management

    function createItem(
        string calldata name,
        string calldata metadataURI,
        uint256 price,
        uint32 stock,
        uint32 perStudentLimit
    ) external onlyRole(STORE_MANAGER_ROLE) returns (uint256 id) {
        if (bytes(name).length == 0 || bytes(name).length > 64 || price == 0) revert InvalidItem();
        id = ++itemCount;
        _items[id] = Item({
            name: name,
            metadataURI: metadataURI,
            price: price,
            stock: stock,
            perStudentLimit: perStudentLimit,
            active: true
        });
        emit ItemCreated(id, name, price, stock, perStudentLimit);
    }

    function updateItem(uint256 itemId, uint256 price, uint32 stock, uint32 perStudentLimit, bool active)
        external
        onlyRole(STORE_MANAGER_ROLE)
    {
        if (price == 0) revert InvalidItem();
        Item storage it = _item(itemId);
        it.price = price;
        it.stock = stock;
        it.perStudentLimit = perStudentLimit;
        it.active = active;
        emit ItemUpdated(itemId, price, stock, perStudentLimit, active);
    }

    /// @dev In treasury mode the treasury must already be on the token allowlist,
    ///      or every fulfill would revert.
    function setSettlementMode(bool burn, address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (!burn && !token.isAllowed(treasury_)) revert TreasuryNotAllowed(treasury_);
        burnOnSettle = burn;
        treasury = treasury_;
        emit SettlementModeUpdated(burn, treasury_);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // Student actions

    /// @notice Redeem using a prior `approve`.
    function redeem(uint256 itemId) external whenNotPaused nonReentrant returns (uint256) {
        return _redeem(itemId, msg.sender);
    }

    /// @notice Redeem in one transaction with an EIP-2612 permit signature.
    /// @dev The permit call is wrapped in try/catch, so a front-run permit
    ///      (same signature already used) does not block the redemption as
    ///      long as the allowance exists.
    function redeemWithPermit(uint256 itemId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        uint256 price = _item(itemId).price;
        try token.permit(msg.sender, address(this), price, deadline, v, r, s) {} catch {}
        return _redeem(itemId, msg.sender);
    }

    /// @notice A student can cancel their own pending redemption for a full refund.
    /// @dev The refund goes to the student's current wallet, which differs from
    ///      `rd.student` after a re-link. It reverts while the student is
    ///      deactivated, because their wallet is off the allowlist.
    function cancel(uint256 redemptionId) external nonReentrant {
        Redemption storage rd = _redemption(redemptionId);
        uint256 studentId = _studentOf[redemptionId];
        address wallet = registry.getStudent(studentId).wallet;
        if (msg.sender != wallet && !hasRole(STORE_MANAGER_ROLE, msg.sender)) revert NotAllowed();
        if (rd.status != Status.Pending) revert NotPending(redemptionId);

        rd.status = Status.Cancelled;
        rd.settledAt = uint64(block.timestamp);
        Item storage it = _items[rd.itemId];
        // type(uint32).max is how a manager says "unlimited"; incrementing it would overflow.
        if (it.stock < type(uint32).max) ++it.stock;
        --_redeemedCount[rd.itemId][studentId];

        token.safeTransfer(wallet, rd.price);
        emit Cancelled(redemptionId, msg.sender);
    }

    // Vendor actions

    /// @notice Settles the escrow. Hand the reward over only after this is confirmed,
    ///         since the student can cancel any redemption that is still pending.
    function fulfill(uint256 redemptionId) external onlyRole(VENDOR_ROLE) nonReentrant {
        Redemption storage rd = _redemption(redemptionId);
        if (rd.status != Status.Pending) revert NotPending(redemptionId);

        rd.status = Status.Fulfilled;
        rd.settledAt = uint64(block.timestamp);

        bool burned = burnOnSettle;
        if (burned) {
            totalBurned += rd.price;
            token.burn(rd.price);
        } else {
            totalToTreasury += rd.price;
            token.safeTransfer(treasury, rd.price);
        }
        emit Fulfilled(redemptionId, msg.sender, burned);
    }

    // Internals

    function _redeem(uint256 itemId, address student) internal returns (uint256 id) {
        uint256 studentId = registry.studentIdOf(student);
        if (studentId == 0) revert NotRegistered(student);
        Item storage it = _item(itemId);
        if (!it.active) revert ItemUnavailable(itemId);
        if (it.stock == 0) revert OutOfStock(itemId);
        uint32 used = _redeemedCount[itemId][studentId];
        if (it.perStudentLimit != 0 && used >= it.perStudentLimit) revert LimitReached(itemId);

        --it.stock;
        _redeemedCount[itemId][studentId] = used + 1;

        id = ++redemptionCount;
        _redemptions[id] = Redemption({
            itemId: itemId,
            student: student,
            price: it.price,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            status: Status.Pending
        });
        _studentOf[id] = studentId;
        _redemptionsOf[studentId].push(id);

        token.safeTransferFrom(student, address(this), it.price);
        emit Redeemed(id, itemId, student, it.price);
    }

    function _item(uint256 id) internal view returns (Item storage) {
        if (id == 0 || id > itemCount) revert InvalidId();
        return _items[id];
    }

    function _redemption(uint256 id) internal view returns (Redemption storage) {
        if (id == 0 || id > redemptionCount) revert InvalidId();
        return _redemptions[id];
    }

    // Views

    function getItem(uint256 id) external view returns (Item memory) {
        return _item(id);
    }

    function getRedemption(uint256 id) external view returns (Redemption memory) {
        return _redemption(id);
    }

    /// @notice Redemptions of the student currently linked to `student`, including
    ///         ones made from a wallet they were re-linked from.
    function getRedemptionsOf(address student) external view returns (uint256[] memory) {
        return _redemptionsOf[registry.studentIdOf(student)];
    }

    function redeemedCount(uint256 itemId, address student) external view returns (uint32) {
        return _redeemedCount[itemId][registry.studentIdOf(student)];
    }
}

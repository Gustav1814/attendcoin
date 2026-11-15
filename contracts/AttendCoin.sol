// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AttendCoin (ATC)
/// @notice Capped, pausable ERC-20 minted only for verified attendance.
///         The cap limits circulating supply, not lifetime minting: burns free room.
/// @dev Transfers are restricted to campus wallets (registered students, the
///      reward store, the treasury) while `transferRestricted` is on. This stops
///      a secondary market where students buy tokens instead of attending.
///      Minting and burning are never restricted by the allowlist.
contract AttendCoin is ERC20, ERC20Burnable, ERC20Capped, ERC20Pausable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice May add/remove wallets from the transfer allowlist.
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    /// @notice May move a lost wallet's full balance to a re-linked wallet.
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");

    bool public transferRestricted = true;
    mapping(address => bool) public isAllowed;

    event AllowlistUpdated(address indexed account, bool allowed);
    event TransferRestrictionUpdated(bool restricted);
    event BalanceRecovered(address indexed from, address indexed to, uint256 amount);

    error TransferNotAllowed(address from, address to);
    error ZeroAddress();

    constructor(address admin, uint256 cap_)
        ERC20("AttendCoin", "ATC")
        ERC20Capped(cap_)
        ERC20Permit("AttendCoin")
    {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    // Minting

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    // Allowlist

    function setAllowed(address account, bool allowed) external onlyRole(REGISTRAR_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        isAllowed[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    function setTransferRestricted(bool restricted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transferRestricted = restricted;
        emit TransferRestrictionUpdated(restricted);
    }

    // Recovery

    /// @notice Moves the entire balance of a lost wallet to its replacement.
    /// @dev Any RECOVERY_ROLE holder can move any balance, including the store's
    ///      escrow, so the role should only ever be granted to the AttendanceManager.
    ///      Bypasses the allowlist (the old wallet may already be de-listed) but not
    ///      the pause.
    function recover(address from, address to) external onlyRole(RECOVERY_ROLE) returns (uint256 amount) {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        amount = balanceOf(from);
        if (amount > 0) {
            _recovering = true;
            _transfer(from, to, amount);
            _recovering = false;
        }
        emit BalanceRecovered(from, to, amount);
    }

    bool private _recovering;

    // Pausing

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // Overrides

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Capped, ERC20Pausable)
    {
        if (
            transferRestricted && !_recovering && from != address(0) && to != address(0)
                && !(isAllowed[from] && isAllowed[to])
        ) {
            revert TransferNotAllowed(from, to);
        }
        super._update(from, to, value);
    }
}

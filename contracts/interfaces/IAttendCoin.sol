// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAttendCoin is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function cap() external view returns (uint256);
    function setAllowed(address account, bool allowed) external;
    function isAllowed(address account) external view returns (bool);
    function recover(address from, address to) external returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

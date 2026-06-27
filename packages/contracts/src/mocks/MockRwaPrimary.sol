// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockTokens.sol";

/// @title MockRwaPrimary
/// @notice Mercato primario MVP testnet: USDC → token RWA mint 1:1 nominale (6→18 decimali).
/// @dev Whitelist come "router" in SmartVault.executeTrade — stesso pattern del DEX.
contract MockRwaPrimary {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    error InsufficientRwaOut(uint256 expected, uint256 minOut);

    event PrimaryMint(
        address indexed vault, address indexed rwaToken, uint256 usdcIn, uint256 rwaOut
    );

    constructor(address usdc_) {
        require(usdc_ != address(0), "zero usdc");
        usdc = IERC20(usdc_);
    }

    /// @notice Mint RWA al vault chiamante (msg.sender). USDC prelevato via allowance.
    /// @param rwaToken ERC-20 RWA (MockQQQ / MockGLD con mint pubblico test).
    /// @param recipient Destinatario RWA (deve essere il vault).
    /// @param usdcAmount Importo USDC (6 decimali).
    /// @param minRwaOut Slippage minimo su amountOut atteso (18 decimali).
    function mintRwa(
        address rwaToken,
        address recipient,
        uint256 usdcAmount,
        uint256 minRwaOut
    ) external returns (uint256 amountOut) {
        require(rwaToken != address(0) && recipient != address(0), "zero addr");
        require(usdcAmount > 0, "zero amount");

        amountOut = usdcAmount * 1e12;
        if (amountOut < minRwaOut) {
            revert InsufficientRwaOut(amountOut, minRwaOut);
        }

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        MockERC20(rwaToken).mint(recipient, amountOut);

        emit PrimaryMint(msg.sender, rwaToken, usdcAmount, amountOut);
    }
}

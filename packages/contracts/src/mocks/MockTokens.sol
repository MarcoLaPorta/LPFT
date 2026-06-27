// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice ERC-20 con mint pubblico per test locali / Anvil / testnet MVP.
abstract contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint libero per faucet test (non usare in produzione).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Mock USDC — 6 decimali come mainnet USDC.
contract MockUSDC is MockERC20 {
    constructor() MockERC20("Mock USDC", "mUSDC", 6) {}
}

/// @notice Mock QQQ — token RWA sintetico test (18 decimali).
contract MockQQQ is MockERC20 {
    constructor() MockERC20("Mock QQQ", "mQQQ", 18) {}
}

/// @notice Mock GLD — token RWA sintetico test (18 decimali).
contract MockGLD is MockERC20 {
    constructor() MockERC20("Mock GLD", "mGLD", 18) {}
}

/// @notice Router mock per test executeTrade — accetta swapCalldata e restituisce success.
/// @dev In testnet reale sostituire con indirizzo Uniswap V3 Router whitelisted.
contract MockDexRouter {
    event MockSwap(address indexed caller, address assetIn, uint256 amount);

    /// @notice Simula uno swap: trasferisce assetIn dal vault e non fa nulla (MVP test).
    /// @dev Il vault deve approvare questo contratto prima della call.
    function mockSwap(address assetIn, uint256 amount) external {
        emit MockSwap(msg.sender, assetIn, amount);
        // MVP: nessun transfer reale — i test possono estendere con pull + mint assetOut.
    }
}

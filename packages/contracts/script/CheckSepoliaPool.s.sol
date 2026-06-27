// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title CheckSepoliaPool
/// @notice Verifica on-chain pool Uniswap V3 su Arbitrum Sepolia (USDC/WETH 0.3%).
/// @dev forge script script/CheckSepoliaPool.s.sol --rpc-url $ARBITRUM_SEPOLIA_RPC_URL
contract CheckSepoliaPool is Script {
    address constant FACTORY = 0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e;
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant WETH = 0x1bdc540dEB9Ed1fA29964DeEcCc524A8f5e2198e;
    uint24 constant FEE = 3000;

    function run() external view {
        address pool = IUniswapV3Factory(FACTORY).getPool(USDC, WETH, FEE);
        console2.log("Factory", FACTORY);
        console2.log("USDC", USDC);
        console2.log("WETH", WETH);
        console2.log("fee", FEE);
        console2.log("pool", pool);

        if (pool == address(0)) {
            console2.log("ERROR: pool not found - add liquidity on app.uniswap.org");
            return;
        }

        uint128 liq = IUniswapV3Pool(pool).liquidity();
        console2.log("liquidity", liq);
        console2.log("token0", IUniswapV3Pool(pool).token0());
        console2.log("token1", IUniswapV3Pool(pool).token1());

        if (liq == 0) {
            console2.log("WARN: liquidity == 0");
        } else {
            console2.log("OK: pool has liquidity");
        }
    }
}

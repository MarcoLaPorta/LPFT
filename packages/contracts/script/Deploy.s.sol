// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SmartVault} from "../src/SmartVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockUSDC, MockDexRouter, MockQQQ, MockGLD} from "../src/mocks/MockTokens.sol";
import {MockRwaPrimary} from "../src/mocks/MockRwaPrimary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Deploy
/// @notice Deploy testnet/local: implementation + mocks + VaultFactory.
/// @dev Env: PRIVATE_KEY, MANAGER_ADDRESS, optional ROUTER_ADDRESS (Uniswap Sepolia).
///      chain 421614: asset = USDC nativo Sepolia; router = Uniswap + MockRwaPrimary.
contract Deploy is Script {
    address constant ARBITRUM_SEPOLIA_USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant ARBITRUM_SEPOLIA_UNISWAP_ROUTER =
        0x101F443B4d1b059569D643917553c771E1b9663E;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address manager = vm.envAddress("MANAGER_ADDRESS");
        address deployer = vm.addr(deployerKey);
        uint256 chainId = block.chainid;

        vm.startBroadcast(deployerKey);

        IERC20 asset;
        address dexRouter;
        MockQQQ qqq;
        MockGLD gld;
        MockRwaPrimary primary;

        if (chainId == 421614) {
            asset = IERC20(ARBITRUM_SEPOLIA_USDC);
            dexRouter = vm.envOr("ROUTER_ADDRESS", ARBITRUM_SEPOLIA_UNISWAP_ROUTER);
            qqq = new MockQQQ();
            gld = new MockGLD();
            primary = new MockRwaPrimary(ARBITRUM_SEPOLIA_USDC);
        } else {
            MockUSDC usdc = new MockUSDC();
            MockDexRouter router = new MockDexRouter();
            asset = IERC20(address(usdc));
            dexRouter = vm.envOr("ROUTER_ADDRESS", address(router));
            qqq = new MockQQQ();
            gld = new MockGLD();
            primary = new MockRwaPrimary(address(usdc));
            console2.log("MockUSDC", address(usdc));
            console2.log("MockDexRouter", dexRouter);
        }

        address[] memory routers = new address[](2);
        routers[0] = dexRouter;
        routers[1] = address(primary);

        SmartVault implementation = new SmartVault();
        VaultFactory factory = new VaultFactory(
            deployer,
            address(implementation),
            manager,
            asset,
            "AFX Vault Share",
            "afxVAULT",
            routers
        );

        vm.stopBroadcast();

        console2.log("chainId", chainId);
        console2.log("USDC asset", address(asset));
        console2.log("Uniswap/Mock router", dexRouter);
        console2.log("MockRwaPrimary", address(primary));
        console2.log("MockQQQ", address(qqq));
        console2.log("MockGLD", address(gld));
        console2.log("SmartVault implementation", address(implementation));
        console2.log("VaultFactory", address(factory));
        console2.log("MANAGER", manager);
    }
}

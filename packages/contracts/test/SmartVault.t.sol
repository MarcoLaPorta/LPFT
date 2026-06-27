// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SmartVault} from "../src/SmartVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockUSDC, MockDexRouter} from "../src/mocks/MockTokens.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISmartVault} from "../src/interfaces/ISmartVault.sol";

contract SmartVaultTest is Test {
    SmartVault public implementation;
    VaultFactory public factory;
    MockUSDC public usdc;
    MockDexRouter public router;

    address public factoryAdmin = makeAddr("factoryAdmin");
    address public userOwner = makeAddr("userOwner");
    address public keeperManager = makeAddr("keeperManager");
    address public attacker = makeAddr("attacker");

    function setUp() public {
        usdc = new MockUSDC();
        router = new MockDexRouter();
        implementation = new SmartVault();

        address[] memory routers = new address[](1);
        routers[0] = address(router);

        factory = new VaultFactory(
            factoryAdmin,
            address(implementation),
            keeperManager,
            IERC20(address(usdc)),
            "AFX Vault Share",
            "afxVAULT",
            routers
        );
    }

    function test_createVault_clone() public {
        vm.prank(userOwner);
        address vaultAddr = factory.createVault();
        assertEq(factory.vaultOf(userOwner), vaultAddr);
        assertTrue(vaultAddr != address(implementation));
        assertEq(ISmartVault(vaultAddr).manager(), keeperManager);
    }

    function test_onlyOwner_deposit() public {
        vm.prank(userOwner);
        address vaultAddr = factory.createVault();
        SmartVault vault = SmartVault(vaultAddr);

        usdc.mint(userOwner, 1_000_000);
        vm.startPrank(userOwner);
        usdc.approve(vaultAddr, 500_000);
        vault.deposit(500_000, userOwner);
        vm.stopPrank();

        assertEq(vault.balanceOf(userOwner), vault.previewDeposit(500_000));

        vm.prank(attacker);
        vm.expectRevert();
        vault.deposit(1, attacker);
    }

    function test_onlyManager_executeTrade() public {
        vm.prank(userOwner);
        address vaultAddr = factory.createVault();
        SmartVault vault = SmartVault(vaultAddr);

        usdc.mint(userOwner, 1_000_000);
        vm.startPrank(userOwner);
        usdc.approve(vaultAddr, 100_000);
        vault.deposit(100_000, userOwner);
        vm.stopPrank();

        bytes memory swapCalldata =
            abi.encodeWithSelector(MockDexRouter.mockSwap.selector, address(usdc), uint256(10_000));
        bytes memory dexPayload = abi.encode(address(router), swapCalldata);

        vm.prank(keeperManager);
        vault.executeTrade(address(usdc), address(usdc), 10_000, dexPayload);

        vm.prank(keeperManager);
        vm.expectRevert(abi.encodeWithSelector(SmartVault.RouterNotWhitelisted.selector, attacker));
        vault.executeTrade(address(usdc), address(usdc), 1, abi.encode(attacker, swapCalldata));
    }

    function test_duplicateVault_reverts() public {
        vm.startPrank(userOwner);
        factory.createVault();
        vm.expectRevert();
        factory.createVault();
        vm.stopPrank();
    }
}

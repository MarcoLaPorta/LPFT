// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC4626Upgradeable} from
    "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ISmartVault} from "./interfaces/ISmartVault.sol";

/// @title SmartVault
/// @author AFX (Agentic Finance Exchange)
/// @notice Vault ERC-4626 per depositi USDC (o asset configurato). RBAC: OWNER deposit/withdraw, MANAGER trade.
/// @dev Implementazione logica per cloni EIP-1167. La Factory chiama `initialize` dopo `Clones.clone`.
///      `dexPayload` = abi.encode(router, swapCalldata) — calldata costruito off-chain (Uniswap V3, 1inch, …).
contract SmartVault is
    ERC4626Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ISmartVault
{
    using SafeERC20 for IERC20;

    /// @inheritdoc ISmartVault
    address public manager;

    mapping(address => bool) private _whitelistedRouters;

    error OnlyManager();
    error RouterNotWhitelisted(address router);
    error TradeCallFailed();
    error InvalidDexPayload();
    error ZeroAddress();
    error InsufficientVaultBalance(address token, uint256 required, uint256 available);

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc ISmartVault
    function initialize(
        address owner_,
        address manager_,
        IERC20 asset_,
        string calldata name_,
        string calldata symbol_,
        address[] calldata routers_
    ) external initializer {
        if (owner_ == address(0) || manager_ == address(0) || address(asset_) == address(0)) {
            revert ZeroAddress();
        }

        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
        __Ownable_init(owner_);
        __ReentrancyGuard_init();

        manager = manager_;
        _applyRouterWhitelist(routers_);

        emit VaultInitialized(owner_, manager_, address(asset_));
    }

    /// @inheritdoc ISmartVault
    function isWhitelistedRouter(address router) external view returns (bool) {
        return _whitelistedRouters[router];
    }

    /// @inheritdoc ISmartVault
    function setRouterWhitelisted(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        _whitelistedRouters[router] = allowed;
        emit RouterWhitelistUpdated(router, allowed);
    }

    // -------------------------------------------------------------------------
    // ERC-4626 — solo OWNER può depositare / prelevare
    // -------------------------------------------------------------------------

    /// @inheritdoc ERC4626Upgradeable
    function deposit(uint256 assets, address receiver)
        public
        override
        onlyOwner
        returns (uint256 shares)
    {
        return super.deposit(assets, receiver);
    }

    /// @inheritdoc ERC4626Upgradeable
    function mint(uint256 shares, address receiver)
        public
        override
        onlyOwner
        returns (uint256 assets)
    {
        return super.mint(shares, receiver);
    }

    /// @inheritdoc ERC4626Upgradeable
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        onlyOwner
        returns (uint256 shares)
    {
        return super.withdraw(assets, receiver, owner_);
    }

    /// @inheritdoc ERC4626Upgradeable
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        onlyOwner
        returns (uint256 assets)
    {
        return super.redeem(shares, receiver, owner_);
    }

    // -------------------------------------------------------------------------
    // Trading — solo MANAGER, router whitelisted
    // -------------------------------------------------------------------------

    /// @inheritdoc ISmartVault
    /// @dev Sequenza sicura: whitelist → balance check → approve → call router → reset allowance.
    ///      I fondi restano nel vault quando `recipient` nel calldata DEX = address(this).
    function executeTrade(
        address assetIn,
        address assetOut,
        uint256 amount,
        bytes calldata dexPayload
    ) external onlyManager nonReentrant returns (bytes memory result) {
        (address router, bytes memory swapCalldata) = _decodeDexPayload(dexPayload);
        if (!_whitelistedRouters[router]) revert RouterNotWhitelisted(router);
        if (assetIn == address(0) || assetOut == address(0)) revert ZeroAddress();
        if (amount == 0) revert InsufficientVaultBalance(assetIn, amount, 0);

        IERC20 tokenIn = IERC20(assetIn);
        uint256 vaultBalance = tokenIn.balanceOf(address(this));
        if (vaultBalance < amount) {
            revert InsufficientVaultBalance(assetIn, amount, vaultBalance);
        }

        tokenIn.forceApprove(router, amount);

        (bool success, bytes memory returnData) = router.call(swapCalldata);
        if (!success) {
            tokenIn.forceApprove(router, 0);
            _revertWithRouterReturn(returnData);
        }

        tokenIn.forceApprove(router, 0);

        emit TradeExecuted(msg.sender, router, assetIn, assetOut, amount, returnData);
        return returnData;
    }

    /// @notice Decodifica payload: abi.encode(address router, bytes swapCalldata).
    function _decodeDexPayload(bytes calldata dexPayload)
        internal
        pure
        returns (address router, bytes memory swapCalldata)
    {
        if (dexPayload.length < 64) revert InvalidDexPayload();
        (router, swapCalldata) = abi.decode(dexPayload, (address, bytes));
        if (router == address(0)) revert ZeroAddress();
    }

    /// @dev Propaga il revert originale del router (es. Uniswap "Too little received") per debug Keeper.
    function _revertWithRouterReturn(bytes memory returnData) internal pure {
        if (returnData.length == 0) revert TradeCallFailed();
        assembly ("memory-safe") {
            revert(add(returnData, 32), mload(returnData))
        }
    }

    function _applyRouterWhitelist(address[] calldata routers_) internal {
        uint256 len = routers_.length;
        for (uint256 i; i < len; ++i) {
            address r = routers_[i];
            if (r == address(0)) revert ZeroAddress();
            _whitelistedRouters[r] = true;
            emit RouterWhitelistUpdated(r, true);
        }
    }
}

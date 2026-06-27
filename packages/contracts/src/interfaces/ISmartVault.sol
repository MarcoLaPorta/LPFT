// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ISmartVault
/// @notice Interfaccia vault ERC-4626 AFX con RBAC OWNER / MANAGER.
interface ISmartVault {
    /// @notice Emesso alla creazione del clone (Factory).
    event VaultInitialized(address indexed owner, address indexed manager, address indexed asset);

    /// @notice Trade eseguito dal MANAGER verso un router whitelisted.
    event TradeExecuted(
        address indexed manager,
        address indexed router,
        address indexed assetIn,
        address assetOut,
        uint256 amountIn,
        bytes result
    );

    /// @notice Router aggiunto o rimosso dalla whitelist (solo OWNER).
    event RouterWhitelistUpdated(address indexed router, bool allowed);

    /// @notice Inizializza un clone EIP-1167 (chiamata una sola volta dalla Factory).
    /// @param owner_ Utente OWNER — unico autorizzato a deposit/withdraw.
    /// @param manager_ Backend keeper — unico autorizzato a executeTrade.
    /// @param asset_ Token sottostante ERC-4626 (es. USDC).
    /// @param name_ Nome share token vault.
    /// @param symbol_ Simbolo share token vault.
    /// @param routers_ Router DEX iniziali whitelisted.
    function initialize(
        address owner_,
        address manager_,
        IERC20 asset_,
        string calldata name_,
        string calldata symbol_,
        address[] calldata routers_
    ) external;

    /// @notice Indirizzo MANAGER (keeper backend).
    function manager() external view returns (address);

    /// @notice True se il router può essere target di executeTrade.
    function isWhitelistedRouter(address router) external view returns (bool);

    /// @notice Aggiorna whitelist router (solo OWNER).
    function setRouterWhitelisted(address router, bool allowed) external;

    /// @notice Esegue swap via router whitelisted. Solo MANAGER.
    /// @dev `dexPayload` = abi.encode(address router, bytes swapCalldata).
    /// @param assetIn Token in uscita dal vault.
    /// @param assetOut Token atteso in entrata (informativo / eventi).
    /// @param amount Quantità di assetIn da swappare.
    /// @param dexPayload ABI-encoded (router, calldata) per la call esterna.
    function executeTrade(
        address assetIn,
        address assetOut,
        uint256 amount,
        bytes calldata dexPayload
    ) external returns (bytes memory result);
}

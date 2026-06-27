// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISmartVault} from "./interfaces/ISmartVault.sol";
import {SmartVault} from "./SmartVault.sol";

/// @title VaultFactory
/// @author AFX (Agentic Finance Exchange)
/// @notice Deploya cloni EIP-1167 (minimal proxy) di SmartVault per ogni utente OWNER.
/// @dev Una implementation condivisa; ogni utente ottiene un vault isolato con lo stesso MANAGER backend.
contract VaultFactory is Ownable {
    /// @notice Emesso quando un nuovo vault clone è creato.
    event VaultCreated(
        address indexed owner,
        address indexed vault,
        address indexed asset,
        uint256 vaultIndex
    );

    /// @notice Router aggiunto alla whitelist globale (propagato ai nuovi vault + opzionale sync).
    event GlobalRouterWhitelisted(address indexed router, bool allowed);

    /// @notice Indirizzo implementation SmartVault (logica condivisa).
    address public immutable implementation;

    /// @notice Keeper / backend autorizzato come MANAGER su ogni vault clonato.
    address public immutable manager;

    /// @notice Asset ERC-4626 sottostante (es. MockUSDC / USDC testnet).
    IERC20 public immutable asset;

    /// @notice Nome e simbolo share token per i cloni.
    string public vaultShareName;
    string public vaultShareSymbol;

    /// @notice Router whitelisted a livello factory (copiati in ogni nuovo vault).
    address[] public globalRouters;
    mapping(address => bool) public isGlobalRouter;

    /// @notice owner => vault clone
    mapping(address => address) public vaultOf;

    /// @notice Tutti i vault deployati (indice → indirizzo).
    address[] public allVaults;

    error VaultAlreadyExists(address owner);
    error OnlyOwnerCanCreate(address caller, address owner);
    error ZeroAddress();
    error RouterAlreadyListed(address router);
    error RouterNotListed(address router);

    /// @param owner_ Amministratore factory (deployer / governance testnet).
    /// @param implementation_ Contratto SmartVault implementation (non clone).
    /// @param manager_ Indirizzo EOA/contratto MANAGER (keeper backend).
    /// @param asset_ Token sottostante vault (USDC).
    /// @param shareName_ Nome ERC-20 share (es. "AFX Vault Share").
    /// @param shareSymbol_ Simbolo share (es. "afxVAULT").
    /// @param routers_ Router DEX iniziali whitelisted.
    constructor(
        address owner_,
        address implementation_,
        address manager_,
        IERC20 asset_,
        string memory shareName_,
        string memory shareSymbol_,
        address[] memory routers_
    ) Ownable(owner_) {
        if (
            implementation_ == address(0) || manager_ == address(0) || address(asset_) == address(0)
                || owner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        implementation = implementation_;
        manager = manager_;
        asset = asset_;
        vaultShareName = shareName_;
        vaultShareSymbol = shareSymbol_;
        _bootstrapGlobalRouters(routers_);
    }

    /// @notice Crea un clone EIP-1167 per il chiamante (`msg.sender` = OWNER).
    /// @return vault Indirizzo del clone SmartVault.
    function createVault() external returns (address vault) {
        address owner_ = msg.sender;
        if (owner_ == address(0)) revert ZeroAddress();
        if (vaultOf[owner_] != address(0)) revert VaultAlreadyExists(owner_);

        vault = Clones.clone(implementation);
        ISmartVault(vault).initialize(
            owner_,
            manager,
            asset,
            vaultShareName,
            vaultShareSymbol,
            globalRouters
        );

        vaultOf[owner_] = vault;
        allVaults.push(vault);

        emit VaultCreated(owner_, vault, address(asset), allVaults.length - 1);
    }

    /// @notice Numero totale di vault deployati.
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /// @notice Aggiunge un router alla whitelist globale (nuovi vault + policy off-chain).
    /// @dev I vault esistenti richiedono `setRouterWhitelisted` dall'OWNER o redeploy.
    function addGlobalRouter(address router) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        if (isGlobalRouter[router]) revert RouterAlreadyListed(router);
        isGlobalRouter[router] = true;
        globalRouters.push(router);
        emit GlobalRouterWhitelisted(router, true);
    }

    /// @notice Rimuove un router dalla lista globale (non modifica vault già deployati).
    function removeGlobalRouter(address router) external onlyOwner {
        if (!isGlobalRouter[router]) revert RouterNotListed(router);
        isGlobalRouter[router] = false;
        uint256 len = globalRouters.length;
        for (uint256 i; i < len; ++i) {
            if (globalRouters[i] == router) {
                globalRouters[i] = globalRouters[len - 1];
                globalRouters.pop();
                break;
            }
        }
        emit GlobalRouterWhitelisted(router, false);
    }

    /// @notice Predice l'indirizzo clone prima del deploy (CREATE2 non usato; solo stima salt-less).
    /// @dev EIP-1167 standard clone: indirizzo non deterministico senza CREATE2 — ritorna address(0).
    function predictVaultAddress(address /* owner_ */ ) external pure returns (address) {
        return address(0);
    }

    function _bootstrapGlobalRouters(address[] memory routers_) internal {
        uint256 len = routers_.length;
        for (uint256 i; i < len; ++i) {
            address r = routers_[i];
            if (r == address(0)) revert ZeroAddress();
            if (!isGlobalRouter[r]) {
                isGlobalRouter[r] = true;
                globalRouters.push(r);
                emit GlobalRouterWhitelisted(r, true);
            }
        }
    }
}

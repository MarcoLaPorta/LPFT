"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnits,
  parseUnits,
  type Address,
  zeroAddress,
} from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { erc20Abi, smartVaultAbi, vaultFactoryAbi } from "../../lib/web3/abis";
import { chainById } from "../../lib/web3/chains";
import { useWeb3Config, type Web3RuntimeConfig } from "../../lib/web3/use-web3-config";

const DEFAULT_DEPOSIT = "100";

type TxPhase = "idle" | "approve" | "deposit" | "createVault";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function syncVaultToBackend(payload: {
  wallet: string;
  vaultAddress: string;
  chainId: number;
  deploymentTxHash?: string;
  managerAddress?: string;
}) {
  await fetch("/api/vault/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function VaultDashboardSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="lpft-skeleton-block h-24" />
        <div className="lpft-skeleton-block h-24" />
      </div>
      <div className="lpft-skeleton-block h-10 w-48" />
    </div>
  );
}

function VaultDashboardContent({ web3 }: { web3: Web3RuntimeConfig }) {
  const { address, isConnected, chain } = useAccount();
  const factoryAddress = web3.factoryAddress;
  const envUsdc = web3.usdcAddress;
  const targetChainId = web3.chainId;
  const web3Ready = web3.configured;
  const chainOk = chain?.id === targetChainId;

  const [depositAmount, setDepositAmount] = useState(DEFAULT_DEPOSIT);
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const { data: vaultAddress, refetch: refetchVault } = useReadContract({
    address: factoryAddress,
    abi: vaultFactoryAbi,
    functionName: "vaultOf",
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!address && web3Ready,
      refetchInterval: 12_000,
      retry: 2,
    },
  });

  const hasVault =
    vaultAddress != null && vaultAddress !== zeroAddress;

  const { data: factoryAsset } = useReadContract({
    address: factoryAddress,
    abi: vaultFactoryAbi,
    functionName: "asset",
    query: { enabled: web3Ready },
  });

  const { data: factoryManager } = useReadContract({
    address: factoryAddress,
    abi: vaultFactoryAbi,
    functionName: "manager",
    query: { enabled: web3Ready },
  });

  const usdcAddress = (factoryAsset ?? envUsdc) as Address;

  const { data: decimals } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: usdcAddress !== zeroAddress },
  });

  const { data: symbol } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: usdcAddress !== zeroAddress },
  });

  const tokenDecimals = decimals ?? 6;
  const tokenLabel = symbol ?? "USDC";

  const { data: walletBalance, refetch: refetchWalletBal } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && usdcAddress !== zeroAddress },
  });

  const { data: vaultTotalAssets, refetch: refetchVaultAssets } = useReadContract({
    address: hasVault ? (vaultAddress as Address) : undefined,
    abi: smartVaultAbi,
    functionName: "totalAssets",
    query: { enabled: hasVault },
  });

  const parsedDeposit = useMemo(() => {
    try {
      return parseUnits(depositAmount || "0", tokenDecimals);
    } catch {
      return 0n;
    }
  }, [depositAmount, tokenDecimals]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && hasVault
        ? [address, vaultAddress as Address]
        : undefined,
    query: {
      enabled: !!address && hasVault && usdcAddress !== zeroAddress,
    },
  });

  const needsApproval =
    parsedDeposit > 0n && (allowance == null || allowance < parsedDeposit);

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
  } = useWriteContract();

  const confirmedTxRef = useRef<string | null>(null);

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const busy = isPending || isConfirming;

  useEffect(() => {
    if (!isConfirmed || !receipt) return;
    const txId = receipt.transactionHash;
    if (confirmedTxRef.current === txId) return;
    confirmedTxRef.current = txId;

    async function afterConfirm() {
      if (txPhase === "createVault" && address) {
        await refetchVault();
        const v = (await refetchVault()).data;
        if (v && v !== zeroAddress) {
          await syncVaultToBackend({
            wallet: address,
            vaultAddress: v,
            chainId: targetChainId,
            deploymentTxHash: receipt.transactionHash,
            managerAddress: factoryManager ?? undefined,
          });
        }
        setStatusMsg("Vault creato on-chain.");
      } else if (txPhase === "approve") {
        await refetchAllowance();
        setStatusMsg("Approvazione USDC confermata. Ora puoi depositare.");
      } else if (txPhase === "deposit") {
        await Promise.all([refetchWalletBal(), refetchVaultAssets(), refetchAllowance()]);
        setStatusMsg("Deposito confermato nel vault.");
      }
      setTxPhase("idle");
    }

    void afterConfirm();
  }, [
    isConfirmed,
    receipt,
    txPhase,
    address,
    refetchVault,
    refetchAllowance,
    refetchWalletBal,
    refetchVaultAssets,
    targetChainId,
    factoryManager,
  ]);

  function writeErrorMessage(): string | null {
    if (!writeError) return null;
    const e = writeError as { shortMessage?: string; message?: string };
    return e.shortMessage ?? e.message ?? "Transazione fallita";
  }

  function onCreateVault() {
    if (!chainOk) {
      setStatusMsg(`Passa alla chain ${targetChainId} in MetaMask.`);
      return;
    }
    setStatusMsg(null);
    setTxPhase("createVault");
    writeContract({
      chain: chain ?? chainById(targetChainId),
      account: address,
      address: factoryAddress,
      abi: vaultFactoryAbi,
      functionName: "createVault",
    });
  }

  function onApprove() {
    if (!hasVault || !address) return;
    if (!chainOk) {
      setStatusMsg(`Passa alla chain ${targetChainId} in MetaMask.`);
      return;
    }
    if (parsedDeposit <= 0n) {
      setStatusMsg("Inserisci un importo valido.");
      return;
    }
    setStatusMsg(null);
    setTxPhase("approve");
    writeContract({
      chain: chain ?? chainById(targetChainId),
      account: address,
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [vaultAddress as Address, parsedDeposit],
    });
  }

  function onDeposit() {
    if (!hasVault || !address) return;
    if (!chainOk) {
      setStatusMsg(`Passa alla chain ${targetChainId} in MetaMask.`);
      return;
    }
    if (parsedDeposit <= 0n) {
      setStatusMsg("Inserisci un importo valido.");
      return;
    }
    if (needsApproval) {
      setStatusMsg("Approva prima l'USDC.");
      return;
    }
    setStatusMsg(null);
    setTxPhase("deposit");
    writeContract({
      chain: chain ?? chainById(targetChainId),
      account: address,
      address: vaultAddress as Address,
      abi: smartVaultAbi,
      functionName: "deposit",
      args: [parsedDeposit, address],
    });
  }

  if (!web3Ready) {
    return (
      <div className="lpft-alert lpft-alert--warning" role="alert">
        <p className="lpft-alert-title">Web3 non configurato</p>
        <p className="mt-1 text-[12px] opacity-90">
          Imposta <code>NEXT_PUBLIC_AFX_VAULT_FACTORY_ADDRESS</code> e{" "}
          <code>NEXT_PUBLIC_AFX_USDC_ADDRESS</code> in <code>apps/web/.env.local</code> (dopo{" "}
          <code>forge script</code> in <code>packages/contracts</code>), poi riavvia{" "}
          <code>npm run dev</code> da <code>apps/web</code>.
        </p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="lpft-alert lpft-alert--info">
        <p>Connetti il wallet per creare il vault o depositare {tokenLabel}.</p>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          Rete locale: avvia Anvil con{" "}
          <code>anvil --chain-id 31337 --port 8545</code> e MetaMask su Localhost 8545.
        </p>
      </div>
    );
  }

  const walletFormatted =
    walletBalance != null
      ? formatUnits(walletBalance, tokenDecimals)
      : "—";
  const vaultFormatted =
    vaultTotalAssets != null
      ? formatUnits(vaultTotalAssets, tokenDecimals)
      : "0";

  return (
    <div className="space-y-5 text-[13px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="lpft-stat-card">
          <p className="lpft-stat-card-label">Wallet</p>
          <p className="lpft-stat-card-value">{address ? shortAddr(address) : "—"}</p>
          <p className="lpft-stat-card-meta">
            Saldo {tokenLabel}:{" "}
            <span className="text-[var(--text-primary)]">{walletFormatted}</span>
          </p>
        </div>
        <div className="lpft-stat-card">
          <p className="lpft-stat-card-label">Smart Vault</p>
          {hasVault ? (
            <>
              <p className="lpft-stat-card-value break-all">
                {shortAddr(vaultAddress as string)}
              </p>
              <p className="lpft-stat-card-meta">
                Deposito vault:{" "}
                <span className="text-[var(--text-primary)]">
                  {vaultFormatted} {tokenLabel}
                </span>
              </p>
            </>
          ) : (
            <p className="lpft-stat-card-meta">Nessun vault — creane uno.</p>
          )}
        </div>
      </div>

      {!chainOk && (
        <div className="lpft-alert lpft-alert--warning text-[12px]" role="status">
          Rete attuale: {chain?.name ?? "?"} (id {chain?.id}). Richiesta: chain id {targetChainId}.
        </div>
      )}

      {!hasVault ? (
        <button
          type="button"
          onClick={onCreateVault}
          disabled={busy || !chainOk}
          className="btn-primary rounded-[var(--radius)] px-4 py-2 text-[13px] disabled:opacity-40"
        >
          {busy && txPhase === "createVault"
            ? isConfirming
              ? "Conferma vault…"
              : "Firma creazione…"
            : "Crea Smart Vault"}
        </button>
      ) : (
        <div className="lpft-form-panel space-y-3">
          <label className="block text-[12px] text-[var(--text-tertiary)]">
            Importo deposito ({tokenLabel})
            <input
              type="text"
              inputMode="decimal"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="lpft-input"
              placeholder="100"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={busy || !needsApproval || parsedDeposit <= 0n || !chainOk}
              className="lpft-btn-secondary px-4 py-2 text-[13px]"
            >
              {busy && txPhase === "approve"
                ? isConfirming
                  ? "Conferma approve…"
                  : "Firma approve…"
                : needsApproval
                  ? "1. Approva USDC"
                  : "USDC già approvato"}
            </button>
            <button
              type="button"
              onClick={onDeposit}
              disabled={busy || needsApproval || parsedDeposit <= 0n || !chainOk}
              className="btn-primary rounded-[var(--radius)] px-4 py-2 text-[13px] disabled:opacity-40"
            >
              {busy && txPhase === "deposit"
                ? isConfirming
                  ? "Conferma deposito…"
                  : "Firma deposito…"
                : "2. Deposita nel Vault"}
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Solo l&apos;OWNER può depositare. Il MANAGER eseguirà i trade (fase Keeper).
          </p>
        </div>
      )}

      {statusMsg ? (
        <p className="text-[12px] text-[var(--accent)]">{statusMsg}</p>
      ) : null}
      {writeError && txPhase === "idle" ? (
        <p className="text-[12px] text-[var(--danger)]">{writeErrorMessage()}</p>
      ) : null}
      {txHash ? (
        <p className="font-mono text-[11px] text-[var(--text-tertiary)]">
          tx: {shortAddr(txHash)}
        </p>
      ) : null}
    </div>
  );
}

/** Evita mismatch SSR/client su stato wallet wagmi (connect, chain, balances). */
export function VaultDashboard() {
  const [mounted, setMounted] = useState(false);
  const { config, loading } = useWeb3Config();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || loading || !config) {
    return <VaultDashboardSkeleton />;
  }

  return <VaultDashboardContent web3={config} />;
}

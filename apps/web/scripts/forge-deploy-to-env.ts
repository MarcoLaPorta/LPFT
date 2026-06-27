/**
 * Legge broadcast Foundry e stampa righe per apps/web/.env.local
 *
 * npm run deploy:parse-forge -- 421614
 * npm run deploy:parse-forge -- 31337
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(__dirname, "../../../packages/contracts");

const ARBITRUM_SEPOLIA_USDC = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";
const ARBITRUM_SEPOLIA_UNISWAP = "0x101f443b4d1b059569d643917553c771e1b9663e";

type BroadcastTx = {
  contractName?: string;
  contractAddress?: string;
};

type BroadcastFile = {
  chain?: number | string;
  transactions?: BroadcastTx[];
};

function loadBroadcast(chainId: number): BroadcastFile {
  const p = path.join(
    contractsRoot,
    "broadcast",
    "Deploy.s.sol",
    String(chainId),
    "run-latest.json",
  );
  if (!existsSync(p)) {
    throw new Error(`File non trovato: ${p}\nEsegui prima forge script --broadcast.`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as BroadcastFile;
}

function findAddress(txs: BroadcastTx[], name: string): string | null {
  const row = txs.find((t) => t.contractName === name && t.contractAddress);
  return row?.contractAddress?.toLowerCase() ?? null;
}

function main(): void {
  const chainArg = process.argv[2]?.trim();
  const chainId = chainArg ? Number(chainArg) : 421614;
  if (!Number.isFinite(chainId)) {
    console.error("Uso: npm run deploy:parse-forge -- <chainId>");
    process.exit(1);
  }

  const data = loadBroadcast(chainId);
  const txs = data.transactions ?? [];
  const mockUsdc = findAddress(txs, "MockUSDC");
  const mockRouter = findAddress(txs, "MockDexRouter");
  const factory = findAddress(txs, "VaultFactory");
  const primary = findAddress(txs, "MockRwaPrimary");
  const mqqq = findAddress(txs, "MockQQQ");
  const mgld = findAddress(txs, "MockGLD");

  if (!factory) {
    console.error("Broadcast incompleto (VaultFactory mancante).");
    process.exit(1);
  }

  const isLocal = chainId === 31337;
  const usdc = isLocal ? mockUsdc : ARBITRUM_SEPOLIA_USDC;
  const router = isLocal ? mockRouter : ARBITRUM_SEPOLIA_UNISWAP;

  if (!usdc) {
    console.error("USDC address mancante nel broadcast.");
    process.exit(1);
  }

  const rpcLocal = "http://127.0.0.1:8545";
  const rpcSepolia =
    process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() ??
    "https://sepolia-rollup.arbitrum.io/rpc";

  console.log(`# --- AFX deploy chainId=${chainId} ---`);
  console.log(`NEXT_PUBLIC_AFX_CHAIN_ID=${chainId}`);
  console.log(`AFX_CHAIN_ID=${chainId}`);
  if (isLocal) {
    console.log(`NEXT_PUBLIC_RPC_LOCAL=${rpcLocal}`);
    console.log(`AFX_RPC_URL=${rpcLocal}`);
  } else {
    console.log(`ARBITRUM_SEPOLIA_RPC_URL=${rpcSepolia}`);
    console.log(`NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC=${rpcSepolia}`);
    console.log(`AFX_RPC_URL=${rpcSepolia}`);
  }
  console.log(`NEXT_PUBLIC_AFX_VAULT_FACTORY_ADDRESS=${factory}`);
  console.log(`NEXT_PUBLIC_AFX_USDC_ADDRESS=${usdc}`);
  console.log(`AFX_VAULT_FACTORY_ADDRESS=${factory}`);
  if (router) {
    console.log(`AFX_DEX_ROUTER_ADDRESS=${router}`);
  }
  if (primary) {
    console.log(`AFX_RWA_PRIMARY_ADDRESS=${primary}`);
    console.log(`NEXT_PUBLIC_AFX_RWA_PRIMARY_ADDRESS=${primary}`);
  }
  if (mqqq) {
    console.log(`AFX_RWA_MQQQ_ADDRESS=${mqqq}`);
    console.log(`NEXT_PUBLIC_AFX_RWA_MQQQ_ADDRESS=${mqqq}`);
  }
  if (mgld) {
    console.log(`AFX_RWA_MGLD_ADDRESS=${mgld}`);
    console.log(`NEXT_PUBLIC_AFX_RWA_MGLD_ADDRESS=${mgld}`);
  }
  console.log(`# MANAGER_ADDRESS e MANAGER_PRIVATE_KEY: stesso wallet usato al deploy`);
  console.log(`# AFX_ONCHAIN_CONFIRM_MODE=real`);
  console.log(`# Poi: npm run seed:web3 && npm run seed:rwa && npm run dev:restart`);
}

main();

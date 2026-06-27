import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { arbitrumSepolia } from "wagmi/chains";
import { createConfig, http } from "wagmi";
import { anvilLocal, afxChains } from "./chains";

const localRpc =
  process.env.NEXT_PUBLIC_RPC_LOCAL?.trim() ?? "http://127.0.0.1:8545";

const sepoliaRpc =
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC?.trim() ??
  process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() ??
  "https://sepolia-rollup.arbitrum.io/rpc";

const appName = "LPFT AFX";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

/**
 * Solo Browser Wallet (injected → MetaMask/Rabby nel browser).
 * Evita metaMaskWallet (MetaMask SDK) che causa "Connection interrupted while trying to subscribe".
 */
const connectors = connectorsForWallets(
  [
    {
      groupName: "Browser",
      wallets: [injectedWallet],
    },
  ],
  {
    appName,
    projectId: walletConnectProjectId || "00000000000000000000000000000001",
  },
);

export const wagmiConfig = createConfig({
  chains: [...afxChains],
  connectors,
  ssr: false,
  transports: {
    [anvilLocal.id]: http(localRpc, {
      batch: true,
      retryCount: 3,
      retryDelay: 1_000,
      timeout: 15_000,
      pollingInterval: 4_000,
    }),
    [arbitrumSepolia.id]: http(sepoliaRpc, {
      retryCount: 2,
      timeout: 20_000,
      pollingInterval: 12_000,
    }),
  },
});

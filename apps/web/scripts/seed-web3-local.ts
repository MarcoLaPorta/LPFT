/**
 * Seed whitelist router + factory config (Anvil 31337 o Arbitrum Sepolia 421614).
 *
 * DATABASE_URL=... npm run seed:web3
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { defaultUniswapV3Router } from "../lib/web3/uniswap-v3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

config({ path: path.join(webRoot, ".env.local") });
config({ path: path.join(webRoot, ".env") });

const prisma = new PrismaClient();

/** Router default per chain se AFX_DEX_ROUTER_ADDRESS non impostato. */
function defaultRouterForChain(chainId: number): string {
  if (chainId === 421614 || chainId === 1 || chainId === 42161) {
    return defaultUniswapV3Router(chainId);
  }
  return "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
}

function routerLabel(chainId: number): string {
  if (chainId === 421614) return "Uniswap V3 SwapRouter02 (Arbitrum Sepolia)";
  if (chainId === 42161 || chainId === 1) return "Uniswap V3 SwapRouter02";
  return "MockDexRouter (Anvil local)";
}

async function main(): Promise<void> {
  const chainId = Number(process.env.AFX_CHAIN_ID ?? process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? "31337");
  const router =
    process.env.AFX_DEX_ROUTER_ADDRESS?.trim()?.toLowerCase() ??
    defaultRouterForChain(chainId);
  const factory =
    process.env.AFX_VAULT_FACTORY_ADDRESS?.trim() ??
    process.env.NEXT_PUBLIC_AFX_VAULT_FACTORY_ADDRESS?.trim();

  const protocol = chainId === 31337 ? "OTHER" : "UNISWAP_V3";

  await prisma.whitelistedDexRouter.upsert({
    where: {
      chainId_address: { chainId, address: router.toLowerCase() },
    },
    create: {
      chainId,
      address: router.toLowerCase(),
      name: routerLabel(chainId),
      protocol,
      active: true,
    },
    update: { active: true, name: routerLabel(chainId), protocol },
  });

  if (factory) {
    await prisma.vaultFactoryConfig.upsert({
      where: { chainId },
      create: { chainId, factoryAddress: factory.toLowerCase() },
      update: { factoryAddress: factory.toLowerCase() },
    });
  }

  const primary =
    process.env.AFX_RWA_PRIMARY_ADDRESS?.trim()?.toLowerCase() ??
    process.env.NEXT_PUBLIC_AFX_RWA_PRIMARY_ADDRESS?.trim()?.toLowerCase();
  if (primary) {
    await prisma.whitelistedDexRouter.upsert({
      where: { chainId_address: { chainId, address: primary } },
      create: {
        chainId,
        address: primary,
        name: "MockRwaPrimary (mint/burn testnet)",
        protocol: "OTHER",
        active: true,
      },
      update: { active: true, name: "MockRwaPrimary (mint/burn testnet)" },
    });
    console.log(`seed:web3 primary=${primary}`);
  }

  console.log(`seed:web3 chainId=${chainId} router=${router} protocol=${protocol}`);
  if (factory) console.log(`seed:web3 factory=${factory}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Seed RwaToken registry + whitelist MockRwaPrimary (dopo deploy Foundry).
 *
 * DATABASE_URL=... AFX_RWA_MQQQ_ADDRESS=0x... AFX_RWA_MGLD_ADDRESS=0x... \
 *   AFX_RWA_PRIMARY_ADDRESS=0x... npm run seed:rwa
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

config({ path: path.join(webRoot, ".env.local") });
config({ path: path.join(webRoot, ".env") });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const chainId = Number(process.env.AFX_CHAIN_ID ?? process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? "421614");
  const mqqq = process.env.AFX_RWA_MQQQ_ADDRESS?.trim()?.toLowerCase();
  const mgld = process.env.AFX_RWA_MGLD_ADDRESS?.trim()?.toLowerCase();
  const primary = process.env.AFX_RWA_PRIMARY_ADDRESS?.trim()?.toLowerCase();

  if (mqqq) {
    await prisma.rwaToken.upsert({
      where: { chainId_tokenAddress: { chainId, tokenAddress: mqqq } },
      create: {
        chainId,
        symbol: "mQQQ",
        tokenAddress: mqqq,
        underlyingTicker: "QQQ",
        decimals: 18,
        primaryWindowOnly: true,
        active: true,
        metadata: { kind: "mock_rwa", equities: ["QQQ", "SPY", "AAPL", "MSFT", "NVDA"] },
      },
      update: { symbol: "mQQQ", underlyingTicker: "QQQ", active: true },
    });
  }

  if (mgld) {
    await prisma.rwaToken.upsert({
      where: { chainId_tokenAddress: { chainId, tokenAddress: mgld } },
      create: {
        chainId,
        symbol: "mGLD",
        tokenAddress: mgld,
        underlyingTicker: "GLD",
        decimals: 18,
        primaryWindowOnly: true,
        active: true,
        metadata: { kind: "mock_rwa" },
      },
      update: { symbol: "mGLD", underlyingTicker: "GLD", active: true },
    });
  }

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
  }

  console.log(`seed:rwa chainId=${chainId} mQQQ=${mqqq ?? "skip"} mGLD=${mgld ?? "skip"} primary=${primary ?? "skip"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

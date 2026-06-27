import { NextResponse } from "next/server";
import { isAddress } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";

function readAddress(...keys: string[]): string {
  for (const key of keys) {
    const raw = process.env[key]?.trim();
    if (raw && isAddress(raw)) return raw;
  }
  return ZERO;
}

/** Indirizzi Web3 letti lato server (sempre aggiornati con .env.local al riavvio dev). */
export async function GET() {
  const factoryAddress = readAddress(
    "NEXT_PUBLIC_AFX_VAULT_FACTORY_ADDRESS",
    "AFX_VAULT_FACTORY_ADDRESS",
  );
  const usdcAddress = readAddress(
    "NEXT_PUBLIC_AFX_USDC_ADDRESS",
    "AFX_USDC_ADDRESS",
  );
  const chainId = Number(
    process.env.NEXT_PUBLIC_AFX_CHAIN_ID ??
      process.env.AFX_CHAIN_ID ??
      "31337",
  );
  const configured = factoryAddress !== ZERO;

  return NextResponse.json({
    factoryAddress,
    usdcAddress,
    chainId: Number.isFinite(chainId) ? chainId : 31337,
    configured,
  });
}

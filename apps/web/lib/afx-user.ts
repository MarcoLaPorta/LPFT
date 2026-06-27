import { prisma } from "./prisma";

/** Normalizza indirizzo EVM per lookup Prisma (`wallet_address` univoco). */
export function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export async function getOrCreateUserByWallet(walletAddress: string) {
  const w = normalizeWalletAddress(walletAddress);
  const existing = await prisma.user.findUnique({ where: { walletAddress: w } });
  if (existing) return existing;
  return prisma.user.create({ data: { walletAddress: w } });
}

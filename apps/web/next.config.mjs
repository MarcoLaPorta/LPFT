import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Evita che Prisma venga “incluso” nel bundle server in modi che rompono il runtime (Vercel / Turbopack). */
  serverExternalPackages: ["@prisma/client", "prisma"],
  /** Monorepo: traccia dipendenze da apps/web, non dalla root Documents. */
  outputFileTracingRoot: path.join(appDir, "../.."),
};

export default nextConfig;

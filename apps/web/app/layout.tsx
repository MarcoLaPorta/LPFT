import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "LPFT · AFX Fiduciary Quant",
  description: "Agentic Finance Exchange — intent-based quant execution e mercati US.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body
        className="antialiased min-h-screen bg-[var(--bg-primary)] text-[var(--text)]"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

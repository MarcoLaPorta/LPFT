import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LPFT",
  description: "LPFT - Piattaforma di trading algoritmico",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased min-h-screen bg-[var(--bg-primary)] text-[var(--text)]">
        {children}
      </body>
    </html>
  );
}

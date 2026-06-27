import Link from "next/link";

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-zinc-100">Demo paper trading</h1>
      <p className="mt-3 text-sm text-zinc-400">
        Questa pagina non è più disponibile: l’integrazione broker di prova è stata rimossa dal progetto.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-sm text-emerald-400 hover:underline">
          Torna alla home
        </Link>
        {" · "}
        <Link href="/exchange" className="text-sm text-emerald-400 hover:underline">
          Exchange
        </Link>
      </p>
    </div>
  );
}

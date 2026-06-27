import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 bg-black px-6 py-16">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-violet-400/90">
          Agentic Finance Exchange
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          Quant terminal
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-zinc-400">
          Backtest su dati Yahoo, tool Anthropic con validazione Zod, log RLFF in
          PostgreSQL. Interfaccia nera / viola, polling stato esecuzione.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/terminal"
          className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500"
        >
          Apri terminale
        </Link>
        <Link
          href="/api/health"
          className="rounded-lg border border-white/10 bg-zinc-950 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-violet-500/40"
        >
          /api/health
        </Link>
      </div>
      <p className="font-mono text-xs text-zinc-600">
        Dev <span className="text-zinc-500">:3001</span> — imposta{" "}
        <code className="text-violet-300/80">ANTHROPIC_API_KEY</code> in{" "}
        <code className="text-zinc-500">.env.local</code>
      </p>
    </main>
  );
}

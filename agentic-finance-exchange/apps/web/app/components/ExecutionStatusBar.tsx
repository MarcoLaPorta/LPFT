"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

export function ExecutionStatusBar(props: {
  executionLogId: string | null;
  walletAddress: string;
}) {
  const { executionLogId, walletAddress } = props;
  const url = executionLogId
    ? `/api/execution/${executionLogId}?wallet=${encodeURIComponent(walletAddress)}`
    : null;

  const { data, error } = useSWR(url, fetcher, {
    refreshInterval: executionLogId ? 2000 : 0,
    revalidateOnFocus: true,
  });

  if (!executionLogId) {
    return (
      <div className="border-t border-white/10 bg-black/60 px-4 py-2 text-center font-mono text-[11px] text-zinc-600">
        Nessun ExecutionLog attivo — avvia una proposta dalla chat.
      </div>
    );
  }

  return (
    <div className="border-t border-white/10 bg-black/70 px-4 py-2 font-mono text-[11px]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-zinc-400">
        <span className="text-zinc-500">EXEC</span>
        <span className="max-w-[14rem] truncate text-zinc-300">{executionLogId}</span>
        {error ? (
          <span className="text-red-400/90">poll error</span>
        ) : (
          <span
            className={
              data?.executionStatus === "CONFIRMED"
                ? "text-emerald-400"
                : data?.executionStatus === "FAILED"
                  ? "text-red-400"
                  : "animate-pulse text-violet-300"
            }
          >
            {data?.executionStatus ?? "…"}
          </span>
        )}
        {data?.transactionHash ? (
          <span className="max-w-[10rem] truncate text-zinc-500" title={data.transactionHash}>
            {data.transactionHash}
          </span>
        ) : null}
      </div>
    </div>
  );
}

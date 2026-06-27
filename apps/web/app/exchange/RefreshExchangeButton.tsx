"use client";

import { useRouter } from "next/navigation";

export function RefreshExchangeButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="lpft-btn-secondary px-3 py-1.5 text-[12px]"
    >
      Aggiorna
    </button>
  );
}

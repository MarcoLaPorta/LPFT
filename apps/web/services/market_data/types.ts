export type OhlcvInterval = "1d" | "1wk" | "1mo";

/** Barra giornaliera: `adjClose` è l'unico prezzo usato dal motore quant. */
export type AdjCloseBar = {
  date: string;
  adjClose: number;
  volume: number;
};

import type { MarketDataIntentClass } from "./router";

export type FetchHistoryOptions = {
  period1: Date;
  period2: Date;
  interval?: OhlcvInterval;
  /** Routing Tier 1: intento strategia per provider Alpaca vs Yahoo. */
  intentClass?: MarketDataIntentClass;
};

/** Matrice prezzi densa: stesso calendario master per tutti i simboli. */
export type PriceMatrix = {
  calendar: string[];
  symbols: string[];
  /** symbol → adjClose[i] allineato a `calendar` (forward-fill, mai undefined). */
  prices: Record<string, number[]>;
};

export type AlignedPriceRow = {
  date: string;
  assetClose: number;
  benchClose: number;
};

/** @deprecated Usare AdjCloseBar — mantenuto per compatibilità API. */
export type OhlcvBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

import type { SimulatedTrade } from "./types";

type OpenLeg = {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  entryEquity: number;
  reasonEntry: string;
  entryFee: number;
};

export class TradeJournal {
  readonly trades: SimulatedTrade[] = [];
  private open = new Map<string, OpenLeg>();
  private tradeIndex = 0;

  recordEntry(
    symbol: string,
    date: string,
    price: number,
    portfolioValue: number,
    reason: string,
    entryFee = 0,
  ): void {
    if (this.open.has(symbol)) return;
    this.open.set(symbol, {
      symbol,
      entryDate: date,
      entryPrice: price,
      entryEquity: portfolioValue,
      reasonEntry: reason,
      entryFee,
    });
  }

  recordExit(
    symbol: string,
    date: string,
    price: number,
    portfolioValue: number,
    reason: string,
    exitFee = 0,
  ): void {
    const leg = this.open.get(symbol);
    if (!leg) return;
    const pnlEquity = portfolioValue - leg.entryEquity;
    const pnlFrac = leg.entryEquity > 0 ? portfolioValue / leg.entryEquity - 1 : 0;
    const totalFee = leg.entryFee + exitFee;
    this.trades.push({
      tradeIndex: ++this.tradeIndex,
      side: "LONG",
      symbol,
      entryDate: leg.entryDate,
      exitDate: date,
      entryPrice: leg.entryPrice,
      exitPrice: price,
      entryEquity: leg.entryEquity,
      exitEquity: portfolioValue,
      pnlFrac,
      pnlEquity,
      reasonEntry: leg.reasonEntry,
      reasonExit: reason,
      transactionFee: totalFee,
    });
    this.open.delete(symbol);
  }

  syncSymbol(
    symbol: string,
    wasHeld: boolean,
    nowHeld: boolean,
    date: string,
    price: number,
    portfolioValue: number,
    enterReason: string,
    exitReason: string,
    legFee = 0,
  ): void {
    if (!wasHeld && nowHeld) {
      this.recordEntry(symbol, date, price, portfolioValue, enterReason, legFee);
    }
    if (wasHeld && !nowHeld) {
      this.recordExit(symbol, date, price, portfolioValue, exitReason, legFee);
    }
  }

  finalizeAll(date: string, prices: Record<string, number>, portfolioValue: number): void {
    for (const sym of [...this.open.keys()]) {
      const px = prices[sym] ?? 0;
      this.recordExit(sym, date, px, portfolioValue, "end_of_backtest");
    }
  }
}

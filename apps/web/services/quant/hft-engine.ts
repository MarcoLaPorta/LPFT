import {
  applyHftFeeToFill,
  hftMakerLimitPrice,
  hftTakerBuyFill,
  hftTakerSellFill,
  makerTakeProfitLimitPrice,
  type FeeBps,
} from "./trading-friction";
import { sampleGammaLatencyMs } from "./hft-latency";
import { LimitQueuePositionEstimator, type LimitOrderPurpose } from "./hft-limit-queue";
import { SpreadToxicityGuard, spreadBpsFromBook } from "./hft-toxicity";
import type {
  HFTOrderBookSnapshot,
  HFTScalpTrade,
  HFTSessionResult,
  HFTStrategyConfig,
  HFTTick,
} from "./hft-types";

export type { HFTStrategyConfig, HFTSessionResult, HFTTick, HFTOrderBookSnapshot } from "./hft-types";

export type HFTTier1Options = {
  /** Guardia spread μ+σ (default true). */
  toxicityGuard?: boolean;
  /** Campiona latenza Gamma ~25ms se non passata (default true). */
  gammaLatency?: boolean;
};

/** OBI sotto questa soglia → cancel entry buy (adverse selection). */
export const HFT_OBI_ADVERSE_CANCEL_THRESHOLD = 0.3;

function orderBookImbalance(book: HFTOrderBookSnapshot): number {
  const bidVol = book.bids.reduce((s, l) => s + l.size, 0);
  const askVol = book.asks.reduce((s, l) => s + l.size, 0);
  const total = bidVol + askVol;
  if (total <= 0) return 0.5;
  return bidVol / total;
}

function midPrice(book: HFTOrderBookSnapshot): number {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
  return book.bids[0]?.price ?? book.asks[0]?.price ?? 0;
}

/**
 * Motore HFT asincrono — percorso parallelo al loop giornaliero di event-driven-engine.
 * Sprint 5: maker entry + maker TP exit; stop loss sempre taker; fee maker/taker separate.
 */
export class HFTExecutionEngine {
  private readonly config: HFTStrategyConfig;
  private readonly tier1: HFTTier1Options;
  private readonly fees: FeeBps;
  private readonly toxicity = new SpreadToxicityGuard({ sigmaMultiplier: 1 });
  private readonly limitQueue = new LimitQueuePositionEstimator();
  private pendingLimitId: string | null = null;
  private pendingLimitPurpose: LimitOrderPurpose | null = null;
  private position: "flat" | "long" | "short" = "flat";
  private entryPrice = 0;
  private entryTs = 0;
  private entryReason = "";
  private trades: HFTScalpTrade[] = [];
  private ticksProcessed = 0;
  private bookUpdates = 0;
  private halted = false;
  private haltReason?: string;
  private latencySamples: number[] = [];
  private lastTickTs = 0;
  private lastObservedPrice = 0;
  private lastBook: HFTOrderBookSnapshot | null = null;
  private tradeSeq = 0;
  private limitSeq = 0;
  private sessionStartTs = 0;
  private pendingLimitPlacedTs = 0;
  /** Annulla limit pending dopo N ms simulati senza fill (default 5 min). */
  private readonly pendingLimitTtlMs = 300_000;

  constructor(config: HFTStrategyConfig, tier1: HFTTier1Options = {}) {
    this.config = config;
    this.fees = { makerFeeBps: config.makerFeeBps, takerFeeBps: config.takerFeeBps };
    this.tier1 = {
      toxicityGuard: tier1.toxicityGuard !== false,
      gammaLatency: tier1.gammaLatency !== false,
    };
  }

  private resolveLatency(observedLatencyMs: number): number {
    if (observedLatencyMs > 0) return observedLatencyMs;
    if (!this.tier1.gammaLatency) return 0;
    return Math.round(sampleGammaLatencyMs({ meanMs: 25, shapeK: 2 }));
  }

  private takerEntryFill(side: "long" | "short", book: HFTOrderBookSnapshot): number {
    const slip = this.config.slippageBps;
    const raw =
      side === "long"
        ? hftTakerBuyFill(book, slip)
        : hftTakerSellFill(book, slip);
    const leg = side === "long" ? "buy" : "sell";
    return applyHftFeeToFill(raw, leg, this.fees, false);
  }

  /** Stop loss e force-flat: uscita taker aggressiva. */
  private takerExitFill(side: "long" | "short", book: HFTOrderBookSnapshot | null, mid: number): number {
    const slip = this.config.slippageBps;
    if (side === "long") {
      const raw = book?.bids[0]
        ? hftTakerSellFill(book, slip)
        : mid * (1 - slip / 10_000);
      return applyHftFeeToFill(raw, "sell", this.fees, false);
    }
    const raw = book?.asks[0]
      ? hftTakerBuyFill(book, slip)
      : mid * (1 + slip / 10_000);
    return applyHftFeeToFill(raw, "buy", this.fees, false);
  }

  /** PnL mark-to-market conservativo (taker exit) per stop loss. */
  private unrealizedPnlBpsTaker(markPrice: number): number {
    if (this.position === "flat" || this.entryPrice <= 0) return 0;
    const exitPx = this.takerExitFill(this.position, this.lastBook, markPrice);
    return this.position === "long"
      ? ((exitPx - this.entryPrice) / this.entryPrice) * 10000
      : ((this.entryPrice - exitPx) / this.entryPrice) * 10000;
  }

  private processPendingLimitOnTick(tick: HFTTick): void {
    if (!this.pendingLimitId) return;
    const order = this.limitQueue.get(this.pendingLimitId);
    if (!order) return;
    const crossed =
      (order.side === "buy" && tick.price <= order.price + 1e-9) ||
      (order.side === "sell" && tick.price >= order.price - 1e-9);
    const filledIds = crossed
      ? [this.pendingLimitId]
      : this.limitQueue.applyTradedVolumeAtLevel(tick.price, tick.size);
    if (filledIds.includes(this.pendingLimitId)) {
      this.fillPendingLimit(
        order,
        tick.ts,
        crossed ? "maker_limit_crossed" : "maker_limit_filled",
      );
    }
  }

  /** Mock: ricezione tick trade-by-trade. */
  async onTick(tick: HFTTick, observedLatencyMs = 0): Promise<void> {
    if (this.halted) return;
    const latency = this.resolveLatency(observedLatencyMs);
    this.ticksProcessed += 1;
    this.lastTickTs = tick.ts;
    this.lastObservedPrice = tick.price;
    if (this.sessionStartTs === 0) this.sessionStartTs = tick.ts;
    if (latency > 0) this.latencySamples.push(latency);

    if (this.pendingLimitId) {
      this.processPendingLimitOnTick(tick);
    }

    if (latency > this.config.maxLatencyMs) {
      await this.forceFlat(tick.ts, tick.price, "latency_exceeded");
      this.halted = true;
      this.haltReason = `Latency ${latency}ms > max ${this.config.maxLatencyMs}ms`;
      return;
    }

    const elapsedSec = (tick.ts - this.sessionStartTs) / 1000;
    if (elapsedSec >= this.config.executionTimeoutSeconds) {
      await this.forceFlat(tick.ts, tick.price, "session_timeout");
      this.halted = true;
      this.haltReason = "executionTimeoutSeconds reached";
      return;
    }

    if (this.position !== "flat") {
      const moveBps = this.unrealizedPnlBpsTaker(tick.price);
      if (moveBps <= -this.config.microStopLossBps) {
        await this.closePositionTaker(tick.ts, tick.price, "micro_stop_loss");
        return;
      }
      if (!this.config.useLimitOrdersOnly && moveBps >= this.config.targetProfitBps) {
        await this.closePositionTaker(tick.ts, tick.price, "target_profit");
      }
    }
  }

  /** Mock: aggiornamento order book L2. */
  async onOrderBookUpdate(book: HFTOrderBookSnapshot, observedLatencyMs = 0): Promise<void> {
    if (this.halted) return;
    const latency = this.resolveLatency(observedLatencyMs);
    this.bookUpdates += 1;
    this.lastBook = book;
    if (latency > 0) this.latencySamples.push(latency);

    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    if (this.tier1.toxicityGuard && bestBid > 0 && bestAsk > 0) {
      const spreadBps = spreadBpsFromBook(bestBid, bestAsk);
      this.toxicity.observeSpreadBps(spreadBps);
      if (this.toxicity.isToxic()) {
        this.halted = true;
        this.haltReason = this.toxicity.haltReason() ?? "spread_toxicity";
        await this.forceFlat(book.ts, midPrice(book), "spread_toxicity");
        return;
      }
    }

    const imb = orderBookImbalance(book);
    const px = midPrice(book);
    if (px <= 0) return;
    this.lastObservedPrice = px;

    this.maybeCancelEntryOnAdverseObi(imb);

    if (this.pendingLimitId) {
      this.tryFillPendingLimitOnBook(book);
      if (
        this.pendingLimitPlacedTs > 0 &&
        book.ts - this.pendingLimitPlacedTs > this.pendingLimitTtlMs
      ) {
        this.cancelPendingLimit();
      }
    }

    const trigger = this.config.orderBookImbalanceTrigger;

    if (this.position === "flat" && !this.pendingLimitId) {
      if (imb >= trigger) {
        if (this.config.useLimitOrdersOnly) {
          this.placeLimitEntry("buy", book);
        } else {
          const fill = this.takerEntryFill("long", book);
          if (fill > 0) this.openPosition("long", book.ts, fill, "taker_market_bid");
        }
      } else if (imb <= 1 - trigger) {
        if (this.config.useLimitOrdersOnly) {
          this.placeLimitEntry("sell", book);
        } else {
          const fill = this.takerEntryFill("short", book);
          if (fill > 0) this.openPosition("short", book.ts, fill, "taker_market_ask");
        }
      }
    } else if (this.position !== "flat") {
      const moveBps = this.unrealizedPnlBpsTaker(px);
      if (moveBps <= -this.config.microStopLossBps) {
        await this.closePositionTaker(book.ts, px, "micro_stop_loss");
        return;
      }
      if (!this.config.useLimitOrdersOnly && moveBps >= this.config.targetProfitBps) {
        await this.closePositionTaker(book.ts, px, "target_profit");
      } else if (
        this.config.useLimitOrdersOnly &&
        !this.pendingLimitId
      ) {
        this.placeLimitExit(book);
      }
    }
  }

  /** Cancel entry limit se OBI gira contro la direzione dell'ordine (adverse selection). */
  private maybeCancelEntryOnAdverseObi(imb: number): void {
    if (!this.pendingLimitId || this.pendingLimitPurpose !== "entry") return;
    const order = this.limitQueue.get(this.pendingLimitId);
    if (!order) return;
    const adverseLong = order.side === "buy" && imb < HFT_OBI_ADVERSE_CANCEL_THRESHOLD;
    const adverseShort = order.side === "sell" && imb > 1 - HFT_OBI_ADVERSE_CANCEL_THRESHOLD;
    if (adverseLong || adverseShort) {
      this.cancelPendingLimit();
    }
  }

  private fillPendingLimit(
    order: { orderId: string; price: number; side: "buy" | "sell"; purpose?: LimitOrderPurpose },
    ts: number,
    reason: string,
  ): void {
    const purpose = order.purpose ?? this.pendingLimitPurpose ?? "entry";
    this.limitQueue.remove(order.orderId);
    this.pendingLimitId = null;
    this.pendingLimitPurpose = null;
    this.pendingLimitPlacedTs = 0;

    if (purpose === "exit") {
      const leg = order.side === "sell" ? "sell" : "buy";
      const exitPrice = applyHftFeeToFill(order.price, leg, this.fees, true);
      this.recordClose(ts, exitPrice, "maker_target_profit");
    } else {
      const side = order.side === "buy" ? "long" : "short";
      const leg = side === "long" ? "buy" : "sell";
      const fillPx = applyHftFeeToFill(order.price, leg, this.fees, true);
      this.openPosition(side, ts, fillPx, reason);
      if (this.config.useLimitOrdersOnly && this.lastBook) {
        this.placeLimitExit(this.lastBook);
      }
    }
  }

  private tryFillPendingLimitOnBook(book: HFTOrderBookSnapshot): void {
    if (!this.pendingLimitId) return;
    const order = this.limitQueue.get(this.pendingLimitId);
    if (!order) return;
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    const crossed =
      (order.side === "buy" && bestAsk > 0 && bestAsk <= order.price + 1e-9) ||
      (order.side === "sell" && bestBid > 0 && bestBid >= order.price - 1e-9);
    if (crossed) {
      this.fillPendingLimit(order, book.ts, "maker_book_crossed");
    }
  }

  private cancelPendingLimit(): void {
    if (this.pendingLimitId) {
      this.limitQueue.remove(this.pendingLimitId);
      this.pendingLimitId = null;
      this.pendingLimitPurpose = null;
      this.pendingLimitPlacedTs = 0;
    }
  }

  private placeLimitEntry(side: "buy" | "sell", book: HFTOrderBookSnapshot): void {
    const price = hftMakerLimitPrice(side, book);
    if (price <= 0) return;
    const level = side === "buy" ? book.bids[0] : book.asks[0];
    if (!level) return;
    const id = `lim-${++this.limitSeq}`;
    this.limitQueue.placeLimitOrder({
      orderId: id,
      price,
      side,
      size: 1,
      levelSize: level.size,
      placedAt: book.ts,
      purpose: "entry",
    });
    this.pendingLimitId = id;
    this.pendingLimitPurpose = "entry";
    this.pendingLimitPlacedTs = book.ts;
  }

  /** Take profit passivo: limit exit in coda L2 al livello targetProfitBps. */
  private placeLimitExit(book: HFTOrderBookSnapshot): void {
    if (this.position === "flat" || this.pendingLimitId) return;
    const exitSide = this.position === "long" ? "sell" : "buy";
    const price = makerTakeProfitLimitPrice(
      this.position,
      this.entryPrice,
      this.config.targetProfitBps,
      this.config.makerFeeBps,
    );
    if (price <= 0) return;
    const level = exitSide === "sell" ? book.asks[0] : book.bids[0];
    const id = `lim-exit-${++this.limitSeq}`;
    this.limitQueue.placeLimitOrder({
      orderId: id,
      price,
      side: exitSide,
      size: 1,
      levelSize: level?.size ?? 1,
      placedAt: book.ts,
      purpose: "exit",
    });
    this.pendingLimitId = id;
    this.pendingLimitPurpose = "exit";
    this.pendingLimitPlacedTs = book.ts;
  }

  private openPosition(side: "long" | "short", ts: number, price: number, reason: string): void {
    this.position = side;
    this.entryPrice = price;
    this.entryTs = ts;
    this.entryReason = reason;
  }

  private recordClose(ts: number, exitPrice: number, reason: string): void {
    if (this.position === "flat") return;
    const pnlBps =
      this.position === "long"
        ? ((exitPrice - this.entryPrice) / this.entryPrice) * 10000
        : ((this.entryPrice - exitPrice) / this.entryPrice) * 10000;

    this.tradeSeq += 1;
    this.trades.push({
      tradeIndex: this.tradeSeq,
      entryTs: this.entryTs,
      exitTs: ts,
      entryPrice: this.entryPrice,
      exitPrice,
      side: this.position,
      pnlBps,
      reasonEntry: this.entryReason,
      reasonExit: reason,
    });
    this.position = "flat";
    this.entryPrice = 0;
    this.entryTs = 0;
    this.entryReason = "";
  }

  private async closePositionTaker(ts: number, markPrice: number, reason: string): Promise<void> {
    if (this.position === "flat") return;
    this.cancelPendingLimit();
    const exitPrice = this.takerExitFill(this.position, this.lastBook, markPrice);
    this.recordClose(ts, exitPrice, reason);
  }

  private async forceFlat(ts: number, price: number, reason: string): Promise<void> {
    this.cancelPendingLimit();
    if (this.position !== "flat") {
      await this.closePositionTaker(ts, price, reason);
    }
  }

  getLastObservedPrice(): number {
    return this.lastObservedPrice > 0 ? this.lastObservedPrice : 100;
  }

  /** Chiude sessione e restituisce metriche aggregate. */
  async finalize(lastPrice: number): Promise<HFTSessionResult> {
    if (this.position !== "flat" && this.lastTickTs > 0) {
      await this.forceFlat(this.lastTickTs, lastPrice, "finalize");
    }
    const totalPnlBps = this.trades.reduce((s, t) => s + t.pnlBps, 0);
    const avgLatencyMs =
      this.latencySamples.length > 0
        ? this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length
        : 0;

    return {
      ticksProcessed: this.ticksProcessed,
      bookUpdates: this.bookUpdates,
      trades: this.trades,
      totalPnlBps,
      halted: this.halted,
      haltReason: this.haltReason,
      avgLatencyMs,
    };
  }
}

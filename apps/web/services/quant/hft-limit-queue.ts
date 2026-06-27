/**
 * Stima posizione in coda per ordini limit (L2 depth al livello).
 */

export type LimitOrderPurpose = "entry" | "exit";

export type LimitQueueState = {
  orderId: string;
  price: number;
  side: "buy" | "sell";
  size: number;
  queueAhead: number;
  placedAt: number;
  purpose: LimitOrderPurpose;
};

export class LimitQueuePositionEstimator {
  private readonly orders = new Map<string, LimitQueueState>();

  placeLimitOrder(input: {
    orderId: string;
    price: number;
    side: "buy" | "sell";
    size: number;
    levelSize: number;
    placedAt: number;
    purpose?: LimitOrderPurpose;
  }): LimitQueueState {
    const queueAhead = Math.min(Math.max(0, input.levelSize * 0.02), 3);
    const state: LimitQueueState = {
      orderId: input.orderId,
      price: input.price,
      side: input.side,
      size: input.size,
      queueAhead,
      placedAt: input.placedAt,
      purpose: input.purpose ?? "entry",
    };
    this.orders.set(input.orderId, state);
    return state;
  }

  /** Volume eseguito al livello del nostro prezzo (riduce la coda davanti). */
  applyTradedVolumeAtLevel(price: number, volume: number): string[] {
    const filled: string[] = [];
    for (const [id, o] of this.orders) {
      if (Math.abs(o.price - price) > 1e-9) continue;
      o.queueAhead = Math.max(0, o.queueAhead - volume);
      if (o.queueAhead <= 0) filled.push(id);
    }
    return filled;
  }

  get(orderId: string): LimitQueueState | undefined {
    return this.orders.get(orderId);
  }

  remove(orderId: string): void {
    this.orders.delete(orderId);
  }
}

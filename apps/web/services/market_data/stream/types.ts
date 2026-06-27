import type { HFTOrderBookSnapshot, HFTTick } from "../../quant/hft-types";

export type StreamSubscription = {
  trades?: boolean;
  quotes?: boolean;
};

export type StreamHandlers = {
  onTick?: (tick: HFTTick) => void;
  onOrderBook?: (book: HFTOrderBookSnapshot) => void;
  onError?: (err: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

/**
 * Event-driven market stream (L2 + ticks). Implementazioni: Alpaca live, TickReplay.
 */
export interface IWebSocketMarketStream {
  readonly provider: string;
  connect(symbols: string[]): Promise<void>;
  subscribe(symbols: string[], sub?: StreamSubscription): void;
  setHandlers(handlers: StreamHandlers): void;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

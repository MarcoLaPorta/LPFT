import type { HFTOrderBookSnapshot, HFTTick } from "../../quant/hft-types";
import { getAlpacaConfig } from "../alpaca-config";
import type {
  IWebSocketMarketStream,
  StreamHandlers,
  StreamSubscription,
} from "./types";

type AlpacaWsMessage = {
  T?: string;
  S?: string;
  t?: string;
  p?: number;
  s?: number;
  bp?: number;
  ap?: number;
  bs?: number;
  as?: number;
  msg?: string;
};

/**
 * Alpaca Market Data v2 WebSocket (IEX feed).
 */
export class AlpacaStreamAdapter implements IWebSocketMarketStream {
  readonly provider = "alpaca";

  private ws: WebSocket | null = null;
  private handlers: StreamHandlers = {};
  private symbols: string[] = [];
  private connected = false;

  setHandlers(handlers: StreamHandlers): void {
    this.handlers = handlers;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(symbols: string[]): Promise<void> {
    const cfg = getAlpacaConfig();
    if (!cfg) {
      throw new Error("Alpaca stream: credenziali mancanti (ALPACA_API_KEY / ALPACA_API_SECRET)");
    }
    this.symbols = symbols.map((s) => s.toUpperCase());
    await this.openSocket(cfg.streamUrl, cfg.apiKey, cfg.apiSecret);
  }

  subscribe(symbols: string[], sub: StreamSubscription = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const syms = symbols.map((s) => s.toUpperCase());
    const trades = sub.trades !== false;
    const quotes = sub.quotes !== false;
    if (!trades && !quotes) return;
    this.ws.send(
      JSON.stringify({
        action: "subscribe",
        trades: trades ? syms : undefined,
        quotes: quotes ? syms : undefined,
      }),
    );
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.ws) {
      const w = this.ws;
      this.ws = null;
      w.close();
    }
    this.handlers.onDisconnect?.();
  }

  private openSocket(url: string, key: string, secret: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "auth", key, secret }));
      };

      ws.onmessage = (ev) => {
        const payload = JSON.parse(String(ev.data)) as AlpacaWsMessage | AlpacaWsMessage[];
        const msgs = Array.isArray(payload) ? payload : [payload];
        for (const msg of msgs) {
          if (msg.T === "success" && msg.msg === "authenticated") {
            this.connected = true;
            this.handlers.onConnect?.();
            if (this.symbols.length) {
              this.subscribe(this.symbols, { trades: true, quotes: true });
            }
            if (!settled) {
              settled = true;
              resolve();
            }
            continue;
          }
          if (msg.T === "error") {
            const err = new Error(`Alpaca stream error: ${JSON.stringify(msg)}`);
            this.handlers.onError?.(err);
            if (!settled) {
              settled = true;
              reject(err);
            }
            continue;
          }
          this.dispatch(msg);
        }
      };

      ws.onerror = () => {
        const err = new Error("Alpaca WebSocket error");
        this.handlers.onError?.(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.onclose = () => {
        this.connected = false;
        this.handlers.onDisconnect?.();
      };
    });
  }

  private dispatch(msg: AlpacaWsMessage): void {
    const ts = msg.t ? new Date(msg.t).getTime() : Date.now();

    if (msg.T === "t" && msg.p != null && msg.s != null) {
      const tick: HFTTick = { ts, price: msg.p, size: msg.s };
      this.handlers.onTick?.(tick);
    }

    if (msg.T === "q" && msg.bp != null && msg.ap != null) {
      const bid = msg.bp;
      const ask = msg.ap;
      const book: HFTOrderBookSnapshot = {
        ts,
        bids: [{ price: bid, size: msg.bs ?? 1 }],
        asks: [{ price: ask, size: msg.as ?? 1 }],
      };
      this.handlers.onOrderBook?.(book);
    }
  }
}

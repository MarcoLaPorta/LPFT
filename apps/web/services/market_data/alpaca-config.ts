export type AlpacaConfig = {
  apiKey: string;
  apiSecret: string;
  dataBaseUrl: string;
  streamUrl: string;
  paper: boolean;
};

export function getAlpacaConfig(): AlpacaConfig | null {
  const apiKey = process.env.ALPACA_API_KEY?.trim();
  const apiSecret = process.env.ALPACA_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;

  const paper = process.env.ALPACA_PAPER !== "false";
  // Tick/quote storici: API dati production (sandbox spesso vuota su crypto/equity).
  const dataBaseUrl =
    process.env.ALPACA_DATA_BASE_URL?.trim() || "https://data.alpaca.markets";
  const streamUrl =
    process.env.ALPACA_STREAM_URL?.trim() ||
    (paper
      ? "wss://stream.data.sandbox.alpaca.markets/v2/iex"
      : "wss://stream.data.alpaca.markets/v2/iex");

  return { apiKey, apiSecret, dataBaseUrl, streamUrl, paper };
}

export function isAlpacaConfigured(): boolean {
  return getAlpacaConfig() !== null;
}

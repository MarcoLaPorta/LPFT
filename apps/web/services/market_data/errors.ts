export type MarketDataErrorCode =
  | "TICKER_FETCH_FAILED"
  | "TICKER_EMPTY_SERIES"
  | "TICKER_INSUFFICIENT_BARS"
  | "MATRIX_EMPTY"
  | "MATRIX_INSUFFICIENT_DAYS"
  | "SYMBOL_MISSING_FROM_MATRIX";

export class MarketDataError extends Error {
  readonly code: MarketDataErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: MarketDataErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
    this.details = details;
  }
}

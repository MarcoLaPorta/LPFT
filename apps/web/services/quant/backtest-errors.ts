export class BacktestEngineError extends Error {
  readonly code: "INSUFFICIENT_CALENDAR" | "DEGENERATE_RESULT";

  constructor(code: BacktestEngineError["code"], message: string) {
    super(message);
    this.name = "BacktestEngineError";
    this.code = code;
  }
}

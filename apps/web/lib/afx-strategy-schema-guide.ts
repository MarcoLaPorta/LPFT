/**
 * Riferimento statico per prompt caching — allineato a buildQuantitativeStrategySchema (Zod strict).
 * Non sostituisce la validazione runtime; guida l'LLM sui campi Tier 1.
 */
export const AFX_STRATEGY_SCHEMA_GUIDE = `
SCHEMA buildQuantitativeStrategy (campi principali — .strict(), chiavi extra rifiutate):
- intentClass: WALLET_MANAGEMENT | ALGORITHMIC_TRADING | HIGH_FREQUENCY_SCALPING
- intentSummary: stringa 10-600 caratteri
- universe: { assets: string[], baseCurrency: "USDC" }
- walletLogic (solo A): rebalanceFrequency MONTHLY|QUARTERLY|NONE, weighting
- algoLogic (solo B): SOLO { signal, sma?, rsi?, zScore?, asymmetricTrendMomentum? } — MAI annidare intentClass/universe/riskManagement/hftLogic/backtest qui
- hftLogic (solo C): … replayLookbackDays (default 30), replayMaxSessions (default 30)
- riskManagement (sempre, a livello ROOT):
  - maxDrawdownLimit, stopLossPercentage, trailingStop, liquidateToBaseOnMaxDrawdown
  - makerFeeBps (default 0), takerFeeBps (default 5), slippageBps
  - fractionalKelly (default 0.25 = quarter-Kelly), enableKellyCap (default true)
- backtest: { primaryTicker, benchmark default ^GSPC, timeframe 1y|2y|5y } — timeframe solo per A/B

STRUTTURA ROOT OBBLIGATORIA:
{ intentClass, intentSummary, universe, riskManagement, backtest?, walletLogic?, algoLogic?, hftLogic?, marketRoutingMode? }
DO NOT nest parameters inside algoLogic unless explicitly defined in algoLogic schema. Flatten risk parameters at root.

- marketRoutingMode: PRIMARY_* | SECONDARY_AMM

OUTPUT TOOL HFT (dopo backtest tick multi-giorno):
- hftMetrics: sessionPnLBps, winRate, tradeCount — non usare CAGR/Sharpe daily

OUTPUT TOOL daily (dopo backtest OHLCV):
- metrics: cagr, sharpe, maxDrawdown (TS orchestration)
- tier1Validation (DELEGATED TO LPFT PYTHON): dsr, cvar, cpcv, monte_carlo 10k paths
- regimeAnalysis: proxy TS su Covid 2020, bear 2022, rate shock 2023
- pitGuardEnabled: true se motore usa Point-in-Time
`.trim();

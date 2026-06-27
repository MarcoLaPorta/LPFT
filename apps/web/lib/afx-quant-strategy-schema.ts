import { z } from "zod";

export const intentClassSchema = z.enum([
  "WALLET_MANAGEMENT",
  "ALGORITHMIC_TRADING",
  "HIGH_FREQUENCY_SCALPING",
]);

export const rebalanceFrequencySchema = z.enum(["MONTHLY", "QUARTERLY", "NONE"]);

export const weightingSchema = z.enum(["RISK_PARITY", "EQUAL_WEIGHT", "SINGLE_ASSET"]);

export const signalSchema = z.enum([
  "SMA_CROSSOVER",
  "RSI",
  "Z_SCORE",
  "MACRO_ALLOCATION",
  "MACRO_REGIME_BREAKOUT",
  "DUAL_MOMENTUM",
  "ASYMMETRIC_TREND_MOMENTUM",
]);

export const walletLogicSchema = z
  .object({
    rebalanceFrequency: rebalanceFrequencySchema,
    weighting: weightingSchema,
    macroNotes: z.string().max(500).optional(),
  })
  .strict();

export const smaParamsSchema = z
  .object({
    fastPeriod: z.number().int().min(2).max(120),
    slowPeriod: z.number().int().min(5).max(250),
  })
  .strict();

export const rsiParamsSchema = z
  .object({
    period: z.number().int().min(2).max(100),
    oversold: z.number().min(5).max(45).default(30),
    overbought: z.number().min(55).max(95).default(70),
  })
  .strict();

export const zScoreParamsSchema = z
  .object({
    lookback: z.number().int().min(10).max(120),
    entryZ: z.number().min(-4).max(0).default(-2),
    exitZ: z.number().min(0).max(4).default(0),
  })
  .strict();

export const asymmetricTrendMomentumParamsSchema = z
  .object({
    lookbackPeriodDays: z.number().int().min(20).max(252).default(90),
    equitySmaPeriod: z.number().int().min(20).max(250).default(100),
    cryptoEmaPeriod: z.number().int().min(10).max(200).default(50),
    equityTicker: z.string().min(1).default("QQQ"),
    cryptoTicker: z.string().min(1).default("BTC-USD"),
    safeHavenTicker: z.string().min(1).default("GLD"),
  })
  .strict();

/** Solo segnali e parametri indicatori — MAI annidare intentClass/universe/riskManagement qui. */
export const algoLogicSchema = z
  .object({
    signal: signalSchema,
    sma: smaParamsSchema.optional(),
    rsi: rsiParamsSchema.optional(),
    zScore: zScoreParamsSchema.optional(),
    asymmetricTrendMomentum: asymmetricTrendMomentumParamsSchema.optional(),
  })
  .strict();

export const riskManagementSchema = z
  .object({
    maxDrawdownLimit: z.number().min(0.02).max(0.5),
    stopLossPercentage: z.number().min(0.01).max(0.35),
    trailingStop: z.boolean(),
    liquidateToBaseOnMaxDrawdown: z.boolean().default(true),
    /** Fee maker istituzionale (bps sul notional). Default 0 = rebate/zero. */
    makerFeeBps: z.number().min(0).max(500).default(0),
    /** Fee taker istituzionale (bps sul notional). Daily usa sempre taker; default 5 bps. */
    takerFeeBps: z.number().min(0).max(500).default(5),
    /** Slippage + spread sul prezzo di fill (basis points). */
    slippageBps: z.number().min(0).max(100).default(0),
    /** Quarter-Kelly default: max peso circa un quarto del Kelly pieno (Tier 1 Phase 3). */
    fractionalKelly: z.number().min(0.05).max(1).default(0.25),
    enableKellyCap: z.boolean().default(true),
  })
  .strict();

export const universeSchema = z
  .object({
    assets: z.array(z.string().min(1)).min(1).max(8),
    baseCurrency: z.literal("USDC").default("USDC"),
  })
  .strict();

/** Parametri scalping / HFT intra-minuto (percorso motore hft-engine). */
export const hftStrategyInputSchema = z
  .object({
    maxLatencyMs: z.number().int().min(1).max(5000),
    /** Dominanza bid-side (0–1). Es. 0.62 = ingresso long se bid ≥ 62% del volume L2. */
    orderBookImbalanceTrigger: z.number().min(0.51).max(0.99),
    /** Hard stop-loss per singolo scalp in basis points. */
    microStopLossBps: z.number().min(1).max(500),
    executionTimeoutSeconds: z.number().int().min(5).max(3600),
    /** Take-profit per round-trip in bps (usato dal motore e dal guardrail spread). */
    targetProfitBps: z.number().min(1).max(200).default(15),
    /** Spread + fee stimati per gamba in bps (validazione proposeExecution). */
    estimatedSpreadBps: z.number().min(0).max(100).default(8),
    /** true = maker (limit bid/ask, no spread); false = taker (market, spread+slippage+fee). */
    useLimitOrdersOnly: z.boolean().default(true),
    /** Giorni di storico tick campionato (default 30 ≈ ultimo mese). */
    replayLookbackDays: z.number().int().min(1).max(365).default(30),
    /** Sessioni giornaliere sull'orizzonte (default 30 = ogni giorno del mese). */
    replayMaxSessions: z.number().int().min(1).max(365).default(30),
  })
  .strict();

export type HFTStrategyInput = z.infer<typeof hftStrategyInputSchema>;

export const backtestSchema = z
  .object({
    primaryTicker: z.string().min(1),
    benchmark: z.string().default("^GSPC"),
    /** Obbligatorio solo per WALLET_MANAGEMENT e ALGORITHMIC_TRADING; omesso per HFT. */
    timeframe: z.enum(["1y", "2y", "5y"]).optional(),
  })
  .strict();

export const buildQuantitativeStrategySchema = z
  .object({
    intentClass: intentClassSchema,
    intentSummary: z.string().min(10).max(600),
    universe: universeSchema,
    walletLogic: walletLogicSchema.optional(),
    algoLogic: algoLogicSchema.optional(),
    hftLogic: hftStrategyInputSchema.optional(),
    riskManagement: riskManagementSchema,
    backtest: backtestSchema,
    marketRoutingMode: z
      .enum(["PRIMARY_MINT_BURN", "PRIMARY_RFQ_ATOMIC", "SECONDARY_AMM"])
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.intentClass === "HIGH_FREQUENCY_SCALPING") {
      if (!data.hftLogic) {
        ctx.addIssue({
          code: "custom",
          message: "hftLogic obbligatorio per HIGH_FREQUENCY_SCALPING",
          path: ["hftLogic"],
        });
      }
      if (data.hftLogic) {
        const spread = data.hftLogic.estimatedSpreadBps;
        const slippage = data.riskManagement.slippageBps;
        const makerFeeBps = data.riskManagement.makerFeeBps;
        const takerFeeBps = data.riskManagement.takerFeeBps;
        const maker = data.hftLogic.useLimitOrdersOnly;
        const roundTripCost = maker
          ? 2 * makerFeeBps
          : spread + 2 * slippage + 2 * takerFeeBps;
        const required = 1.5 * roundTripCost;
        if (data.hftLogic.targetProfitBps <= required) {
          ctx.addIssue({
            code: "custom",
            message:
              `Edge negativo (${maker ? "maker" : "taker"}): targetProfitBps deve essere > 1.5× costo round-trip stimato. ` +
              `Richiesto > ${required.toFixed(1)} bps (round-trip ~${roundTripCost.toFixed(1)} bps).`,
            path: ["hftLogic", "targetProfitBps"],
          });
        }
      }
      if (data.walletLogic) {
        ctx.addIssue({
          code: "custom",
          message: "walletLogic non applicabile a HIGH_FREQUENCY_SCALPING",
          path: ["walletLogic"],
        });
      }
      if (data.algoLogic) {
        ctx.addIssue({
          code: "custom",
          message: "algoLogic non applicabile: usare hftLogic, non segnali daily",
          path: ["algoLogic"],
        });
      }
    } else {
      if (data.hftLogic) {
        ctx.addIssue({
          code: "custom",
          message: "hftLogic consentito solo con intentClass HIGH_FREQUENCY_SCALPING",
          path: ["hftLogic"],
        });
      }
      if (!data.backtest.timeframe) {
        ctx.addIssue({
          code: "custom",
          message: "backtest.timeframe obbligatorio per strategie daily (1y | 2y | 5y)",
          path: ["backtest", "timeframe"],
        });
      }
    }
  });

export type BuildQuantitativeStrategyInput = z.infer<typeof buildQuantitativeStrategySchema>;

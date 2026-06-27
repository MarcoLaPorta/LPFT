import { tool } from "ai";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { suggestMarketRoutingMode, type MarketRoutingMode } from "./afx-market-routing";
import {
  compileToEngineSpec,
  compileToEventDrivenConfig,
  compileToHFTConfig,
  isHFTStrategy,
  parseQuantStrategyPayload,
  validateQuantStrategyInput,
} from "./afx-quant-compiler";
import { HFTExecutionEngine } from "../services/quant/hft-engine";
import { buildHftEquitySeries, computeHftSessionMetrics } from "../services/quant/hft-metrics";
import { riskCapsFromQuantInput } from "./afx-risk-caps";
import { MarketDataError } from "../services/market_data";
import { persistStrategySnapshot } from "./afx-snapshot-store";
import { buildQuantitativeStrategyToolSchema } from "./afx-payload-normalize";
import { getSigner } from "./services/signer";
import { validateProposeExecution } from "./afx-execution-guard";
import {
  fetchHistoricalOhlcv,
  fetchPairedHistory,
  fetchUniversePriceMatrix,
  isAlpacaConfigured,
  buildHftReplaySessions,
  resolveAlpacaTickRoute,
  runMultiSessionHftReplay,
  sessionWindowSeconds,
} from "../services/market_data";
import { ANTHROPIC_EPHEMERAL_CACHE, isPromptCacheEnabled } from "./afx-anthropic-cache";
import { validateEquityCurveTier1 } from "./lpft-tier1";
import {
  projectForwardFromCloses,
  runEventDrivenBacktest,
  runStrategyBacktest as runStrategyBacktestEngine,
  type StrategySpec,
} from "../services/quant/backtest";

const timeframeSchema = z.enum(["1y", "2y", "5y"]);

function timeframeToRange(tf: z.infer<typeof timeframeSchema>): { period1: Date; period2: Date } {
  const period2 = new Date();
  const period1 = new Date(period2);
  if (tf === "1y") period1.setUTCFullYear(period1.getUTCFullYear() - 1);
  else if (tf === "2y") period1.setUTCFullYear(period1.getUTCFullYear() - 2);
  else period1.setUTCFullYear(period1.getUTCFullYear() - 5);
  return { period1, period2 };
}

const marketRoutingSchema = z.enum(["PRIMARY_MINT_BURN", "PRIMARY_RFQ_ATOMIC", "SECONDARY_AMM"]);

const backtestMetricsSchema = z.object({
  cagr: z.number(),
  sharpe: z.number(),
  maxDrawdown: z.number(),
});

const backtestSeriesPointSchema = z.object({
  date: z.string(),
  equity: z.number(),
  benchmark: z.number(),
});

export function createAfxChatTools(ctx: {
  userId: string;
  modelId: string;
  promptVersion: string;
  conversationId?: string;
}) {
  const { userId, modelId, promptVersion, conversationId } = ctx;

  async function saveBacktestReport(payload: Parameters<typeof persistStrategySnapshot>[0]) {
    const snapshotId = await persistStrategySnapshot(payload);
    return {
      snapshotId,
      reportUrl: snapshotId ? `/analysis/${snapshotId}` : null,
    };
  }

  const analyzeMarketData = tool({
    description:
      "Obbligatorio prima di ogni proposta: scarica OHLCV (router Alpaca/Yahoo). Restituisce ultimo close, conteggio barre, campione code.",
    inputSchema: z.object({
      ticker: z.string().describe("Simbolo Yahoo, es. AAPL, ^GSPC, ETH-USD"),
      timeframe: timeframeSchema,
    }),
    execute: async ({ ticker, timeframe }) => {
      const { period1, period2 } = timeframeToRange(timeframe);
      const sym = ticker.toUpperCase();
      const bars = await fetchHistoricalOhlcv(sym, { period1, period2 });
      if (bars.length === 0) {
        return { error: "Nessun dato", ticker: sym, timeframe };
      }
      const last = bars[bars.length - 1];
      const closes = bars.map((b) => b.close);
      const sum = closes.reduce((a, b) => a + b, 0);
      return {
        ticker: sym,
        timeframe,
        barCount: bars.length,
        firstDate: bars[0].date,
        lastDate: last.date,
        lastClose: last.close,
        meanClose: sum / closes.length,
        sampleTail: bars.slice(-5),
        suggestedRouting: suggestMarketRoutingMode(sym),
      };
    },
  });

  const buildQuantitativeStrategy = tool({
    description:
      "Algorithmic Strategy Compiler: compila intento in JSON rigoroso ed esegue simulazione. " +
      "WALLET_MANAGEMENT | ALGORITHMIC_TRADING → backtest daily (PiT, Kelly, regime stress, tier1Validation Python). " +
      "HIGH_FREQUENCY_SCALPING → hftLogic + motore HFT (tick/L2). " +
      "STRUTTURA JSON ROOT OBBLIGATORIA (strict schema — chiavi extra rifiutate): " +
      "{ intentClass, intentSummary, universe, riskManagement, backtest?, walletLogic?, algoLogic?, hftLogic?, marketRoutingMode? }. " +
      "DO NOT nest intentClass, universe, riskManagement, hftLogic, or backtest inside algoLogic. " +
      "algoLogic contains ONLY { signal, sma?, rsi?, zScore?, asymmetricTrendMomentum? }. " +
      "Flatten risk parameters at root riskManagement: makerFeeBps (default 0), takerFeeBps (default 5), slippageBps. " +
      "Includi riskManagement.fractionalKelly (default 0.25) e enableKellyCap. Prima: 3 righe sintesi, poi tool.",
    inputSchema: buildQuantitativeStrategyToolSchema,
    execute: async (input) => {
      const parsed = parseQuantStrategyPayload(input);
      if (parsed.ok === false) {
        return { success: false, errors: parsed.errors, widget: "quant_strategy_v1" };
      }
      const validated = validateQuantStrategyInput(parsed.data);
      if (validated.ok === false) {
        return { success: false, errors: validated.errors, widget: "quant_strategy_v1" };
      }
      const compiled = validated.data;
      const sym = compiled.backtest.primaryTicker.toUpperCase();
      const bench = (compiled.backtest.benchmark ?? "^GSPC").toUpperCase();
      const routing = compiled.marketRoutingMode ?? suggestMarketRoutingMode(sym);

      if (isHFTStrategy(compiled)) {
        if (!isAlpacaConfigured()) {
          return {
            success: false,
            widget: "hft_strategy_v1",
            errors: [
              "Backtest HFT richiede credenziali Alpaca (ALPACA_API_KEY, ALPACA_API_SECRET in apps/web/.env.local). Il mock sintetico è stato rimosso.",
            ],
          };
        }

        const route = resolveAlpacaTickRoute(sym);
        if (!route) {
          return {
            success: false,
            widget: "hft_strategy_v1",
            errors: [`Ticker ${sym} non supportato per replay HFT Alpaca.`],
          };
        }

        const lookbackDays = compiled.hftLogic!.replayLookbackDays ?? 30;
        const maxSessions = compiled.hftLogic!.replayMaxSessions ?? 30;
        const sessions = buildHftReplaySessions({
          lookbackDays,
          maxSessions,
          assetClass: route.assetClass,
        });

        const baseHftConfig = compileToHFTConfig(compiled);

        let hftResult;
        let replayStats;
        try {
          const multi = await runMultiSessionHftReplay({
            symbol: sym,
            sessions,
            lookbackDays,
            maxSessions,
            createEngine: (sessionSeconds) =>
              new HFTExecutionEngine(
                {
                  ...baseHftConfig,
                  executionTimeoutSeconds: sessionSeconds,
                },
                { gammaLatency: false, toxicityGuard: false },
              ),
          });
          hftResult = multi.session;
          replayStats = multi.stats;
        } catch (e) {
          const msg =
            e instanceof MarketDataError || e instanceof Error
              ? e.message
              : "Replay tick Alpaca fallito";
          return {
            success: false,
            widget: "hft_strategy_v1",
            errors: [msg],
          };
        }

        const hftMetrics = computeHftSessionMetrics(hftResult);

        const riskCapsApplied = {
          maxDrawdownLimit: compiled.riskManagement.maxDrawdownLimit,
          stopLossPercentage: compiled.hftLogic!.microStopLossBps / 10000,
          trailingStop: false,
        };

        const hftSeries = buildHftEquitySeries(hftResult.trades);

        const { snapshotId, reportUrl } = await saveBacktestReport({
          userId,
          source: "buildQuantitativeStrategy",
          symbol: sym,
          benchmark: bench,
          intentClass: compiled.intentClass,
          intentSummary: compiled.intentSummary,
          compiledStrategy: compiled,
          engineSpec: { hft: baseHftConfig },
          series: hftSeries,
          trades: [],
          marketContext: {
            hftSession: hftResult,
            hftMetrics,
            engine: "hft-engine",
            replayMode: "alpaca",
            replayStats,
          },
          marketRoutingMode: "SECONDARY_AMM",
          riskCapsApplied,
        });

        return {
          success: true,
          widget: "hft_strategy_v1",
          engine: "hft-engine",
          intentClass: compiled.intentClass,
          intentSummary: compiled.intentSummary,
          compiledStrategy: compiled,
          engineSpec: { hft: baseHftConfig },
          symbol: sym,
          benchmark: bench,
          hftSession: hftResult,
          hftMetrics,
          series: hftSeries,
          marketRoutingMode: "SECONDARY_AMM",
          riskCapsApplied,
          snapshotId,
          reportUrl,
          notice:
            `Backtest HFT multi-giorno (${route.alpacaSymbol}): ` +
            `${replayStats.sessionsRun}/${replayStats.sessionsPlanned} giorni negli ultimi ${lookbackDays} ` +
            `(intera giornata per sessione), ${replayStats.totalEvents.toLocaleString("it-IT")} eventi tick/quote. ` +
            `Metriche aggregate: PnL ${hftMetrics.sessionPnLBps.toFixed(1)} bps, ` +
            `win rate ${(hftMetrics.winRate * 100).toFixed(0)}%, ${hftMetrics.tradeCount} scalp.`,
        };
      }

      const { period1, period2 } = timeframeToRange(compiled.backtest.timeframe ?? "2y");
      const universe = compiled.universe.assets.map((a) => a.toUpperCase());
      let matrix;
      try {
        matrix = await fetchUniversePriceMatrix(universe, bench, {
          period1,
          period2,
          intentClass: compiled.intentClass,
        });
      } catch (e) {
        const msg =
          e instanceof MarketDataError || e instanceof Error ? e.message : "Errore dati di mercato";
        return { success: false, errors: [msg], widget: "quant_strategy_v1" };
      }
      const eventConfig = compileToEventDrivenConfig(compiled);
      const engineSpec = compileToEngineSpec(compiled);
      let result;
      try {
        result = runEventDrivenBacktest({ matrix, config: eventConfig });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Errore motore backtest";
        return { success: false, errors: [msg], widget: "quant_strategy_v1" };
      }
      if (result.series.length < 10) {
        return {
          success: false,
          errors: [
            `Backtest degenerato: equity con ${result.series.length} punti su ${matrix.calendar.length} giorni attesi. Verificare ticker e overlap date.`,
          ],
          widget: "quant_strategy_v1",
        };
      }
      const closes = matrix.prices[sym] ?? [];
      const p30 = projectForwardFromCloses(closes, 30, { lookback: 60 });
      const p90 = projectForwardFromCloses(closes, 90, { lookback: 60 });
      const p365 = projectForwardFromCloses(closes, 365, { lookback: 60, mcPaths: 240 });
      const series = result.series;
      const tier1Validation = await validateEquityCurveTier1(
        series.map((p) => p.equity),
        { n_trials: 1, mc_horizon_days: 30 },
      );
      const riskCapsApplied = riskCapsFromQuantInput(compiled.riskManagement);
      const { snapshotId, reportUrl } = await saveBacktestReport({
        userId,
        source: "buildQuantitativeStrategy",
        symbol: sym,
        benchmark: bench,
        intentClass: compiled.intentClass,
        intentSummary: compiled.intentSummary,
        compiledStrategy: compiled,
        engineSpec: { legacy: engineSpec, eventDriven: eventConfig },
        metrics: result.metrics,
        benchmarkMetrics: result.benchmarkMetrics,
        series,
        projections: { days30: p30, days90: p90, days365: p365 },
        trades: result.trades,
        marketRoutingMode: routing,
        riskCapsApplied,
        marketContext:
          tier1Validation || result.regimeAnalysis
            ? {
                ...(tier1Validation ? { tier1Validation } : {}),
                regimeAnalysis: result.regimeAnalysis,
                pitGuardEnabled: result.pitGuardEnabled,
              }
            : undefined,
      });

      return {
        success: true,
        widget: "quant_strategy_v1",
        engine: "event-driven-engine",
        intentClass: compiled.intentClass,
        intentSummary: compiled.intentSummary,
        compiledStrategy: compiled,
        engineSpec: { legacy: engineSpec, eventDriven: eventConfig },
        symbol: sym,
        benchmark: bench,
        metrics: result.metrics,
        benchmarkMetrics: result.benchmarkMetrics,
        series,
        trades: result.trades,
        tradeCount: result.trades.length,
        projections: { days30: p30, days90: p90, days365: p365 },
        marketRoutingMode: routing,
        riskCapsApplied,
        tier1Validation,
        regimeAnalysis: result.regimeAnalysis,
        pitGuardEnabled: result.pitGuardEnabled,
        snapshotId,
        reportUrl,
        notice: tier1Validation
          ? `Validazione Tier-1 Python: DSR=${(tier1Validation.dsr.dsr * 100).toFixed(1)}%, CVaR₉₅=${(tier1Validation.cvar.historical.cvar * 100).toFixed(2)}%, CPCV Sharpe μ=${tier1Validation.cpcv.sharpe_mean.toFixed(2)}.`
          : "Validazione Tier-1 Python non disponibile (avvia API :8000 per CPCV/DSR/MC 10k).",
      };
    },
    ...(isPromptCacheEnabled() ? { providerOptions: ANTHROPIC_EPHEMERAL_CACHE } : {}),
  });

  const runStrategyBacktest = tool({
    description:
      "Obbligatorio prima di proposeExecution: backtest su dati Yahoo vs benchmark. Restituisce serie equity, CAGR, Sharpe, Max Drawdown.",
    inputSchema: z.object({
      ticker: z.string(),
      benchmark: z.string().default("^GSPC"),
      timeframe: timeframeSchema,
      strategy: z.enum(["buy_and_hold", "drawdown_to_stable"]).default("buy_and_hold"),
      maxDrawdownFrac: z.number().min(0.02).max(0.5).optional(),
      reentrySmaDays: z.number().int().min(5).max(200).optional(),
    }),
    execute: async (input) => {
      const { period1, period2 } = timeframeToRange(input.timeframe);
      const sym = input.ticker.toUpperCase();
      const bench = (input.benchmark ?? "^GSPC").toUpperCase();
      const { aligned } = await fetchPairedHistory(sym, bench, { period1, period2 });
      const strategy: StrategySpec =
        input.strategy === "buy_and_hold"
          ? { kind: "buy_and_hold" }
          : {
              kind: "drawdown_to_stable",
              maxDrawdownFrac: input.maxDrawdownFrac ?? 0.12,
              reentrySmaDays: input.reentrySmaDays ?? 50,
            };
      const result = runStrategyBacktestEngine(aligned, strategy, {});
      const closes = aligned.map((r) => r.assetClose);
      const p30 = projectForwardFromCloses(closes, 30, { lookback: 60 });
      const p90 = projectForwardFromCloses(closes, 90, { lookback: 60 });
      const p365 = projectForwardFromCloses(closes, 365, { lookback: 60, mcPaths: 240 });
      const series = result.series;
      const routing = suggestMarketRoutingMode(sym);
      const { snapshotId, reportUrl } = await saveBacktestReport({
        userId,
        source: "runStrategyBacktest",
        symbol: sym,
        benchmark: bench,
        engineSpec: strategy,
        metrics: result.metrics,
        benchmarkMetrics: result.benchmarkMetrics,
        series,
        projections: { days30: p30, days90: p90, days365: p365 },
        trades: result.trades,
        marketRoutingMode: routing,
      });

      return {
        symbol: sym,
        benchmark: bench,
        strategy,
        metrics: result.metrics,
        benchmarkMetrics: result.benchmarkMetrics,
        series,
        trades: result.trades,
        tradeCount: result.trades.length,
        projections: { days30: p30, days90: p90, days365: p365 },
        suggestedRouting: routing,
        snapshotId,
        reportUrl,
      };
    },
  });

  const proposeExecution = tool({
    description:
      "Dopo analyzeMarketData + runStrategyBacktest: registra proposta DRAFT (RLFF) e abilita widget Conferma in UI. Includi metriche backtest in strategyJSON.",
    inputSchema: z.object({
      userPrompt: z.string(),
      aiReasoning: z.string().max(400).describe("Chain-of-thought max 2 righe"),
      strategyJSON: z.record(z.string(), z.unknown()),
      marketRoutingMode: marketRoutingSchema.optional(),
      ticker: z.string().optional(),
      backtestMetrics: backtestMetricsSchema.optional(),
      backtestSeries: z.array(backtestSeriesPointSchema).max(400).optional(),
      benchmark: z.string().optional(),
    }),
    execute: async ({
      userPrompt,
      aiReasoning,
      strategyJSON,
      marketRoutingMode,
      ticker,
      backtestMetrics,
      backtestSeries,
      benchmark,
    }) => {
      const sym = (ticker ?? (strategyJSON.symbol as string) ?? "UNKNOWN").toString().toUpperCase();
      const routing: MarketRoutingMode =
        marketRoutingMode ?? suggestMarketRoutingMode(sym);

      const metrics =
        backtestMetrics ??
        (strategyJSON.metrics as { sharpe?: number; cagr?: number; maxDrawdown?: number } | undefined);
      const intentClass =
        typeof strategyJSON.intentClass === "string" ? strategyJSON.intentClass : undefined;
      const hftLogic =
        strategyJSON.hftLogic && typeof strategyJSON.hftLogic === "object"
          ? (strategyJSON.hftLogic as Record<string, unknown>)
          : undefined;
      const risk =
        strategyJSON.riskManagement && typeof strategyJSON.riskManagement === "object"
          ? (strategyJSON.riskManagement as Record<string, unknown>)
          : undefined;
      const guardrail = validateProposeExecution({
        metrics,
        intentClass,
        marketRoutingMode: marketRoutingMode ?? routing,
        ticker: sym,
        estimatedSpreadBps:
          typeof hftLogic?.estimatedSpreadBps === "number"
            ? hftLogic.estimatedSpreadBps
            : typeof hftLogic?.estimated_spread_bps === "number"
              ? hftLogic.estimated_spread_bps
              : undefined,
        targetProfitBps:
          typeof hftLogic?.targetProfitBps === "number"
            ? hftLogic.targetProfitBps
            : typeof hftLogic?.target_profit_bps === "number"
              ? hftLogic.target_profit_bps
              : undefined,
        slippageBps:
          typeof risk?.slippageBps === "number"
            ? risk.slippageBps
            : typeof risk?.slippage_bps === "number"
              ? (risk.slippage_bps as number)
              : undefined,
        makerFeeBps:
          typeof risk?.makerFeeBps === "number"
            ? risk.makerFeeBps
            : typeof risk?.maker_fee_bps === "number"
              ? (risk.maker_fee_bps as number)
              : undefined,
        takerFeeBps:
          typeof risk?.takerFeeBps === "number"
            ? risk.takerFeeBps
            : typeof risk?.taker_fee_bps === "number"
              ? (risk.taker_fee_bps as number)
              : undefined,
        useLimitOrdersOnly:
          typeof hftLogic?.useLimitOrdersOnly === "boolean"
            ? hftLogic.useLimitOrdersOnly
            : typeof hftLogic?.use_limit_orders_only === "boolean"
              ? (hftLogic.use_limit_orders_only as boolean)
              : true,
      });
      if (guardrail.ok === false) {
        return {
          rejected: true,
          reason: guardrail.reason,
          sharpe: metrics?.sharpe,
        };
      }

      const idempotencyKey = crypto.randomUUID().replace(/-/g, "").slice(0, 64);
      const pnlStub: Prisma.InputJsonValue = {
        basis: "simulation",
        stage: "proposal",
        metrics: metrics ?? null,
        unrealizedPnlUsd: null,
      };

      const { computeExecutionSizing, executionSizingToJson } = await import(
        "./services/execution-sizing"
      );
      let sizingBlock: ReturnType<typeof executionSizingToJson>;
      try {
        const sizing = await computeExecutionSizing({
          userId,
          strategyJSON,
          marketRoutingMode: routing,
          symbol: sym,
        });
        sizingBlock = executionSizingToJson(sizing);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sizing dinamico non calcolabile";
        return {
          rejected: true,
          reason: `Impossibile calcolare sizing on-chain: ${msg}`,
          sharpe: metrics?.sharpe,
        };
      }

      const proposalPayload = {
        kind: "proposal_v2",
        strategy: strategyJSON,
        sizing: sizingBlock,
        backtest: {
          symbol: sym,
          benchmark: benchmark ?? "^GSPC",
          metrics: metrics ?? null,
          series: backtestSeries ?? null,
        },
      };

      const row = await prisma.executionLog.create({
        data: {
          idempotencyKey,
          userId,
          conversationId,
          userPrompt,
          aiReasoning,
          pnlResult: pnlStub,
          marketRoutingMode: routing,
          executionStatus: "DRAFT",
          actionType: "proposeExecution",
          payloadJson: proposalPayload as Prisma.InputJsonValue,
          strategyMetrics: (metrics ?? strategyJSON) as Prisma.InputJsonValue,
          modelId,
          promptVersion,
        },
      });

      const trades = Array.isArray(strategyJSON.trades)
        ? strategyJSON.trades
        : undefined;
      const { snapshotId, reportUrl } = await saveBacktestReport({
        userId,
        source: "proposeExecution",
        symbol: sym,
        benchmark: benchmark ?? "^GSPC",
        compiledStrategy: strategyJSON,
        metrics:
          metrics &&
          typeof metrics.cagr === "number" &&
          typeof metrics.sharpe === "number" &&
          typeof metrics.maxDrawdown === "number"
            ? {
                cagr: metrics.cagr,
                sharpe: metrics.sharpe,
                maxDrawdown: metrics.maxDrawdown,
              }
            : undefined,
        series: backtestSeries,
        trades: trades as Parameters<typeof persistStrategySnapshot>[0]["trades"],
        marketRoutingMode: routing,
        executionLogId: row.id,
      });

      return {
        executionLogId: row.id,
        idempotencyKey: row.idempotencyKey,
        status: row.executionStatus,
        marketRoutingMode: routing,
        symbol: sym,
        benchmark: benchmark ?? "^GSPC",
        metrics: metrics ?? null,
        series: backtestSeries ?? null,
        trades: trades ?? null,
        tradeCount: Array.isArray(trades) ? trades.length : 0,
        warning: guardrail.warning ?? null,
        snapshotId,
        reportUrl,
        sizing: sizingBlock,
        widget: "propose_execution_v1",
      };
    },
  });

  async function executeTradeInternal(args: {
    executionLogId: string;
    routeType: "PRIMARY" | "SECONDARY";
    payload?: Record<string, unknown>;
    userSizing?: {
      amountIn: string;
      tokenIn?: string;
      tokenOut?: string;
      fee?: number;
    };
  }) {
    const row = await prisma.executionLog.findFirst({
      where: {
        id: args.executionLogId,
        userId,
        executionStatus: { in: ["DRAFT", "PENDING_SIGNATURE"] },
      },
    });
    if (!row) {
      return { error: "ExecutionLog non trovato o stato non ammesso", executionLogId: args.executionLogId };
    }
    const { buildWeb3SubmissionPayload } = await import("./services/web3-keeper");
    const onchainMode = (process.env.AFX_ONCHAIN_CONFIRM_MODE ?? "mock").trim().toLowerCase();
    const chainId = Number(
      process.env.AFX_CHAIN_ID ?? process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? "31337",
    );

    let mergedPayload: Record<string, unknown> = {
      ...(row.payloadJson && typeof row.payloadJson === "object" && !Array.isArray(row.payloadJson)
        ? (row.payloadJson as Record<string, unknown>)
        : {}),
      routeType: args.routeType,
      ...(args.payload ?? {}),
    };

    if (args.userSizing?.amountIn?.trim()) {
      const { mergeUserSizingIntoPayload } = await import("./execution-user-sizing");
      const sized = mergeUserSizingIntoPayload(mergedPayload, args.userSizing);
      if ("error" in sized) {
        return { error: sized.error, executionLogId: args.executionLogId };
      }
      mergedPayload = sized.payload;
    }

    let transactionHash: string | null = null;

    if (onchainMode === "real") {
      const web3 = await buildWeb3SubmissionPayload({
        userId,
        chainId,
        payloadJson: mergedPayload,
      });
      if ("error" in web3) {
        return {
          error: web3.error,
          errorCode: web3.errorCode,
          executionLogId: args.executionLogId,
        };
      }
      mergedPayload = { ...mergedPayload, web3: web3.payload };
    } else {
      const signer = getSigner();
      const to = (typeof args.payload?.to === "string"
        ? args.payload.to
        : "0x0000000000000000000000000000000000000001") as `0x${string}`;
      const data = (typeof args.payload?.data === "string" ? args.payload.data : "0x") as `0x${string}`;
      const signed = await signer.signTransaction({ chainId, to, data });
      mergedPayload.kmsKeyId = signed.kmsKeyId;
      transactionHash = signed.hash;
    }

    await prisma.executionLog.update({
      where: { id: row.id },
      data: {
        executionStatus: "SUBMITTED",
        transactionHash,
        actionType: "executeTrade",
        chainId,
        payloadJson: mergedPayload as Prisma.InputJsonValue,
      },
    });
    return {
      executionLogId: row.id,
      status: "SUBMITTED",
      transactionHash,
      routeType: args.routeType,
      keeperMode: onchainMode,
    };
  }

  const executeTrade = tool({
    description:
      "Solo dopo conferma esplicita utente (widget). Firma mock KMS e invia calldata on-chain verso whitelist.",
    inputSchema: z.object({
      executionLogId: z.string(),
      routeType: z.enum(["PRIMARY", "SECONDARY"]),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async ({ executionLogId, routeType, payload }) =>
      executeTradeInternal({ executionLogId, routeType, payload }),
  });

  /** @deprecated alias — preferire executeTrade */
  const executeSwap = tool({
    description: "Alias di executeTrade (legacy).",
    inputSchema: z.object({
      executionLogId: z.string(),
      routeType: z.enum(["PRIMARY", "SECONDARY"]),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async ({ executionLogId, routeType, payload }) =>
      executeTradeInternal({ executionLogId, routeType, payload }),
  });

  return {
    analyzeMarketData,
    buildQuantitativeStrategy,
    runStrategyBacktest,
    proposeExecution,
    executeTrade,
    executeSwap,
  } as const;
}

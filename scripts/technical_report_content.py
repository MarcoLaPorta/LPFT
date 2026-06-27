# Contenuto esteso report LPFT/AFX — importato da generate-technical-report-pdf.py

from __future__ import annotations

from pathlib import Path
from typing import Any


def populate(pdf: Any, diagrams: list[tuple[Path, str]] | None = None) -> None:
    pdf.h1("0. Architettura visuale — diagrammi")
    pdf.body(
        "Questa sezione riassume il progetto in modo visivo. Ogni figura corrisponde a un "
        "file PNG in docs/report-assets/ (rigenerabile con technical_report_diagrams.py). "
        "Leggere le figure prima dei capitoli testuali aiuta a collocare LPFT (ricerca Python) "
        "e AFX (exchange + chat Next.js) nello stesso prodotto."
    )
    pdf.h2("0.1 Cosa fa il prodotto in una frase")
    pdf.body(
        "Un assistente quantitativo istituzionale che conversa in italiano, simula strategie su "
        "dati di mercato reali, produce report analitici con grafici e trade, e — su approvazione "
        "dell'utente — propone esecuzioni tracciate per audit e miglioramento del modello (RLFF), "
        "con scaffold verso vault non-custodial on-chain."
    )
    if diagrams:
        for path, caption in diagrams:
            pdf.figure(path, caption)
    else:
        pdf.body("Diagrammi non generati. Eseguire: python3 scripts/technical_report_diagrams.py")

    pdf.h1("1. Executive summary e visione prodotto")
    pdf.body(
        "LPFT (Laboratory for Programmable Finance & Trading) e AFX (Agentic Finance Exchange) "
        "convergono in un unico prodotto: un exchange finanziario agentico non-custodial. "
        "L'utente è OWNER dello SmartVault on-chain; il backend agisce come MANAGER con permessi "
        "limitati (trade verso router whitelisted, nessun prelievo arbitrario). "
        "La ricerca quantitativa (backtest, metriche, spiegazione) avviene in chat con Claude; "
        "l'esecuzione reale passa da proposeExecution → firma → chain (oggi in gran parte mock/scaffold)."
    )
    pdf.body(
        "Principio architetturale (docs/UNIFIED_EXCHANGE.md): non due prodotti concorrenti, "
        "ma strati complementari — ricerca/intent (LPFT), exchange/audit (AFX), infra conmotione "
        "(Postgres doppio, Redis). La cartella agentic-finance-exchange/ è archivio storico; "
        "l'unica app UI è apps/web sulla porta 3000."
    )

    pdf.h1("2. Architettura logica e flussi dati")
    pdf.body(
        "Le Fig. 1–3 mostrano il contesto e il percorso felice dell'utente. La Fig. 4 chiarisce "
        "perché esistono due motori di backtest. La Fig. 5–7 descrivono dove finiscono i dati e "
        "come si avvia l'ambiente locale. La Fig. 8 illustra come si sceglie il mercato primario "
        "vs secondario prima di un'operazione."
    )
    pdf.h2("2.0 Ruoli e confini di responsabilità")
    for s in [
        "Utente (OWNER): possiede il wallet e autorizza; non delega la custodia dei fondi al backend.",
        "Agente IA (MANAGER logico): propone strategie e ordini; non esegue trade senza conferma UI.",
        "apps/web: unica interfaccia prodotto; traduce intent in JSON, backtest, snapshot, widget.",
        "services/api: motore ricerca legacy, dataset, generazione programma; opzionale per la chat.",
        "Prisma (afx_dev): verità per chat, execution log, strategie salvate, cache OHLCV.",
        "SQLModel (lpft): verità per run storici API Python e artifact su disco/DB.",
    ]:
        pdf.bullet(s)

    pdf.h2("2.1 Flusso principale (chat → report)")
    for s in [
        "Utente invia messaggio su / con wallet (Zustand + default env).",
        "POST /api/chat: sanitize messaggi, getOrCreateUserByWallet, streamText Anthropic.",
        "System prompt: AFX_FIDUCIARY_SYSTEM (versione afx-fiduciary-v1).",
        "Tool disponibili: analyzeMarketData, buildQuantitativeStrategy, runStrategyBacktest, proposeExecution, executeTrade, executeSwap.",
        "buildQuantitativeStrategy: compiler JSON → EventDrivenConfig → runEventDrivenBacktest → persistStrategySnapshot.",
        "Risposta UI: testo stream + widget (AnalysisInlineWidget, QuantStrategyWidget, ProposeExecutionWidget).",
        "Report persistente: /analysis/[id] con StrategyReportView (KPI, grafici, registro trade).",
        "Salvataggio esplicito: POST /api/strategies/[id]/save imposta savedAt → visibile in /strategies.",
    ]:
        pdf.bullet(s)

    pdf.h2("2.2 Flusso parallelo (API Python :8000)")
    for s in [
        "Client legacy o integrazioni chiamano FastAPI su LPFT_DATABASE_URL (db lpft).",
        "/generate-strategy, /generate-and-backtest: LLM + lpft_shared engine.",
        "Backtest in coda RQ se Redis+worker attivi; altrimenti inline nell'API.",
        "Con LPFT_AFX_INTENTS_ENABLED: intent_publisher scrive su Redis channel afx:intents:new.",
        "npm run worker:intents: valida router whitelist, crea ExecutionLog PENDING o LOGGED_PROPOSAL.",
    ]:
        pdf.bullet(s)

    pdf.h2("2.3 Diagramma testuale")
    pdf.mono(
        "[Browser] → :3000 Next.js → /api/chat → [Anthropic + Tools] → [TS Quant Engine] → Prisma afx_dev\n"
        "              ↓                                    ↓\n"
        "         /analysis/[id]                    MarketDataBar (cache Yahoo)\n"
        "[Browser/API] → :8000 FastAPI → lpft_shared → Postgres lpft + Redis RQ → Worker"
    )

    pdf.h1("3. Stack tecnologico dettagliato")
    pdf.h2("3.1 apps/web — dipendenze runtime")
    for s in [
        "next ^15.2, react ^19, typescript ^5.7",
        "ai ^6.0 + @ai-sdk/anthropic ^3.0 + @ai-sdk/react ^3.0",
        "@prisma/client ^6.19, zod ^4.4",
        "lightweight-charts ^5.2, yahoo-finance2 ^3.14",
        "redis ^4.7, zustand ^5.0",
        "vitest ^3.2 (dev), eslint 9, tailwind 3.4",
    ]:
        pdf.bullet(s)

    pdf.h2("3.2 services/api — Python")
    pdf.bullet("FastAPI, SQLModel, Anthropic SDK, RQ, Redis")
    pdf.bullet("lpft_shared: engine.py (program backtest), market_data.py (Yahoo/Alpaca, mock oracoli)")
    pdf.bullet("Moduli: assistant.py, program_llm.py, strategy_spec_tool.py, intent_publisher.py, dsl.py")

    pdf.h1("4. Agente fiduciario (chat AI)")
    pdf.h2("4.1 Prompt di sistema (afx-fiduciary-prompt.ts)")
    pdf.body(
        "Versione tracciata: AFX_PROMPT_VERSION = afx-fiduciary-v1. Il modello risponde in italiano, "
        "tono istituzionale, senza markdown pesante in chat. Deve spiegare prima/dopo i tool. "
        "Non invoca tool per domande generiche. Chiede chiarimenti se mancano asset/orizzonte/rischio."
    )
    pdf.h2("4.2 Regole tool (estratto)")
    for s in [
        "analyzeMarketData: obbligatorio prima di proposte; OHLCV Yahoo reale.",
        "buildQuantitativeStrategy: strategia JSON completa + risk management obbligatorio.",
        "runStrategyBacktest: backtest semplice (buy_and_hold, drawdown_to_stable).",
        "proposeExecution: solo dopo backtest; guardrail Sharpe; crea ExecutionLog DRAFT.",
        "executeTrade / executeSwap: solo dopo conferma utente (non autonomi dall'agente).",
    ]:
        pdf.bullet(s)

    pdf.h2("4.3 Persistenza conversazione")
    pdf.body(
        "POST /api/chat accetta conversationId opzionale. Se presente, salva Message user/assistant "
        "su Prisma (Conversation, Message). Titolo conversazione da primo messaggio utente (max 120 char)."
    )

    pdf.h1("5. Tool chat — specifica funzionale")
    pdf.h2("5.1 analyzeMarketData")
    pdf.body("Input: ticker, timeframe (1y|2y|5y). Output: ultimo close, n barre, sample code. Usa fetchHistoricalOhlcv.")

    pdf.h2("5.2 buildQuantitativeStrategy")
    pdf.body(
        "Input: schema Zod buildQuantitativeStrategySchema (intentClass WALLET_MANAGEMENT | ALGORITHMIC_TRADING, "
        "symbol, benchmark, legs, riskManagement, rebalance, asymmetric weights, ecc.). "
        "Pipeline: validateQuantStrategyInput → compileToEventDrivenConfig → fetchUniversePriceMatrix → "
        "runEventDrivenBacktest → projectForwardFromCloses (30/90/365) → persistStrategySnapshot. "
        "Restituisce: metrics, series completa (dal giorno 0), trades, snapshotId, reportUrl, widget quant_strategy_v1."
    )

    pdf.h2("5.3 runStrategyBacktest")
    pdf.body(
        "Backtest classico su coppia allineata asset/benchmark. Strategie: buy_and_hold, drawdown_to_stable "
        "(maxDrawdownFrac, reentrySmaDays). Output widget con serie e metriche."
    )

    pdf.h2("5.4 proposeExecution")
    pdf.body(
        "Valida metriche con validateProposeExecution (Sharpe minimo, drawdown). Crea ExecutionLog DRAFT "
        "con idempotencyKey UUID, payload proposal_v2, strategyMetrics JSON. Collega snapshot report. "
        "Widget propose_execution_v1. Guardrail può rifiutare con rejected:true."
    )

    pdf.h2("5.5 executeTrade / executeSwap")
    pdf.body(
        "Recuperano ExecutionLog, invocano signer (mock KMS), aggiornano stato esecuzione. "
        "Integrazione on-chain reale ancora scaffold (calldataDigest, transactionHash mock nel sweep)."
    )

    pdf.h1("6. Motore quant TypeScript (event-driven)")
    pdf.h2("6.1 Moduli in services/quant/")
    modules = [
        ("event-driven-engine.ts", "Loop giornaliero: segnali → pending rebalance T+1 → risk halt → mark-to-market → serie equity/benchmark."),
        ("signal-engine.ts", "Pesi target: equal weight, momentum, RSI, asymmetric multi-asset, session mask RTH."),
        ("risk-manager.ts", "Max drawdown portafoglio, stop loss per posizione, trailing stop, liquidazione forzata."),
        ("execution-engine.ts", "Rebalance con slippage/spread; close position; forced liquidation."),
        ("portfolio-state.ts", "Cash, posizioni, HWM, halt mensile reset, markToMarket."),
        ("trading-friction.ts", "Slippage bps per symbol class (crypto vs equity)."),
        ("trade-journal.ts", "Registro trade simulati: entry/exit, pnlFrac, pnlEquity, reason codes."),
        ("metrics.ts", "CAGR, Sharpe, max drawdown da serie equity; annualizzazione 252 gg."),
        ("backtest.ts", "Orchestrazione: runEventDrivenBacktest, runStrategyBacktest, projectForwardFromCloses."),
        ("strategy-adapter.ts", "Adattatori spec legacy verso config event-driven."),
    ]
    for name, desc in modules:
        pdf.bullet(f"{name}: {desc}")

    pdf.h2("6.2 Realismo e test quant")
    for s in [
        "tier1-realism.test.ts — vincoli realismo ordini",
        "trading-friction.test.ts — slippage e costi",
        "halt-circuit.test.ts — circuit breaker drawdown",
        "monthly-halt-reset.test.ts — reset halt mensile",
        "signal-engine.asymmetric.test.ts — pesi asimmetrici multi-asset",
        "event-driven-engine.test.ts — integrazione motore",
        "portfolio-state.halt.test.ts, risk-manager.test.ts",
    ]:
        pdf.bullet(s)

    pdf.h2("6.3 Dati di mercato (services/market_data.ts)")
    pdf.body(
        "fetchHistoricalOhlcv, fetchPairedHistory, fetchUniversePriceMatrix da Yahoo. "
        "Persistenza opzionale su MarketDataBar (symbol, date, adjClose, volume). "
        "price_matrix.ts: allineamento calendario multi-ticker, maschere sessione regolamentata US."
    )

    pdf.h1("7. Libreria lib/ (moduli applicativi)")
    libs = [
        "afx-chat-tools.ts — definizione tool AI",
        "afx-quant-compiler.ts — JSON strategia → engine config",
        "afx-quant-strategy-schema.ts — Zod input strategia",
        "afx-risk-caps.ts — cap drawdown/SL da input",
        "afx-execution-guard.ts — validazione proposeExecution",
        "afx-snapshot-store.ts — CRUD StrategySnapshot",
        "afx-derived-stats.ts — totalReturn, vol annua da serie",
        "afx-market-routing.ts — PRIMARY_* vs SECONDARY_AMM",
        "afx-fiduciary-prompt.ts — system prompt",
        "afx-user.ts — getOrCreateUserByWallet",
        "afx-store.ts — Zustand wallet/UI",
        "series-analytics.ts — drawdown series, monthly returns, advanced metrics",
        "trade-stats.ts — summarizeTrades, yearlyReturns",
        "extractLatestAnalysis.ts — parsing messaggi chat per widget",
        "sanitize-chat-messages.ts — pulizia payload UI",
        "services/signer.ts — KMS mock / interfaccia firma",
        "api.ts — client verso LPFT API :8000",
        "backtestMetrics.ts — etichette metriche report IT",
    ]
    for line in libs:
        pdf.bullet(line)

    pdf.h1("8. API REST Next.js — inventario completo")
    routes = [
        "POST /api/chat — Chat streaming Anthropic + tool + persistenza messaggi",
        "GET|POST /api/quant/backtest — Backtest TS diretto (non chat)",
        "GET /api/market/history — Storico OHLCV",
        "GET /api/market/quotes — Quote mercato",
        "GET|POST /api/analysis/snapshots — Lista/crea snapshot",
        "GET /api/analysis/snapshots/[id] — Dettaglio snapshot",
        "GET /api/strategies — Strategie salvate (savedAt not null)",
        "POST /api/strategies/[id]/save — Bookmark strategia + titolo",
        "POST /api/save-strategy — Salvataggio alternativo",
        "GET /api/execution/[id] — Stato execution log",
        "POST /api/execution/[id]/execute — Submit firma/esecuzione",
        "POST /api/execution/[id]/feedback — RLFF user feedback",
        "GET /api/vault — Info vault utente",
        "POST /api/vault/deploy — Deploy vault (scaffold)",
        "GET /api/health — Health generico",
        "GET /api/afx-health — Health AFX/Prisma/dettaglio",
    ]
    for r in routes:
        pdf.bullet(r)

    pdf.h1("9. API FastAPI Python — inventario")
    for r in [
        "GET /, GET /demo — Root e demo",
        "POST/GET /strategies — CRUD strategie LPFT",
        "POST/GET /runs, GET /runs/{id} — Esecuzioni backtest",
        "POST /generate-strategy — Generazione strategia LLM",
        "POST /generate-strategy-stream — Stream generazione",
        "POST /generate-and-backtest — One-shot",
        "POST /generate-program — Program DSL",
        "POST /assistant/stream — Assistant streaming",
        "POST /runs/program — Run programma",
        "GET /runs/{id}/artifacts — Artifact backtest",
        "POST /datasets/upload, /datasets/fetch — Dataset",
    ]:
        pdf.bullet(r)

    pdf.h1("10. Schema Prisma — modelli e scopo")
    models = [
        ("User", "walletAddress unique; hub per vault, chat, execution, snapshot."),
        ("StrategySnapshot", "Report backtest: equitySeries, trades, metrics, compiledStrategy, savedAt/title."),
        ("Conversation / Message", "Storico chat; role user|assistant|system."),
        ("WhitelistedDexRouter", "Router DEX per chain; UNISWAP_V3/V2/CURVE."),
        ("VaultFactoryConfig", "Factory deploy vault per chainId."),
        ("SmartVault", "Istanza vault utente; status PENDING_DEPLOY|ACTIVE|PAUSED."),
        ("RwaToken", "Token sintetici RWA (bAAPL); primaryWindowOnly."),
        ("RfqQuote", "Quote RFQ primario fuori RTH; settlement off-chain."),
        ("ExecutionLog", "Core RLFF: prompt, reasoning, pnlResult, strategyMetrics, executionStatus, feedback."),
        ("MarketDataBar", "Cache OHLCV Yahoo per replay backtest."),
    ]
    for name, desc in models:
        pdf.bullet(f"{name}: {desc}")

    pdf.h2("10.1 ExecutionStatus — ciclo di vita")
    pdf.body(
        "DRAFT → PENDING_SIGNATURE → PENDING → CONFIRMED | FAILED | CANCELLED. "
        "Anche: LOGGED_PROPOSAL, AWAITING_USER_SIGNATURE, AWAITING_MANAGER_SIGNATURE, SUBMITTED. "
        "Sweeper (npm run sweep) promuove PENDING con tx mock."
    )

    pdf.h2("10.2 Migrazioni Prisma (ordine)")
    for m in [
        "20260215120000_pending_idempotency",
        "20260514120000_init_afx",
        "20260515120000_execution_rlff_fields",
        "20260516100000_pending_signature_status",
        "20260517120000_strategy_snapshots",
        "20260517140000_market_data_bars",
        "20260518111000_phase_d_rlff_feedback_prompt_version",
        "20260518120000_strategy_saved_bookmark",
    ]:
        pdf.bullet(m)

    pdf.h1("11. UI React — componenti principali")
    for c in [
        "FiduciaryChat.tsx — Chat principale, useChat, rendering widget",
        "ChatMessageBubble.tsx — Bubble + AnalysisInlineWidget",
        "AnalysisInlineWidget.tsx — Metriche + grafico + Salva strategia",
        "BacktestWidget.tsx — Grafico lightweight-charts equity",
        "StrategyReportView.tsx — Report completo multi-sezione",
        "TradeAnalysisBlock / TradeRegistryTable — Analisi trade in panoramica",
        "ProjectionOutlook.tsx — Proiezioni 30/90/365 gg",
        "ProposeExecutionWidget.tsx — Conferma esecuzione",
        "ExecutionStatusBar.tsx — Stato pipeline execution",
        "SaveStrategyActions.tsx — CTA salva / link report",
        "StrategyBuilder.tsx — UI costruzione strategia (legacy/demo)",
        "Exchange* — Pagine exchange mercati",
    ]:
        pdf.bullet(c)

    pdf.h1("12. Metriche e interpretazione")
    pdf.h2("12.1 Metriche portafoglio")
    for s in [
        "CAGR: rendimento annualizzato composto da serie equity.",
        "Sharpe: excess return / volatilità annualizzata (rf≈0).",
        "Max drawdown: massimo calo da picco equity.",
        "Rend. periodo (widget): (equity_finale/equity_inizio)-1 su tutto il backtest.",
        "Alpha vs benchmark: rendimento strategia meno buy&hold benchmark.",
    ]:
        pdf.bullet(s)

    pdf.h2("12.2 Metriche trade")
    pdf.body(
        "PnL % sul trade = movimento prezzo sul titolo (non rendimento portafoglio). "
        "Win rate, profit factor, hold medio da summarizeTrades(). "
        "Registro trade in report: entry/exit, pnlFrac, pnlEquity, reasonEntry→reasonExit."
    )

    pdf.h1("13. RLFF e miglioramento modello")
    pdf.body(
        "Ogni ExecutionLog conserva userPrompt, aiReasoning, pnlResult, strategyMetrics, modelId, promptVersion. "
        "POST feedback aggiorna userFeedback e feedbackAt. "
        "Script npm run rlff:export esporta dataset per training/fine-tuning. "
        "Obiettivo: reinforcement learning from human/analytics feedback su proposte reali vs simulate."
    )

    pdf.h1("14. Exchange, routing e on-chain (scaffold)")
    pdf.h2("14.1 MarketRoutingMode")
    pdf.bullet("PRIMARY_MINT_BURN — RWA in regular trading hours; mint/burn 1:1.")
    pdf.bullet("PRIMARY_RFQ_ATOMIC — Fuori RTH; RFQ atomico off-chain.")
    pdf.bullet("SECONDARY_AMM — Crypto e mercato secondario; router whitelisted.")

    pdf.h2("14.2 Signer e vault")
    pdf.body(
        "lib/services/signer.ts: interfaccia KeyManagementService; createMockKmsSigner per dev. "
        "Env: AFX_SIGNER_MODE, AFX_KMS_KEY_REF. Vault deploy API stub. "
        "Mainnet checklist in UNIFIED_EXCHANGE.md: chain config, RPC confirmation, rate limit, audit."
    )

    pdf.h1("15. Fasi di implementazione (roadmap eseguita)")
    pdf.h2("Fase A — Consolidamento")
    pdf.bullet("Persistenza conversazione Prisma; cache MarketDataBar; docs QUANT_ENGINES.md; test unitari.")

    pdf.h2("Fase B — Realismo quant")
    pdf.bullet("Tier-1 realism, trading friction, halt circuit; paper worker hooks.")

    pdf.h2("Fase C — Scaffold exchange")
    pdf.bullet("Signer, vault API, env on-chain; exchange page audit.")

    pdf.h2("Fase D — RLFF")
    pdf.bullet("API feedback, prompt versioning, execution guard su propose; export dataset.")

    pdf.h1("16. Test, qualità e debito tecnico")
    pdf.h2("16.1 Copertura attuale")
    pdf.bullet("14 file Vitest apps/web — focus motore quant e lib guard/normalize.")
    pdf.bullet("1 pytest test_strategy_engine.py — Python engine + Alpaca paths.")
    pdf.bullet("Gap: zero test E2E HTTP; componenti React non testati; chat tools integration manual.")

    pdf.h2("16.2 Debito noto")
    for s in [
        "Dual engine TS/Python senza unificazione codice.",
        "On-chain mock — non production-ready.",
        "yahoo-finance2 warning Node version.",
        "Due DB da operare (lpft + afx_dev).",
        "Working tree git molto dirty — molti file non committati.",
        "agentic-finance-exchange/ può confondere — solo archivio.",
    ]:
        pdf.bullet(s)

    pdf.h1("17. Operatività — avvio e troubleshooting")
    pdf.h2("17.1 Avvio rapido")
    for s in [
        "Root: ./scripts/start-lpft.sh oppure npm start",
        "Docker: cd infra && docker compose up -d postgres redis",
        "Prisma: cd apps/web && npx prisma migrate deploy",
        "Web: cd apps/web && npm run dev → http://localhost:3000",
        "API: cd services/api && uvicorn lpft_api.main:app --port 8000",
        "Worker RQ: LPFT_REDIS_URL=... python -m lpft_worker.worker",
        "Intent bridge: npm run worker:intents",
    ]:
        pdf.bullet(s)

    pdf.h2("17.2 Problemi frequenti")
    pdf.bullet("Safari non si connette: dev server :3000 spento — npm run dev.")
    pdf.bullet("503 chat: manca ANTHROPIC_API_KEY o DATABASE_URL.")
    pdf.bullet("Backtest vuoto: ticker senza overlap date o Yahoo down.")
    pdf.bullet("Migrazioni: usare migrate deploy su afx_dev, non lpft.")

    pdf.h1("18. Variabili d'ambiente — riferimento esteso")
    pdf.h2("apps/web/.env.local")
    env_web = [
        "DATABASE_URL — PostgreSQL Prisma (afx_dev)",
        "ANTHROPIC_API_KEY — Obbligatorio per chat",
        "AFX_ANTHROPIC_MODEL — Modello Claude (default da SDK)",
        "NEXT_PUBLIC_LPFT_API_BASE — http://localhost:8000",
        "AFX_CHAT_DEFAULT_WALLET / NEXT_PUBLIC_AFX_DEFAULT_WALLET",
        "LPFT_REDIS_URL / REDIS_URL — Intent listener + event bus",
        "AFX_INTENTS_CHANNEL — default afx:intents:new",
        "AFX_CHAIN_ID, AFX_VAULT_FACTORY_ADDRESS — Scaffold chain",
        "AFX_SIGNER_MODE, AFX_KMS_KEY_REF, AFX_KMS_ENDPOINT — Firma",
        "AFX_ONCHAIN_CONFIRM_MODE — mock vs real confirmation",
    ]
    for e in env_web:
        pdf.bullet(e)

    pdf.h2("services/api/.env.local")
    for e in [
        "LPFT_DATABASE_URL — postgresql://lpft:lpft@localhost:5432/lpft",
        "LPFT_ANTHROPIC_API_KEY",
        "LPFT_REDIS_URL",
        "LPFT_AFX_INTENTS_ENABLED=true|false",
        "LPFT_AFX_INTENTS_CHANNEL",
        "LPFT_FRONTEND_BASE_URL — http://localhost:3000",
    ]:
        pdf.bullet(e)

    pdf.h1("19. Appendice — struttura directory sintetica")
    pdf.mono(
        "Documents/\n"
        "  apps/web/          ← APP CANONICA (Next 15)\n"
        "    app/             ← pages + api routes\n"
        "    lib/             ← afx-*, compiler, guard\n"
        "    services/quant/  ← motore TS\n"
        "    prisma/          ← schema + migrations\n"
        "    scripts/         ← sweep, intents, rlff export\n"
        "  services/api/      ← FastAPI LPFT\n"
        "  services/worker/   ← RQ consumer\n"
        "  services/shared/lpft_shared/\n"
        "  infra/             ← docker-compose\n"
        "  docs/              ← UNIFIED_EXCHANGE, QUANT_ENGINES\n"
        "  scripts/           ← start-lpft.sh, questo report PDF"
    )

    pdf.h1("20. Guardrail esecuzione e routing mercato")
    pdf.h2("20.1 validateProposeExecution (afx-execution-guard.ts)")
    pdf.bullet("Sharpe < -0.5 → rifiuto proposeExecution (ok: false).")
    pdf.bullet("Max drawdown vs AFX_MAX_DRAWDOWN_THRESHOLD (default 35%).")
    pdf.bullet("AFX_MAX_DRAWDOWN_ACTION: warn | reject | off — warn permette proposta con warning.")
    pdf.body("Test unitari in afx-execution-guard.test.ts coprono soglie e messaggi IT.")

    pdf.h2("20.2 suggestMarketRoutingMode")
    pdf.bullet("Crypto ticker (BTC, ETH, *-USD) → SECONDARY_AMM.")
    pdf.bullet("Equity US in sessione RTH (09:30–16:00 ET, lun–ven) → PRIMARY_RFQ_ATOMIC.")
    pdf.bullet("Altrimenti → SECONDARY_AMM.")
    pdf.body("isUsEquitySessionOpen usa Intl America/New_York — no dipendenza librerie esterne.")

    pdf.h1("21. Motore Python lpft_shared (sintesi)")
    pdf.body(
        "engine.py esegue programmi strategia con latenza barre, spread sintetico, "
        "onchain_latency_bars e dex_synthetic_spread_bps da ProgramMetadata. "
        "market_data.py integra fetch Yahoo/Alpaca, mock Chainlink/Pyth per costi DEX stimati. "
        "L'API espone generate-program per DSL dichiarativo; artifacts salvati per run_id."
    )
    pdf.h2("21.1 Worker RQ")
    pdf.body(
        "lpft_worker.worker consuma job Redis. Config allineata a LPFT_REDIS_URL e DB API. "
        "Se worker down e Redis up, API recente esegue backtest inline per evitare stallo UI legacy."
    )

    pdf.h1("22. Script operativi (apps/web/scripts)")
    pdf.h2("22.1 sweep-execution-logs.ts")
    pdf.body(
        "npm run sweep: trova ExecutionLog in PENDING, simula conferma on-chain (mock), "
        "aggiorna transactionHash e CONFIRMED/FAILED. Usato in dev per chiudere il ciclo RLFF."
    )
    pdf.h2("22.2 intent-listener.ts")
    pdf.body(
        "npm run worker:intents: subscribe Redis, parse payload intent LPFT, valida router su "
        "WhitelistedDexRouter, crea ExecutionLog con idempotency, stato PENDING o LOGGED_PROPOSAL."
    )
    pdf.h2("22.2 export-rlff-dataset.ts")
    pdf.body(
        "npm run rlff:export: estrae ExecutionLog con feedback e metriche in formato dataset "
        "per analisi offline / training (argomenti CLI in script)."
    )

    pdf.h1("23. Compiler strategia quant (afx-quant-compiler)")
    pdf.body(
        "parseQuantStrategyPayload accetta JSON dall'LLM. validateQuantStrategyInput verifica "
        "vincoli coerenza (simboli, pesi, risk). compileToEventDrivenConfig produce config per "
        "signal-engine (rebalance frequency, legs, asymmetric weights, halt rules). "
        "compileToEngineSpec mantiene compatibilità spec legacy per snapshot.engineSpec."
    )
    pdf.h2("23.1 Intent class")
    pdf.bullet("WALLET_MANAGEMENT — focus protezione capitale, ribilanciamento, RWA.")
    pdf.bullet("ALGORITHMIC_TRADING — segnali tecnici, trend, mean reversion.")

    pdf.h1("24. Stato repository Git (snapshot)")
    pdf.bullet("Branch: main (tracking origin/main).")
    pdf.bullet("Commit recenti: Alpaca provider; UX strategy pipeline; execution reliability; chat composer.")
    pdf.bullet("Working tree: numerosi file untracked in apps/web (AFX stack), docs, migrations — dev attivo.")
    pdf.body(
        "Raccomandazione: commit atomici per area (quant, UI chat, prisma, docs) prima di deploy condiviso."
    )

    pdf.h1("25. Glossario")
    glossary = [
        ("LPFT", "Laboratory / stack Python ricerca e backtest storico."),
        ("AFX", "Agentic Finance Exchange — layer exchange + chat + Prisma."),
        ("RLFF", "Reinforcement Learning from Feedback — log + feedback utente."),
        ("RWA", "Real World Asset — token sintetici tipo bAAPL."),
        ("RFQ", "Request for Quote — mercato primario fuori orario."),
        ("T+1", "Esecuzione rebalance al giorno successivo al segnale (realismo)."),
        ("HWM", "High water mark — picco equity per calcolo drawdown."),
        ("OHLCV", "Open/High/Low/Close/Volume — qui prevalenza adjClose Yahoo."),
    ]
    for term, defn in glossary:
        pdf.bullet(f"{term}: {defn}")

    pdf.h1("26. Conclusioni e prossimi passi")
    pdf.body(
        "Il progetto ha raggiunto un prototipo integrato end-to-end sulla UX chat e report: "
        "l'utente può conversare, generare strategie quant, vedere backtest con dati reali Yahoo, "
        "salvare strategie, aprire report analitici con registro trade, e avviare il flusso di "
        "proposta esecuzione con tracciamento RLFF. Il perimetro Python LPFT resta valido per API "
        "legacy, worker e intent bridge."
    )
    pdf.body(
        "Priorità consigliate per produzione: (1) hardening on-chain e signer KMS reale; "
        "(2) test integrazione API e smoke E2E; (3) consolidamento deploy singolo (Docker/K8s); "
        "(4) decisione blockchain e whitelist router produzione; (5) riduzione debito dual-engine "
        "solo se necessario per manutenzione — altrimenti documentare confini come in QUANT_ENGINES.md."
    )

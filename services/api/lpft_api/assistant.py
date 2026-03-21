from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from anthropic import Anthropic
from sqlmodel import Session

from lpft_api.config import settings
from lpft_api.db import Run, engine
from lpft_api.dsl import StrategySpec
from lpft_api.schemas import AssistantMessage

_client: Anthropic | None = None

_PLANNER_PROMPT = """You are LPFT Copilot, a trading-focused AI assistant similar to Cursor for trading workflows.
Your north star is helping the user obtain the strongest algorithm this stack can produce: coherent logic, realistic data assumptions, and parameters suited to their stated goal.

Return ONLY one JSON object with this shape:
{
  "mode": "answer" | "generate" | "modify" | "analyze" | "clarify",
  "assistant_reply": "natural, human short reply, 1-3 sentences",
  "should_backtest": true,
  "strategy_prompt": "filled only when mode is generate or modify",
  "analysis_prompt": "filled only when mode is analyze",
  "clarification_question": "filled only when mode is clarify",
  "clarification_options": ["2-4 short option labels when mode is clarify"]
}

Rules:
- Use "answer" for market questions, indicator questions, strategy theory, practical trading questions, or software/debugging questions that do not require producing a new strategy immediately.
- Use "generate" when the user is asking for a new strategy, new trading code, or explicitly wants a strategy built.
- Use "modify" when the user wants to revise, improve, fix, or debug the current strategy/code.
- Use "analyze" when the user is asking about current results, trades, drawdown, performance, or wants an explanation of the latest run.
- Use "clarify" whenever missing information would force weak or arbitrary choices for a high-quality strategy. Do NOT jump to generate/modify if critical knobs are unknown: ask first. The user stays in control, but you guide with expert defaults offered as explicit choices.
- For mode "clarify": ask exactly ONE high-leverage question. clarification_options must be 2-4 concrete choices. Order them by recommendation: put the best option for the user's stated goal FIRST (you may prefix with "Consigliato:" or "Recommended:" in the same language as the user). Include at least one escape hatch (e.g. "Altro / specifico" / "Other — I'll specify").
- For generate/modify: if instrument, universe/market, edge/style, horizon (bar + holding), risk posture, backtest history length, or run intent are unclear, prefer "clarify" over guessing. When the transcript is rich enough to proceed, use generate/modify with a strategy_prompt that locks those decisions.
- When you do generate, the downstream model must output a complete StrategySpec; any residual inference must appear in data.notes so the user can override on the next turn.
- Keep assistant_reply concise, practical, natural, and professional.
- assistant_reply should match the user's language.
- If mode is answer or analyze, strategy_prompt should be empty.
- If mode is generate or modify, strategy_prompt must be a strong instruction that another model can turn into a valid structured trading strategy.
- If mode is analyze, analysis_prompt must clearly state what to explain.
- Set should_backtest to true only if the user clearly wants a generated/modified strategy tested and the request is specific enough to design responsibly.
"""

_ANSWER_PROMPT = """You are LPFT Copilot, a high-quality trading assistant.
You answer like a very strong trading-focused AI teammate:
- strong on markets, indicators, strategy design, theory, practice, and debugging
- practical, concise, and clear
- warm, natural, and human
- conversational without sounding chatty or fake
- adapt depth to the question
- explain things in a way that feels thoughtful and collaborative
- honest about uncertainty
- when relevant, explain trade-offs
- never output JSON
- do not mention internal tools unless the user asks
- avoid stiff corporate phrasing
- prefer clean prose over bullet spam unless the content is naturally list-shaped
- sound like a sharp, calm product teammate helping in real time
- match the user's language
- if the user is vague, gently narrow the problem before giving a long answer
- if the user asks for help, lead with a direct answer instead of generic framing
- do not sound like a textbook unless the user explicitly wants a deep explanation
"""

_ITALIAN_HINT_RE = re.compile(
    r"\b(?:ciao|strategia|voglio|deve|dobbiamo|facciamo|miglior|mercato|dati|rischio|azioni|azionari|crypto|etf)\b",
    re.IGNORECASE,
)
_SPECIFIC_INSTRUMENT_TOKEN_RE = re.compile(r"\$?[A-Z]{2,6}(?:-[A-Z]{3,4})?")
_UNIVERSE_HINT_RE = re.compile(
    r"\b(?:[A-Z]{2,5}(?:-[A-Z]{3,4})?|bitcoin|btc|ethereum|eth|crypto|equity|equities|stock|stocks|azioni|azionario|etf|etfs|nasdaq|sp500|s&p)\b",
    re.IGNORECASE,
)
_STYLE_HINT_RE = re.compile(
    r"\b(?:sma|ema|rsi|macd|bollinger|breakout|momentum|trend|trend following|trend-following|mean reversion|mean-reversion|reversion|pullback|volatility|pairs|pair trading|stat arb|statistical arbitrage)\b",
    re.IGNORECASE,
)
_TIMEFRAME_HINT_RE = re.compile(
    r"\b(?:1m|5m|15m|30m|1h|1d|intraday|day trading|scalp|scalping|swing|multiday|daily|giornalier[oa]?|weekly|position|long term|medium term|overnight)\b",
    re.IGNORECASE,
)
# Codici periodo storico backtest (allineati a lpft_shared.market_data.VALID_PERIODS)
_BACKTEST_PERIOD_CODE_RE = re.compile(r"\b(1m|3m|6m|1y|2y|5y)\b", re.IGNORECASE)
_RISK_HINT_RE = re.compile(
    r"\b(?:long only|long-only|long short|long-short|market neutral|conservative|conservativo|balanced|bilanciat\w*|aggressive|aggressiv\w*|drawdown|stop loss|stop-loss|take profit|trailing stop|risk|rischio|hedged?|leva)\b",
    re.IGNORECASE,
)


@dataclass
class AssistantPlan:
    mode: str
    assistant_reply: str
    should_backtest: bool
    strategy_prompt: str = ""
    analysis_prompt: str = ""
    clarification_question: str = ""
    clarification_options: list[str] | None = None
    clarification_summary: list[str] | None = None
    clarification_missing: list[str] | None = None


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


def _extract_text(content: list) -> str:
    raw = ""
    for block in content:
        if getattr(block, "text", None):
            raw += block.text
    return raw.strip()


def _extract_json_from_text(text: str) -> str:
    text = text.strip()
    for pattern in (r"```(?:json)?\s*\n?(.*?)\n?```", r"```\s*(.*?)\s*```"):
        match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1).strip()
    start = text.find("{")
    if start == -1:
        return text
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:].strip()


def _messages_to_text(messages: list[AssistantMessage]) -> str:
    lines: list[str] = []
    for message in messages[-12:]:
        role = "User" if message.role == "user" else "Assistant"
        lines.append(f"{role}: {message.content}")
    return "\n".join(lines).strip()


def _latest_user_message(messages: list[AssistantMessage]) -> str:
    return next((m.content for m in reversed(messages) if m.role == "user"), "").strip()


def _looks_italian(text: str) -> bool:
    return bool(_ITALIAN_HINT_RE.search(text or ""))


def _normalize_message_text(messages: list[AssistantMessage]) -> str:
    return " ".join(m.content.strip() for m in messages if m.role == "user" and m.content.strip())


def _has_explicit_generation_approval(text: str) -> bool:
    return bool(
        re.search(
            r"\b(?:procedi|vai avanti|confermo|confermata|ok procedi|ok vai|solo codice|senza backtest|no backtest|proceed|go ahead|approved|confirmed|code only)\b",
            text,
            re.IGNORECASE,
        )
    )


def _has_backtest_request(text: str) -> bool:
    return bool(re.search(r"\b(?:backtest|testa|prova|esegui|run)\b", text, re.IGNORECASE))


@dataclass
class RequirementSnapshot:
    instrument: str | None = None
    universe: str | None = None
    edge: str | None = None
    timeframe: str | None = None
    risk: str | None = None
    execution: str | None = None
    backtest: str | None = None
    backtest_window: str | None = None  # 1m|3m|6m|1y|2y|5y quando l'utente indica quanto storico per il backtest
    missing: list[str] | None = None
    ready_for_generation: bool = False
    user_approved: bool = False

    def summary_lines(self, *, italian: bool) -> list[str]:
        labels = (
            {
                "universe": "Universo",
                "instrument": "Strumento",
                "edge": "Edge",
                "timeframe": "Orizzonte",
                "risk": "Rischio",
                "execution": "Esecuzione",
                "backtest": "Backtest",
            }
            if italian
            else {
                "universe": "Universe",
                "instrument": "Instrument",
                "edge": "Edge",
                "timeframe": "Horizon",
                "risk": "Risk",
                "execution": "Execution",
                "backtest": "Backtest",
            }
        )
        return [
            f"{labels['instrument']}: {self.instrument or ('da definire' if italian else 'to define')}",
            f"{labels['universe']}: {self.universe or ('da definire' if italian else 'to define')}",
            f"{labels['edge']}: {self.edge or ('da definire' if italian else 'to define')}",
            f"{labels['timeframe']}: {self.timeframe or ('da definire' if italian else 'to define')}",
            f"{labels['risk']}: {self.risk or ('da definire' if italian else 'to define')}",
            f"{labels['execution']}: {self.execution or ('default prudente' if italian else 'conservative default')}",
            f"{labels['backtest']}: {self.backtest or ('non ancora confermato' if italian else 'not confirmed yet')}",
        ]


def _collect_requirement_snapshot(
    messages: list[AssistantMessage],
    *,
    current_spec: StrategySpec | None,
) -> RequirementSnapshot:
    text = _normalize_message_text(messages)
    snapshot = RequirementSnapshot(missing=[])
    if current_spec is not None:
        universe = ", ".join(current_spec.universe.symbols)
        snapshot.instrument = universe
        snapshot.universe = f"{current_spec.data.asset_class}/{universe}"
        snapshot.edge = getattr(current_spec.kind, "value", str(current_spec.kind))
        snapshot.timeframe = getattr(current_spec.universe.timeframe, "value", str(current_spec.universe.timeframe))
        snapshot.risk = current_spec.execution.position_mode
        snapshot.execution = current_spec.execution.entry_timing
        snapshot.backtest = "requested"
        snapshot.ready_for_generation = True
        snapshot.user_approved = True
        snapshot.missing = []
        return snapshot

    lowered = text.lower()
    token_blacklist = {
        "RSI",
        "EMA",
        "SMA",
        "MACD",
        "OHLCV",
        "ETF",
        "ETFS",
        "USA",
        "USD",
        "SP500",
    }
    for match in _SPECIFIC_INSTRUMENT_TOKEN_RE.findall(text):
        token = match.lstrip("$")
        if token in token_blacklist:
            continue
        if token in {"BTC", "BITCOIN"}:
            snapshot.instrument = "BTC-USD"
            break
        if token in {"ETH", "ETHEREUM"}:
            snapshot.instrument = "ETH-USD"
            break
        if "-" in token or 1 <= len(token) <= 6:
            snapshot.instrument = token
            break
    if snapshot.instrument is None:
        if re.search(r"\bbitcoin\b", lowered):
            snapshot.instrument = "BTC-USD"
        elif re.search(r"\bethereum\b", lowered):
            snapshot.instrument = "ETH-USD"

    if _UNIVERSE_HINT_RE.search(text):
        if re.search(r"\b(?:btc|bitcoin|eth|ethereum|crypto)\b", lowered):
            snapshot.universe = "crypto"
        elif re.search(r"\b(?:etf|etfs)\b", lowered):
            snapshot.universe = "etf"
        elif re.search(r"\b(?:azioni|stock|stocks|equity|equities|nasdaq|sp500|s&p)\b", lowered):
            snapshot.universe = "equity"
        else:
            snapshot.universe = "specific symbol or market mentioned"

    if _STYLE_HINT_RE.search(text):
        if re.search(r"\b(?:trend|momentum|sma|ema|macd)\b", lowered):
            snapshot.edge = "trend or momentum"
        elif re.search(r"\b(?:mean reversion|mean-reversion|reversion|rsi|bollinger)\b", lowered):
            snapshot.edge = "mean reversion"
        elif re.search(r"\b(?:breakout)\b", lowered):
            snapshot.edge = "breakout"
        else:
            snapshot.edge = "strategy style mentioned"

    if _TIMEFRAME_HINT_RE.search(text):
        if re.search(r"\b(?:1m|5m|15m|30m|1h|intraday|scalp|day trading)\b", lowered):
            snapshot.timeframe = "intraday"
        elif re.search(r"\b(?:swing|few days|multiday|overnight)\b", lowered):
            snapshot.timeframe = "swing"
        elif re.search(r"\b(?:1d|daily|giornalier|position|weeks|weekly|long term|medium term)\b", lowered):
            snapshot.timeframe = "daily or position"

    if _RISK_HINT_RE.search(text):
        if re.search(r"\b(?:conservative|conservativo)\b", lowered):
            snapshot.risk = "conservative"
        elif re.search(r"\b(?:balanced|bilanciato)\b", lowered):
            snapshot.risk = "balanced"
        elif re.search(r"\b(?:aggressive|aggressivo)\b", lowered):
            snapshot.risk = "aggressive"
        elif re.search(r"\b(?:long short|long-short|market neutral)\b", lowered):
            snapshot.risk = "long-short or market-neutral"
        else:
            snapshot.risk = "risk preferences mentioned"

    if re.search(r"\b(?:bar close|bar_close|next bar open|next_bar_open)\b", lowered):
        snapshot.execution = "execution timing specified"
    if _has_backtest_request(text):
        snapshot.backtest = "requested"
    elif re.search(r"\b(?:senza backtest|no backtest|solo codice|only code)\b", lowered):
        snapshot.backtest = "not requested"

    pcm = _BACKTEST_PERIOD_CODE_RE.search(text)
    if pcm:
        snapshot.backtest_window = pcm.group(1).lower()
    elif re.search(r"\b(?:cinque|5)\s*anni\b", lowered) or re.search(r"\b5\s*years?\b", lowered):
        snapshot.backtest_window = "5y"
    elif re.search(r"\b(?:due|2)\s*anni\b", lowered) or re.search(r"\b2\s*years?\b", lowered):
        snapshot.backtest_window = "2y"
    elif re.search(r"\b(?:un|1)\s*anno\b", lowered) or re.search(r"\b1\s*year\b", lowered):
        snapshot.backtest_window = "1y"
    elif re.search(r"\b(?:sei|6)\s*mesi\b", lowered):
        snapshot.backtest_window = "6m"
    elif re.search(r"\b(?:tre|3)\s*mesi\b", lowered):
        snapshot.backtest_window = "3m"
    elif re.search(r"\b(?:un|1)\s*mese\b", lowered):
        snapshot.backtest_window = "1m"

    snapshot.user_approved = _has_explicit_generation_approval(text)
    snapshot.missing = []
    if snapshot.instrument is None:
        snapshot.missing.append("instrument")
    if snapshot.universe is None:
        snapshot.missing.append("universe")
    if snapshot.edge is None:
        snapshot.missing.append("edge")
    if snapshot.timeframe is None:
        snapshot.missing.append("timeframe")
    if snapshot.risk is None:
        snapshot.missing.append("risk")
    snapshot.ready_for_generation = bool(
        not snapshot.missing
        and (snapshot.backtest != "requested" or snapshot.backtest_window is not None)
    )
    return snapshot


def _backtest_window_options(snapshot: RequirementSnapshot, *, italian: bool) -> list[str]:
    """Opzioni consigliate per history_period: la prima è la scelta algoritmica migliore per il contesto."""
    edge_l = (snapshot.edge or "").lower()
    tf_l = (snapshot.timeframe or "").lower()
    intraday = "intraday" in tf_l or "scalp" in tf_l
    mean_rv = "reversion" in edge_l or "mean" in edge_l
    trend = "trend" in edge_l or "momentum" in edge_l

    if intraday:
        if italian:
            return [
                "Consigliato: 1y (più barre intraday utili)",
                "6m",
                "3m",
                "Altro — specifico io",
            ]
        return [
            "Recommended: 1y (more intraday history)",
            "6m",
            "3m",
            "Other — I'll specify",
        ]
    if mean_rv:
        if italian:
            return [
                "Consigliato: 5y (sample più ricco per z-score su daily)",
                "2y",
                "1y",
                "Altro — specifico io",
            ]
        return [
            "Recommended: 5y (richer sample for daily z-scores)",
            "2y",
            "1y",
            "Other — I'll specify",
        ]
    if trend:
        if italian:
            return [
                "Consigliato: 5y (più cicli di mercato)",
                "2y",
                "1y",
                "Altro — specifico io",
            ]
        return [
            "Recommended: 5y (more market regimes)",
            "2y",
            "1y",
            "Other — I'll specify",
        ]
    if italian:
        return [
            "Consigliato: 5y (default robusto LPFT)",
            "2y",
            "1y",
            "Altro — specifico io",
        ]
    return [
        "Recommended: 5y (robust LPFT default)",
        "2y",
        "1y",
        "Other — I'll specify",
    ]


def _instrument_clarification_options(snapshot: RequirementSnapshot, *, italian: bool) -> list[str]:
    if snapshot.universe == "crypto":
        return ["BTC-USD", "ETH-USD", "SOL-USD", "Un'altra crypto"] if italian else ["BTC-USD", "ETH-USD", "SOL-USD", "Another crypto"]
    if snapshot.universe == "etf":
        return ["SPY", "QQQ", "TLT", "Un altro ETF"] if italian else ["SPY", "QQQ", "TLT", "Another ETF"]
    if snapshot.universe == "equity":
        return ["AAPL", "MSFT", "NVDA", "Un altro ticker"] if italian else ["AAPL", "MSFT", "NVDA", "Another ticker"]
    return ["AAPL", "SPY", "BTC-USD", "Un altro strumento"] if italian else ["AAPL", "SPY", "BTC-USD", "Another instrument"]


def _requirements_clarification_plan(
    *,
    mode: str,
    messages: list[AssistantMessage],
    latest_user: str,
    current_code: str | None,
    current_spec: StrategySpec | None,
) -> AssistantPlan | None:
    if mode not in {"generate", "modify"}:
        return None
    if current_spec is not None or (current_code and current_code.strip()):
        return None
    text = latest_user.strip()
    if not text:
        return None

    italian = _looks_italian(text)
    snapshot = _collect_requirement_snapshot(messages, current_spec=current_spec)
    summary = snapshot.summary_lines(italian=italian)
    missing_labels = (
        {
            "instrument": "strumento operativo",
            "universe": "universo",
            "edge": "edge",
            "timeframe": "orizzonte operativo",
            "risk": "profilo di rischio",
        }
        if italian
        else {
            "instrument": "trading instrument",
            "universe": "universe",
            "edge": "edge",
            "timeframe": "trading horizon",
            "risk": "risk profile",
        }
    )
    missing_pretty = [missing_labels[item] for item in snapshot.missing or []]

    if snapshot.instrument is None:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "Prima di tutto voglio fissare lo strumento su cui operare, altrimenti la strategia resta troppo generica."
                if italian
                else "First I want to lock the trading instrument, otherwise the strategy stays too generic."
            ),
            should_backtest=False,
            clarification_question=(
                "Su quale strumento vuoi operare per prima?"
                if italian
                else "Which instrument should I build it for first?"
            ),
            clarification_options=_instrument_clarification_options(snapshot, italian=italian),
            clarification_summary=summary,
            clarification_missing=missing_pretty,
        )

    if snapshot.universe is None:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "Prima di costruirla voglio fissare il mercato giusto, cosi non stiamo progettando alla cieca."
                if italian
                else "Before I build it, I want to lock the market first so we are not designing blindly."
            ),
            should_backtest=False,
            clarification_question=(
                "Su quale universo vuoi che la progetti per prima?"
                if italian
                else "Which universe should I design it for first?"
            ),
            clarification_options=(
                [
                    "Consigliato: azioni USA molto liquide (spread e dati migliori)",
                    "ETF liquidi (es. broad market)",
                    "Crypto major",
                    "Un ticker specifico",
                ]
                if italian
                else [
                    "Recommended: very liquid US equities (tighter spreads, cleaner data)",
                    "Liquid ETFs (e.g. broad market)",
                    "Major crypto",
                    "One specific ticker",
                ]
            ),
            clarification_summary=summary,
            clarification_missing=missing_pretty,
        )

    if snapshot.edge is None:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "Per massima qualità algoritmica serve fissare il tipo di edge: da lì dipendono parametri e validazione."
                if italian
                else "For the strongest algorithm we should lock the edge first—that drives parameters and validation."
            ),
            should_backtest=False,
            clarification_question=(
                "Qual è il motore principale della strategia?"
                if italian
                else "What should be the main engine of the strategy?"
            ),
            clarification_options=(
                [
                    "Consigliato: mean reversion su strumenti liquidi (spesso robusta in daily)",
                    "Trend / momentum",
                    "Breakout",
                    "Ibrida conservativa (meno overfit)",
                ]
                if italian
                else [
                    "Recommended: mean reversion on liquid names (often robust on daily)",
                    "Trend / momentum",
                    "Breakout",
                    "Conservative hybrid (less overfit)",
                ]
            ),
            clarification_summary=summary,
            clarification_missing=missing_pretty,
        )

    if snapshot.timeframe is None:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "L'orizzonte decide barra, costi e qualità dati: per algoritmi solidi conviene sceglierlo esplicitamente."
                if italian
                else "Horizon drives bar size, costs, and data quality—worth choosing explicitly for a solid algorithm."
            ),
            should_backtest=False,
            clarification_question=(
                "Che orizzonte vuoi colpire?"
                if italian
                else "What holding horizon do you want to target?"
            ),
            clarification_options=(
                [
                    "Consigliato: daily / position (dati free più stabili, meno buchi)",
                    "Swing (pochi giorni)",
                    "Intraday (più rumore, serve contesto chiaro)",
                    "Altro — specifico io",
                ]
                if italian
                else [
                    "Recommended: daily / position (freest data more stable, fewer gaps)",
                    "Swing (few days)",
                    "Intraday (noisier—needs clear intent)",
                    "Other — I'll specify",
                ]
            ),
            clarification_summary=summary,
            clarification_missing=missing_pretty,
        )

    if snapshot.risk is None:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "Il profilo di rischio vincola sizing e drawdown: meglio definirlo prima di generare codice."
                if italian
                else "Risk profile caps sizing and drawdown—better to define it before code generation."
            ),
            should_backtest=False,
            clarification_question=(
                "Che profilo di rischio vuoi?"
                if italian
                else "What risk profile do you want?"
            ),
            clarification_options=(
                [
                    "Consigliato: bilanciato (buon default per partire)",
                    "Conservativo",
                    "Aggressivo",
                    "Long/short solo se serve",
                ]
                if italian
                else [
                    "Recommended: balanced (strong default to start)",
                    "Conservative",
                    "Aggressive",
                    "Long/short only if needed",
                ]
            ),
            clarification_summary=summary,
            clarification_missing=missing_pretty,
        )

    if snapshot.backtest == "requested" and snapshot.backtest_window is None:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "Per un backtest affidabile serve quantificare lo storico: più anni → statistiche migliori ma più dati."
                if italian
                else "For a credible backtest we need a history length: more years → better statistics but more data load."
            ),
            should_backtest=False,
            clarification_question=(
                "Quanto storico vuoi usare per il backtest?"
                if italian
                else "How much history should the backtest use?"
            ),
            clarification_options=_backtest_window_options(snapshot, italian=italian),
            clarification_summary=summary,
            clarification_missing=missing_pretty
            + [
                ("finestra storica backtest" if italian else "backtest history window"),
            ],
        )

    if not snapshot.user_approved:
        return AssistantPlan(
            mode="clarify",
            assistant_reply=(
                "Adesso il quadro e abbastanza definito. Prima di generare voglio lasciarti il pieno controllo sulle assunzioni finali."
                if italian
                else "The picture is defined enough now. Before I generate, I want to leave you full control over the final assumptions."
            ),
            should_backtest=False,
            clarification_question=(
                "Vuoi che proceda con questi vincoli, oppure vuoi rifinire ancora qualcosa prima della generazione?"
                if italian
                else "Do you want me to proceed with these constraints, or refine something else before generation?"
            ),
            clarification_options=(
                ["Procedi con la generazione", "Rivediamo universo", "Rivediamo rischio", "Niente backtest per ora"]
                if italian
                else ["Proceed with generation", "Revisit universe", "Revisit risk", "No backtest for now"]
            ),
            clarification_summary=summary,
            clarification_missing=[],
        )

    return None


def _artifact_text(run_id: int | None) -> str:
    if not run_id:
        return ""
    art_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
    if not art_dir.is_dir():
        return ""
    snippets: list[str] = []

    metrics_path = art_dir / "metrics.json"
    if metrics_path.is_file():
        try:
            metrics = json.loads(metrics_path.read_text())
            snippets.append("Latest metrics:\n" + json.dumps(metrics, indent=2))
        except Exception:
            pass

    trades_path = art_dir / "trades.csv"
    if trades_path.is_file():
        try:
            rows = list(csv.DictReader(io.StringIO(trades_path.read_text())))
            sample = rows[:5]
            snippets.append("Latest trades sample:\n" + json.dumps(sample, indent=2))
        except Exception:
            pass

    code_path = art_dir / "code.py"
    if code_path.is_file():
        try:
            snippets.append("Latest generated code:\n" + code_path.read_text()[:2500])
        except Exception:
            pass

    return "\n\n".join(snippets).strip()


def _run_summary_text(run_id: int | None) -> str:
    if not run_id:
        return ""
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if not run:
            return ""
        payload = {
            "run_id": run.id,
            "status": run.status,
            "symbol": run.symbol,
            "period": run.period,
            "timeframe": run.timeframe,
            "error": run.error,
        }
    return "Latest run summary:\n" + json.dumps(payload, indent=2)


def _context_text(
    messages: list[AssistantMessage],
    *,
    current_run_id: int | None,
    current_code: str | None,
    current_spec: StrategySpec | None,
    symbol: str,
    period: str,
    timeframe: str,
) -> str:
    parts = [
        "Conversation transcript:",
        _messages_to_text(messages) or "(empty)",
        "",
        f"Current symbol: {symbol}",
        f"Current period: {period}",
        f"Current timeframe: {timeframe}",
    ]
    if current_spec is not None:
        parts.extend(["", "Current strategy spec:", current_spec.model_dump_json(indent=2)])
    if current_code:
        parts.extend(["", "Current strategy code:", current_code[:2500]])
    run_summary = _run_summary_text(current_run_id)
    if run_summary:
        parts.extend(["", run_summary])
    artifacts = _artifact_text(current_run_id)
    if artifacts:
        parts.extend(["", artifacts])
    return "\n".join(parts).strip()


def plan_assistant_turn(
    messages: list[AssistantMessage],
    *,
    current_run_id: int | None,
    current_code: str | None,
    current_spec: StrategySpec | None,
    symbol: str,
    period: str,
    timeframe: str,
) -> AssistantPlan:
    context = _context_text(
        messages,
        current_run_id=current_run_id,
        current_code=current_code,
        current_spec=current_spec,
        symbol=symbol,
        period=period,
        timeframe=timeframe,
    )
    client = _get_client()
    call = client.messages.create(
        model=settings.llm_model,
        max_tokens=1200,
        system=_PLANNER_PROMPT,
        messages=[{"role": "user", "content": context}],
    )
    raw = _extract_text(call.content)
    cleaned = _extract_json_from_text(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        latest = _latest_user_message(messages)
        return AssistantPlan(
            mode="answer",
            assistant_reply="I can help with trading questions, strategy design, debugging, or result analysis.",
            should_backtest=False,
            strategy_prompt=latest,
        )

    mode = str(data.get("mode") or "answer").strip().lower()
    if mode not in {"answer", "generate", "modify", "analyze", "clarify"}:
        mode = "answer"
    plan = AssistantPlan(
        mode=mode,
        assistant_reply=str(data.get("assistant_reply") or "").strip() or "I’m on it.",
        should_backtest=bool(data.get("should_backtest")) if mode in {"generate", "modify"} else False,
        strategy_prompt=str(data.get("strategy_prompt") or "").strip(),
        analysis_prompt=str(data.get("analysis_prompt") or "").strip(),
        clarification_question=str(data.get("clarification_question") or "").strip(),
        clarification_options=[
            str(option).strip()
            for option in (data.get("clarification_options") or [])
            if str(option).strip()
        ][:4],
    )
    forced_clarification = _requirements_clarification_plan(
        mode=plan.mode,
        messages=messages,
        latest_user=_latest_user_message(messages),
        current_code=current_code,
        current_spec=current_spec,
    )
    return forced_clarification or plan


def stream_answer(
    messages: list[AssistantMessage],
    *,
    current_run_id: int | None,
    current_code: str | None,
    current_spec: StrategySpec | None,
    symbol: str,
    period: str,
    timeframe: str,
    analysis_prompt: str = "",
) -> Iterable[str]:
    context = _context_text(
        messages,
        current_run_id=current_run_id,
        current_code=current_code,
        current_spec=current_spec,
        symbol=symbol,
        period=period,
        timeframe=timeframe,
    )
    latest_user = _latest_user_message(messages)
    user_content = latest_user
    if analysis_prompt:
        user_content = f"{analysis_prompt}\n\nUse this context if helpful:\n{context}"
    else:
        user_content = f"{latest_user}\n\nRelevant context:\n{context}"

    client = _get_client()
    with client.messages.stream(
        model=settings.llm_model,
        max_tokens=1800,
        system=_ANSWER_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    ) as stream:
        for text in stream.text_stream:
            yield text


def build_strategy_prompt(
    plan: AssistantPlan,
    messages: list[AssistantMessage],
    *,
    current_code: str | None,
    current_spec: StrategySpec | None,
    current_run_id: int | None,
    symbol: str,
    period: str,
    timeframe: str,
) -> str:
    latest_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
    snapshot = _collect_requirement_snapshot(messages, current_spec=current_spec)
    parts = [
        "User goal:",
        latest_user,
        "",
        f"Target symbol: {symbol}",
        f"Target period: {period}",
        f"Target timeframe: {timeframe}",
    ]
    parts.extend(["", "Collected user requirements:", *snapshot.summary_lines(italian=False)])
    if snapshot.missing:
        parts.extend(["", "Still missing, so only infer conservatively if truly necessary:", ", ".join(snapshot.missing)])
    if current_spec is not None:
        parts.extend(["", "Current strategy spec to revise if relevant:", current_spec.model_dump_json(indent=2)])
    if current_code:
        parts.extend(["", "Current generated code to consider:", current_code[:2500]])
    if current_run_id:
        artifact_context = _artifact_text(current_run_id)
        if artifact_context:
            parts.extend(["", "Latest run context:", artifact_context])
    if plan.strategy_prompt:
        parts.extend(["", "Planner instruction:", plan.strategy_prompt])
    parts.extend(
        [
            "",
            "Return a valid trading strategy spec that best satisfies the request. Use practical defaults, realistic risk, and include universe.",
            "The model must emit a complete StrategySpec: every required param for the chosen kind, full risk and execution, universe.symbols and universe.timeframe, and data fields for OHLCV (including data.history_period 1m|3m|6m|1y|2y|5y). Nothing critical should be left implicit for the server to guess.",
            "Set universe.timeframe to the bar interval the strategy uses (1m|5m|15m|30m|1h|1d); it drives OHLCV bar size in the backtest.",
            "Set data.history_period to the backtest lookback window. If the user did not specify, pick the best default for the strategy style and document it in data.notes so they can change it.",
            "When you infer defaults (thresholds, horizons, provider, risk caps), list each assumption briefly in data.notes. The user must stay in control: transparent, adjustable choices, not opaque shortcuts.",
            "If the user just picked a multiple-choice option from clarification (e.g. recommended horizon or history window), treat it as binding and reflect it in universe, data.history_period, risk, and params.",
            "Align universe.timeframe with user intent (intraday vs swing vs daily). If ambiguous, choose a conventional default and note it.",
            "Use only the confirmed user requirements and current strategy context. Do not silently invent major design decisions when the conversation already constrained them.",
            "Prefer supported built-in strategy kinds when possible.",
            "If you choose kind=python, the code must stay compatible with the shared backtest runtime: pandas only, no external libraries beyond pandas/numpy compatibility, and only OHLCV columns.",
            "If you choose kind=python, prefer readable target-position logic, initialize numeric series with 0.0, avoid lookahead bias, and keep the implementation production-grade for the available information.",
            "Use execution.position_mode=long_short only when the user clearly wants short exposure.",
            "Set data.asset_class explicitly when the user is talking about equities, ETFs, or crypto.",
            "Use data.provider_preference='auto' (Yahoo-first backtests) unless the user asks for a specific provider (yahoo, stooq, or alpaca with API keys configured).",
            "Default to data.quality_policy='best_effort' for free providers unless the user explicitly asks for stricter gating.",
            "For equities and ETFs, set data.corporate_actions_required=true unless the request clearly does not care about adjusted data.",
            "If one non-critical assumption still has to be inferred, choose the most conservative tradable assumption and record it in data.notes.",
            "Use only bar-based OHLCV logic that can be evaluated from open, high, low, close, and volume unless you intentionally mark the request as needing unsupported data in data.market_model or data.requires_intrabar.",
            "Do not pretend bid/ask, order-book, options-chain, tick-level, or intrabar execution data exists when it does not.",
            "Do not use arithmetic tricks on data.index, alternating synthetic position proxies, or fake inventory logic.",
            "Do not invent bid, ask, spread, queue position, maker rebates, or execution-side concepts from OHLCV candles alone.",
            "Populate risk with reasonable defaults for max_position_pct, max_gross_exposure, and transaction costs.",
            "When improving an existing strategy, preserve its core idea, reduce unnecessary filters, and avoid making it so restrictive that it produces zero trades.",
            "Prefer robust, tradable logic over clever but sparse logic.",
        ]
    )
    return "\n".join(parts).strip()

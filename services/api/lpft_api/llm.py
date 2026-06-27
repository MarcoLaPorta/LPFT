from __future__ import annotations

import json
import logging
import re
from typing import Literal

from anthropic import Anthropic

from lpft_api.config import settings
from lpft_api.dsl import StrategySpec
from lpft_api.schemas import StrategySpecNormalizationMeta
from lpft_api.strategy_spec_tool import extract_strategy_spec_from_tool_response, get_submit_strategy_spec_tool_definition

_client: Anthropic | None = None
logger = logging.getLogger(__name__)

# Short system message for JSON repair (second pass) — improves consistency vs. bare user message.
_REPAIR_STRATEGY_SPEC_SYSTEM = (
    "You fix malformed or incomplete StrategySpec JSON. Output exactly one JSON object, no markdown. "
    "Requirements: data.notes is a non-empty string; data.history_period is one of 1m|3m|6m|1y|2y|5y; "
    "universe.symbols non-empty; all params required for the chosen kind; full risk and execution blocks."
)


def normalize_strategy_spec(spec: StrategySpec) -> tuple[StrategySpec, StrategySpecNormalizationMeta]:
    """
    Deterministic post-pass: fill missing history_period and empty data.notes so backtests are reproducible
    and the UI always shows explicit assumptions (even when the LLM drifts).
    """
    data_updates: dict = {}
    fields_filled: list[str] = []
    if spec.data.history_period is None:
        tf = getattr(spec.universe.timeframe, "value", str(spec.universe.timeframe))
        if tf in ("1m", "5m", "15m", "30m"):
            data_updates["history_period"] = "3m"
        elif tf == "1h":
            data_updates["history_period"] = "1y"
        else:
            data_updates["history_period"] = "5y"
        fields_filled.append("data.history_period")
    notes = (spec.data.notes or "").strip()
    if not notes:
        hp = data_updates.get("history_period", spec.data.history_period)
        if hp is None:
            hp = "5y"
        summary_bits = [
            f"kind={getattr(spec.kind, 'value', spec.kind)}",
            f"symbols={list(spec.universe.symbols)}",
            f"timeframe={getattr(spec.universe.timeframe, 'value', spec.universe.timeframe)}",
            f"history_period={hp}",
            f"max_position_pct={spec.risk.max_position_pct}",
            f"fee_bps={spec.risk.fee_bps}",
        ]
        data_updates["notes"] = (
            "LPFT auto-summary (refine as needed): " + "; ".join(summary_bits) + ". "
            "Confirm horizon, provider, and risk before production use."
        )
        fields_filled.append("data.notes")
    if not data_updates:
        return spec, StrategySpecNormalizationMeta(applied=False, fields_filled=[], notes_provenance="llm")
    notes_provenance: Literal["llm", "server_auto"] = "llm"
    if "data.notes" in fields_filled:
        notes_provenance = "server_auto"
    new_spec = spec.model_copy(update={"data": spec.data.model_copy(update=data_updates)})
    return new_spec, StrategySpecNormalizationMeta(
        applied=True,
        fields_filled=fields_filled,
        notes_provenance=notes_provenance,
    )

# Prepended to every user message so free-form chat still yields a complete spec.
STRATEGY_BRIEF_PREFIX = """Before answering, treat this as a structured brief. Your JSON MUST explicitly satisfy:
- universe.symbols: non-empty list (use US tickers for equities unless user said otherwise).
- universe.timeframe: bar size (1m|5m|15m|30m|1h|1d) aligned to the user horizon.
- data.history_period: one of 1m|3m|6m|1y|2y|5y for backtest horizon.
- data.notes: non-empty string listing every important inference (symbols, thresholds, provider, risk caps) so the user can edit them.
- risk + execution: explicit max_position_pct, max_gross_exposure, fee_bps, slippage_bps, entry_timing, position_mode.

If the user message is vague, choose conservative tradable defaults and explain them in data.notes.

"""

# Shared compact examples for non-stream + stream spec generation (keep in sync).
STRATEGY_SCHEMA_HINT = (
    'Example sma: {"kind":"sma_crossover","params":{"fast":10,"slow":20,"price":"close"},'
    '"risk":{"max_position_pct":0.2,"max_gross_exposure":1.0,"fee_bps":2.0,"slippage_bps":1.0},'
    '"universe":{"symbols":["AAPL"],"timeframe":"1d"},'
    '"execution":{"position_mode":"long_only","rebalance":"equal_weight","entry_timing":"next_bar_open"},'
    '"data":{"market_model":"ohlcv","requires_intrabar":false,"asset_class":"equity","provider_preference":"auto","quality_policy":"best_effort","freshness_requirement":"standard","coverage_requirement":"standard","corporate_actions_required":true,"history_period":"5y","notes":"history_period=5y for robust sample; fast/slow per default crossover."}}'
    ' Example python (no embedded code; server generates): {"kind":"python","params":{"code":""},'
    '"risk":{"max_position_pct":0.2,"max_gross_exposure":1.0,"fee_bps":2.0,"slippage_bps":1.0},'
    '"universe":{"symbols":["MSFT"],"timeframe":"1d"},"execution":{"position_mode":"long_only","rebalance":"equal_weight","entry_timing":"next_bar_open"},'
    '"data":{"market_model":"ohlcv","requires_intrabar":false,"asset_class":"equity","provider_preference":"auto","quality_policy":"best_effort","freshness_requirement":"standard","coverage_requirement":"standard","corporate_actions_required":true,"history_period":"2y","notes":"Custom logic via LLM; confirm symbols and horizon."}}'
)

_prompt = """You are a rigorous trading strategy designer. Given a user description, output a single JSON object that conforms to StrategySpec.

This JSON is the single source of truth for the backtest engine: risk, execution, universe, and data are compiled into the engine metadata (LPFT-META) when code is generated. Incomplete JSON causes broken backtests.

Allowed kinds:
- sma_crossover
- ema_crossover
- rsi
- macd
- bollinger
- breakout
- mean_reversion
- python

Required top-level fields:
- kind
- params
- risk
- universe
- execution
- data

Rules:
- Output a fully specified StrategySpec: every required field for the chosen kind must be present with explicit values (no reliance on hidden server defaults for params, universe, risk, execution, or data).
- Backtest and future paper/live alignment: always set universe.symbols, universe.timeframe, data.history_period (1m|3m|6m|1y|2y|5y), data.asset_class, data.provider_preference, and risk/execution fields needed for OHLCV loading and portfolio rules.
- If the user omits details: you choose sensible professional defaults for that strategy style, but list each non-trivial inference briefly in data.notes (e.g. "history_period=5y for robust sample", "entry_z=2 mean-reversion threshold") so the user can see and override them on the next message.
- The user remains in control: prefer transparent, adjustable parameters; do not bury material assumptions; when choosing between plausible options, state the tradeoff in data.notes.
- Use built-in kinds whenever the request fits one.
- Use python only for custom logic that cannot be expressed cleanly with the built-in kinds.
- risk supports: max_position_pct 0.01-1, max_gross_exposure 0.01-2, optional stop_loss_pct, take_profit_pct, trailing_stop_pct, fee_bps, slippage_bps.
- universe supports symbols list and timeframe 1m|5m|15m|30m|1h|1d (this is the bar interval for OHLCV ingestion and backtesting — set it from the user's horizon, e.g. intraday vs daily).
- execution supports position_mode (long_only|long_short), rebalance (equal_weight|dynamic), entry_timing (next_bar_open|bar_close).
- data supports:
  - market_model (ohlcv|bid_ask|order_book|options)
  - requires_intrabar boolean
  - asset_class (auto|equity|etf|crypto)
  - provider_preference (auto|yahoo|stooq; auto uses Yahoo first)
  - quality_policy (strict_gate|quality_labels|best_effort)
  - freshness_requirement (relaxed|standard|strict)
  - coverage_requirement (relaxed|standard|strict)
  - corporate_actions_required boolean
  - market optional string
  - history_period required in practice: set 1m|3m|6m|1y|2y|5y to match backtest horizon; if the user did not say, pick the best default for the strategy and explain in data.notes
- For python kind, params.code must be a **substantial** implementation (typically 50–200 lines): module docstring, comments on logic and parameters, explicit handling of NaN/warm-up bars, vectorized pandas where possible, and no placeholder/TODO. Short 10-line stubs are unacceptable unless the user explicitly asked for a minimal sketch.
- For mean_reversion, params MUST include "period", "entry_z", "exit_z", and "price". entry_z and exit_z are POSITIVE magnitudes in σ (the engine enters long when z <= -entry_z); never use negative numbers for these—use the absolute distance from the mean.
- Use confirmed user requirements whenever they are provided.
- If some details are still missing, use conservative practical defaults and record the most important assumptions in data.notes.
- Do not leave major fields ambiguous or empty.
- Prefer robust, tradable logic over clever but fragile logic.
- data.notes must never be empty: summarize inferred parameters and why they were chosen (even 1–2 sentences minimum).
- For kind=python, params.code may be empty when the server will generate code from the rest of the spec; if you embed code, it must follow engine rules (pandas OHLCV only).

Output ONLY the JSON object, no markdown, no explanation, no code fences."""

# Prompt per streaming: prima ragiona in italiano, poi output ---JSON--- e il JSON
_prompt_stream = """You are an expert algo trading assistant. The StrategySpec JSON after ---JSON--- must be complete: universe.symbols, universe.timeframe, data.history_period, data.notes (non-empty), risk, execution, and all params for the chosen kind.

For the user's request:
1. Think in simple English using very short status-style sentences only.
2. Each sentence must briefly describe what you are doing right now, like: "Reviewing the current logic." "Tightening the entry rules." "Preparing the new spec."
3. Keep each sentence concise, practical, and easy to show as a single live status line. Do not dump raw parameter lists unless necessary.
4. Then write exactly the line ---JSON--- and immediately after it output one complete StrategySpec JSON (all required params for that kind, full universe/data/risk/execution, data.history_period set, data.notes listing any values you inferred when the user was vague)
   - risk
   - universe
   - execution
   - data
No markdown and no explanation after the JSON."""

MAX_TOKENS_STRATEGY = 4096  # risposte più lunghe per strategie complesse
SEP_JSON = "---JSON---"


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


def _extract_text(content: list) -> str:
    raw = ""
    for b in content:
        if getattr(b, "text", None):
            raw += b.text
    return raw.strip()


def _extract_json_from_text(s: str) -> str:
    """Estrae il JSON dalla risposta (rimuove markdown, testo prima/dopo)."""
    s = s.strip()
    # Rimuovi blocchi ```json ... ``` o ``` ... ```
    for pattern in (r"```(?:json)?\s*\n?(.*?)\n?```", r"```\s*(.*?)\s*```"):
        m = re.search(pattern, s, re.DOTALL | re.IGNORECASE)
        if m:
            return m.group(1).strip()
    # Cerca il primo { ... } bilanciato
    start = s.find("{")
    if start == -1:
        return s
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    return s[start:].strip()


_NOTES_ENRICH_SYSTEM = """You only expand the field data.notes for a trading StrategySpec.
Output a single JSON object with one key "notes" (string). Write 2–5 sentences listing: symbols, bar timeframe,
history_period, key strategy parameters, risk caps (max position, fees), execution (entry timing, position mode),
and data/provider assumptions. Match the user's language (Italian or English) when obvious. Do not change facts not in the spec."""


def _parse_spec_text(raw: str) -> StrategySpec:
    try:
        cleaned = _extract_json_from_text(raw)
        return StrategySpec.model_validate(json.loads(cleaned))
    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(
            "L'LLM non ha prodotto JSON valido. Riprova con un prompt più chiaro o tra qualche secondo."
        ) from e


def _generate_strategy_spec_text_only(client: Anthropic, user_prompt: str) -> StrategySpec:
    call = client.messages.create(
        model=settings.llm_model,
        max_tokens=MAX_TOKENS_STRATEGY,
        system=_prompt + "\n" + STRATEGY_SCHEMA_HINT,
        messages=[{"role": "user", "content": STRATEGY_BRIEF_PREFIX + user_prompt}],
    )
    raw = _extract_text(call.content)
    if not raw:
        raise ValueError("L'LLM ha restituito una risposta vuota. Riprova tra qualche secondo (possibile rate limit).")
    try:
        return _parse_spec_text(raw)
    except ValueError:
        pass
    repair_prompt = "Fix this to be a single valid StrategySpec JSON. Output only the JSON object, nothing else:\n" + (
        raw[:800] + "..." if len(raw) > 800 else raw
    )
    call2 = client.messages.create(
        model=settings.llm_model,
        max_tokens=MAX_TOKENS_STRATEGY,
        system=_REPAIR_STRATEGY_SPEC_SYSTEM,
        messages=[{"role": "user", "content": repair_prompt}],
    )
    raw2 = _extract_text(call2.content)
    if not raw2:
        raise ValueError(
            "L'LLM non ha prodotto JSON valido. Riprova con un prompt più chiaro o tra qualche secondo."
        )
    return _parse_spec_text(raw2)


def maybe_enrich_data_notes(
    spec: StrategySpec,
    meta: StrategySpecNormalizationMeta,
    *,
    structured_output_mode: Literal["tool_use", "text_json"],
) -> tuple[StrategySpec, StrategySpecNormalizationMeta]:
    """Secondo passaggio LLM opzionale se data.notes è troppo corta."""
    base = meta.model_copy(update={"structured_output_mode": structured_output_mode})
    if not settings.notes_enrich_enabled:
        return spec, base
    min_c = int(settings.notes_enrich_min_chars or 0)
    if min_c <= 0:
        return spec, base
    notes = (spec.data.notes or "").strip()
    if len(notes) >= min_c:
        return spec, base
    client = _get_client()
    user = (
        "Expand data.notes only. Current StrategySpec JSON:\n"
        + spec.model_dump_json(indent=2)
        + '\n\nRespond with JSON only: {"notes": "..."}'
    )
    try:
        call = client.messages.create(
            model=settings.llm_model,
            max_tokens=768,
            system=_NOTES_ENRICH_SYSTEM,
            messages=[{"role": "user", "content": user}],
        )
        raw = _extract_text(call.content)
        if not raw:
            return spec, base
        obj = json.loads(_extract_json_from_text(raw))
        new_notes = obj.get("notes")
        if isinstance(new_notes, str) and new_notes.strip():
            new_spec = spec.model_copy(update={"data": spec.data.model_copy(update={"notes": new_notes.strip()})})
            return new_spec, base.model_copy(
                update={
                    "notes_enrichment_applied": True,
                    "notes_provenance": "llm_enriched",
                }
            )
    except Exception as e:
        logger.warning("notes enrich skipped: %s", e)
    return spec, base


def generate_strategy_spec(user_prompt: str) -> tuple[StrategySpec, StrategySpecNormalizationMeta]:
    client = _get_client()
    structured_mode: Literal["tool_use", "text_json"] = "text_json"
    raw_spec: StrategySpec | None = None
    if settings.strategy_spec_tool_use:
        try:
            call = client.messages.create(
                model=settings.llm_model,
                max_tokens=MAX_TOKENS_STRATEGY,
                system=_prompt + "\n" + STRATEGY_SCHEMA_HINT,
                tools=[get_submit_strategy_spec_tool_definition()],
                tool_choice={"type": "tool", "name": "submit_strategy_spec"},
                messages=[{"role": "user", "content": STRATEGY_BRIEF_PREFIX + user_prompt}],
            )
            raw_spec = extract_strategy_spec_from_tool_response(call)
            if raw_spec is not None:
                structured_mode = "tool_use"
        except Exception as e:
            logger.warning("strategy spec tool_use fallback to text: %s", e)
            raw_spec = None
    if raw_spec is None:
        raw_spec = _generate_strategy_spec_text_only(client, user_prompt)
    spec, norm = normalize_strategy_spec(raw_spec)
    return maybe_enrich_data_notes(spec, norm, structured_output_mode=structured_mode)


def generate_strategy_spec_stream(user_prompt: str):
    """
    Generator che yield (reasoning_chunk, None, None) per ogni chunk di testo,
    poi (None, spec, spec_normalization_meta) quando il JSON è stato parsato.
    """
    client = _get_client()
    full = ""
    yielded_len = 0
    with client.messages.stream(
        model=settings.llm_model,
        max_tokens=MAX_TOKENS_STRATEGY,
        system=_prompt_stream + "\n" + STRATEGY_SCHEMA_HINT,
        messages=[{"role": "user", "content": STRATEGY_BRIEF_PREFIX + user_prompt}],
    ) as stream:
        for text in stream.text_stream:
            full += text
            if SEP_JSON in full:
                idx = full.index(SEP_JSON)
                if idx > yielded_len:
                    yield (full[yielded_len:idx], None, None)
                break
            yield (text, None, None)
            yielded_len = len(full)
    # Estrai JSON dopo ---JSON---
    idx = full.find(SEP_JSON)
    if idx >= 0:
        json_part = full[idx + len(SEP_JSON) :].strip()
    else:
        json_part = full
    json_part = _extract_json_from_text(json_part)
    try:
        spec, norm = normalize_strategy_spec(StrategySpec.model_validate(json.loads(json_part)))
        spec, norm = maybe_enrich_data_notes(spec, norm, structured_output_mode="text_json")
        yield (None, spec, norm)
    except (json.JSONDecodeError, ValueError):
        # Fallback: chiamata non streaming per repair
        try:
            spec, norm = generate_strategy_spec(user_prompt)
            yield (None, spec, norm)
        except Exception as e:
            raise e

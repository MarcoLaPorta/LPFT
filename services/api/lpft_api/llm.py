from __future__ import annotations

import json
import re
from anthropic import Anthropic

from lpft_api.config import settings
from lpft_api.dsl import StrategySpec

_client: Anthropic | None = None

_prompt = """You are a rigorous trading strategy designer. Given a user description, output a single JSON object that conforms to StrategySpec.

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
- Use built-in kinds whenever the request fits one.
- Use python only for custom logic that cannot be expressed cleanly with the built-in kinds.
- risk supports: max_position_pct 0.01-1, max_gross_exposure 0.01-2, optional stop_loss_pct, take_profit_pct, trailing_stop_pct, fee_bps, slippage_bps.
- universe supports symbols list and timeframe 1m|5m|15m|30m|1h|1d.
- execution supports position_mode (long_only|long_short), rebalance (equal_weight|dynamic), entry_timing (next_bar_open|bar_close).
- data supports:
  - market_model (ohlcv|bid_ask|order_book|options)
  - requires_intrabar boolean
  - asset_class (auto|equity|etf|crypto)
  - provider_preference (auto|yahoo|stooq)
  - quality_policy (strict_gate|quality_labels|best_effort)
  - freshness_requirement (relaxed|standard|strict)
  - coverage_requirement (relaxed|standard|strict)
  - corporate_actions_required boolean
  - market optional string
- For python kind, params has "code" with a concise but production-quality Python snippet.
- Use confirmed user requirements whenever they are provided.
- If some details are still missing, use conservative practical defaults and record the most important assumptions in data.notes.
- Do not leave major fields ambiguous or empty.
- Prefer robust, tradable logic over clever but fragile logic.

Output ONLY the JSON object, no markdown, no explanation, no code fences."""

# Prompt per streaming: prima ragiona in italiano, poi output ---JSON--- e il JSON
_prompt_stream = """You are an expert algo trading assistant. For the user's request:
1. Think in simple English using very short status-style sentences only.
2. Each sentence must briefly describe what you are doing right now, like: "Reviewing the current logic." "Tightening the entry rules." "Preparing the new spec."
3. Keep each sentence concise, practical, and easy to show as a single live status line. Do not dump raw parameter lists unless necessary.
4. Then write exactly the line ---JSON--- and immediately after it output one valid StrategySpec JSON object with:
   - kind (sma_crossover|ema_crossover|rsi|macd|bollinger|breakout|mean_reversion|python)
   - params
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


def generate_strategy_spec(user_prompt: str) -> StrategySpec:
    schema_hint = (
        'Example: {"kind":"sma_crossover","params":{"fast":10,"slow":20,"price":"close"},'
        '"risk":{"max_position_pct":0.2,"max_gross_exposure":1.0,"fee_bps":2.0,"slippage_bps":1.0},'
        '"universe":{"symbols":["AAPL"],"timeframe":"1d"},'
        '"execution":{"position_mode":"long_only","rebalance":"equal_weight","entry_timing":"next_bar_open"},'
        '"data":{"market_model":"ohlcv","requires_intrabar":false,"asset_class":"equity","provider_preference":"auto","quality_policy":"best_effort","freshness_requirement":"standard","coverage_requirement":"standard","corporate_actions_required":true,"notes":"Assumptions are conservative and based on the confirmed user inputs."}}'
    )
    client = _get_client()
    call = client.messages.create(
        model=settings.llm_model,
        max_tokens=MAX_TOKENS_STRATEGY,
        system=_prompt + "\n" + schema_hint,
        messages=[{"role": "user", "content": user_prompt}],
    )
    raw = _extract_text(call.content)
    if not raw:
        raise ValueError("L'LLM ha restituito una risposta vuota. Riprova tra qualche secondo (possibile rate limit).")

    def _parse(s: str) -> StrategySpec:
        try:
            cleaned = _extract_json_from_text(s)
            return StrategySpec.model_validate(json.loads(cleaned))
        except json.JSONDecodeError:
            raise ValueError(
                "L'LLM non ha prodotto JSON valido. Riprova con un prompt più chiaro o tra qualche secondo."
            )

    try:
        return _parse(raw)
    except ValueError:
        pass
    repair_prompt = "Fix this to be a single valid StrategySpec JSON. Output only the JSON object, nothing else:\n" + (raw[:800] + "..." if len(raw) > 800 else raw)
    call2 = client.messages.create(
        model=settings.llm_model,
        max_tokens=MAX_TOKENS_STRATEGY,
        messages=[{"role": "user", "content": repair_prompt}],
    )
    raw2 = _extract_text(call2.content)
    if not raw2:
        raise ValueError(
            "L'LLM non ha prodotto JSON valido. Riprova con un prompt più chiaro o tra qualche secondo."
        )
    return _parse(raw2)


def generate_strategy_spec_stream(user_prompt: str):
    """
    Generator che yield (reasoning_chunk, None) per ogni chunk di testo,
    poi (None, spec) quando il JSON è stato parsato. Se reasoning_chunk è None e spec è None, errore.
    """
    client = _get_client()
    schema_hint = (
        'Esempio JSON: {"kind":"sma_crossover","params":{"fast":10,"slow":20,"price":"close"},'
        '"risk":{"max_position_pct":0.2,"max_gross_exposure":1.0,"fee_bps":2.0,"slippage_bps":1.0},'
        '"universe":{"symbols":["AAPL"],"timeframe":"1d"},'
        '"execution":{"position_mode":"long_only","rebalance":"equal_weight","entry_timing":"next_bar_open"},'
        '"data":{"market_model":"ohlcv","requires_intrabar":false,"asset_class":"equity","provider_preference":"auto","quality_policy":"best_effort","freshness_requirement":"standard","coverage_requirement":"standard","corporate_actions_required":true,"notes":"Assumptions are conservative and based on the confirmed user inputs."}}'
    )
    full = ""
    yielded_len = 0
    with client.messages.stream(
        model=settings.llm_model,
        max_tokens=MAX_TOKENS_STRATEGY,
        system=_prompt_stream + "\n" + schema_hint,
        messages=[{"role": "user", "content": user_prompt}],
    ) as stream:
        for text in stream.text_stream:
            full += text
            if SEP_JSON in full:
                idx = full.index(SEP_JSON)
                if idx > yielded_len:
                    yield (full[yielded_len:idx], None)
                break
            yield (text, None)
            yielded_len = len(full)
    # Estrai JSON dopo ---JSON---
    idx = full.find(SEP_JSON)
    if idx >= 0:
        json_part = full[idx + len(SEP_JSON) :].strip()
    else:
        json_part = full
    json_part = _extract_json_from_text(json_part)
    try:
        spec = StrategySpec.model_validate(json.loads(json_part))
        yield (None, spec)
    except (json.JSONDecodeError, ValueError):
        # Fallback: chiamata non streaming per repair
        try:
            spec = generate_strategy_spec(user_prompt)
            yield (None, spec)
        except Exception as e:
            raise e

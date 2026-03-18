from __future__ import annotations

import json
import re
from anthropic import Anthropic

from lpft_api.config import settings
from lpft_api.dsl import StrategySpec

_client: Anthropic | None = None

_prompt = """You are a trading strategy designer. Given a user description, output a single JSON object that conforms to StrategySpec: kind (sma_crossover|rsi|macd|bollinger|python), params (object per kind), risk (max_position_pct 0.01-1), universe (symbols list, timeframe 1m|5m|15m|30m|1h|1d). For python kind, params has "code" with a short Python snippet. Output ONLY the JSON object, no markdown, no explanation, no code fences."""

# Prompt per streaming: prima ragiona in italiano, poi output ---JSON--- e il JSON
_prompt_stream = """You are an expert algo trading assistant. For the user's request:
1. Think in simple English using short, clear sentences only. Keep the reasoning concise and practical. Do not dump raw parameter lists unless necessary.
2. Then write exactly the line ---JSON--- and immediately after it output one valid StrategySpec JSON object: kind (sma_crossover|rsi|macd|bollinger|python), params, risk (max_position_pct 0.01-1), universe (symbols, timeframe 1m|5m|15m|30m|1h|1d).
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
        '"risk":{"max_position_pct":0.2},"universe":{"symbols":["AAPL"],"timeframe":"1d"}}'
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
        '"risk":{"max_position_pct":0.2},"universe":{"symbols":["AAPL"],"timeframe":"1d"}}'
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

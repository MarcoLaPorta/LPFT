from __future__ import annotations

import json
from anthropic import Anthropic

from lpft_api.config import settings
from lpft_api.dsl import StrategySpec

_client: Anthropic | None = None

_prompt = """You generate Python code for a backtesting engine. The code must define a function `generate_signals(ohlcv: pd.DataFrame) -> pd.Series` that returns a Series of 1 (buy), -1 (sell), 0 (hold) aligned to ohlcv index. Use only pandas and the columns open, high, low, close, volume. Output only the Python code, no markdown or explanation."""


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


def generate_program(strategy_spec: StrategySpec) -> str:
    user_prompt = "Strategy spec (JSON): " + strategy_spec.model_dump_json()
    client = _get_client()
    call = client.messages.create(
        model=settings.llm_model,
        max_tokens=2048,
        system=_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    raw = ""
    for b in call.content:
        if getattr(b, "text", None):
            raw += b.text
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("python"):
            raw = raw[6:]
    return raw.strip()

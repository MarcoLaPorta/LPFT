from __future__ import annotations

import re
import textwrap
from anthropic import Anthropic

from lpft_api.capabilities import assess_strategy_spec
from lpft_api.config import settings
from lpft_api.dsl import StrategyKind, StrategySpec
from lpft_shared.engine import ProgramMetadata, embed_program_metadata

_client: Anthropic | None = None

_prompt = """You repair or improve custom Python code for the LPFT shared backtesting engine.
The code must define either `generate_positions(ohlcv: pd.DataFrame)` or `generate_signals(ohlcv: pd.DataFrame)`.
Supported outputs:
- a target-position Series aligned to the OHLCV index
- a dict with target_position, or entries/exits, or entries/exits plus short_entries/short_exits
- a tuple like (entries, exits) or (entries, exits, short_entries, short_exits)
Use only pandas and the OHLCV columns open, high, low, close, volume.
- Prefer `generate_positions` that returns a float target-position Series.
- Initialize numeric series with `0.0`, not `0`, to avoid pandas integer-casting failures.
- Avoid lookahead bias.
- Prefer vectorized pandas logic; use loops only when stateful trade management is truly necessary.
- Keep the code readable, conservative, and production-quality for the information available.
Output only Python code, no markdown or explanation."""
_repair_prompt = """You repair Python trading strategy code for a backtesting engine.
Return only corrected Python code.

Rules:
- The code must work with `generate_positions(ohlcv: pd.DataFrame)` or `generate_signals(ohlcv: pd.DataFrame)`
- Use only pandas and the OHLCV columns open, high, low, close, volume
- Prefer returning a float target-position Series or a dict with entries/exits
- Initialize numeric series with `0.0`, not `0`, unless the series is intentionally boolean
- Avoid lookahead bias and brittle index tricks
- Keep the code clear, robust, and directly tied to the provided strategy intent
- Do not use unsupported concepts like bid/ask spread, order book, market making, or fake inventory logic
- Do not output markdown or explanations
"""


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


def _metadata_for_spec(strategy_spec: StrategySpec, *, signal_semantics: str) -> ProgramMetadata:
    capability = assess_strategy_spec(strategy_spec)
    return ProgramMetadata(
        strategy_kind=getattr(strategy_spec.kind, "value", str(strategy_spec.kind)),
        artifact_type="python" if strategy_spec.kind == StrategyKind.python else "deterministic_python",
        position_mode=strategy_spec.execution.position_mode,
        signal_semantics=signal_semantics,
        symbols=[str(symbol).upper() for symbol in strategy_spec.universe.symbols],
        timeframe=getattr(strategy_spec.universe.timeframe, "value", str(strategy_spec.universe.timeframe)),
        max_position_pct=float(strategy_spec.risk.max_position_pct),
        max_gross_exposure=float(strategy_spec.risk.max_gross_exposure),
        stop_loss_pct=strategy_spec.risk.stop_loss_pct,
        take_profit_pct=strategy_spec.risk.take_profit_pct,
        trailing_stop_pct=strategy_spec.risk.trailing_stop_pct,
        fee_bps=float(strategy_spec.risk.fee_bps),
        slippage_bps=float(strategy_spec.risk.slippage_bps),
        rebalance_mode=strategy_spec.execution.rebalance,
        capability_status=capability.status.value,
        capability_summary=capability.summary,
        warnings=capability.warnings,
        asset_class=str(strategy_spec.data.asset_class),
        provider_preference=str(strategy_spec.data.provider_preference),
        quality_policy=str(strategy_spec.data.quality_policy),
        freshness_requirement=str(strategy_spec.data.freshness_requirement),
        coverage_requirement=str(strategy_spec.data.coverage_requirement),
        corporate_actions_required=bool(strategy_spec.data.corporate_actions_required),
        market=str(strategy_spec.data.market) if strategy_spec.data.market else None,
    )


def _infer_signal_semantics(code: str) -> str:
    lowered = code.lower()
    if "target_position" in lowered:
        return "target_position"
    if re.search(r"\breturn\s+target\b", lowered) or re.search(r"\btarget\s*=", lowered):
        return "target_position"
    if '"position"' in lowered or "'position'" in lowered or re.search(r"\bposition\s*=", lowered):
        return "target_position"
    return "legacy_events"


def _normalize_python_strategy_code(code: str, metadata: ProgramMetadata) -> str:
    cleaned = code.strip()
    if not cleaned:
        return cleaned
    metadata = ProgramMetadata.from_dict(metadata.to_dict())
    metadata.signal_semantics = _infer_signal_semantics(cleaned)
    if cleaned.startswith("# LPFT-META:"):
        return cleaned
    if "def generate_positions" in cleaned or "def generate_signals" in cleaned:
        return embed_program_metadata(cleaned, metadata)

    body = cleaned
    if body.startswith("```"):
        body = body.split("```")[1]
        if body.startswith("python"):
            body = body[6:]
        body = body.strip()

    wrapped = (
        "import pandas as pd\n"
        "pandas = pd\n\n"
        "def generate_positions(ohlcv: pd.DataFrame):\n"
        "    data = ohlcv.copy()\n"
        f"{textwrap.indent(body, '    ')}\n\n"
        "    if 'target_position' in locals():\n"
        "        return {'target_position': pd.Series(target_position, index=data.index).reindex(ohlcv.index).fillna(0)}\n"
        "    if 'signals' in locals():\n"
        "        return {'signals': pd.Series(signals, index=data.index).reindex(ohlcv.index).fillna(0)}\n"
        "    if 'position' in locals():\n"
        "        return {'target_position': pd.Series(position, index=data.index).reindex(ohlcv.index).fillna(0)}\n"
        "    raise ValueError(\"Python strategy code must define target_position, signals, or position\")\n"
    )
    return embed_program_metadata(wrapped, metadata)


def _compile_sma_like(strategy_spec: StrategySpec, *, use_ema: bool) -> str:
    params = strategy_spec.params
    price = getattr(params, "price", "close")
    fast = getattr(params, "fast")
    slow = getattr(params, "slow")
    ma_fn = "ema" if use_ema else "sma"
    metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
    long_short = strategy_spec.execution.position_mode == "long_short"
    body = f"""
import pandas as pd
pandas = pd

def generate_positions(ohlcv: pd.DataFrame) -> pd.Series:
    data = ohlcv.copy()
    fast_line = {ma_fn}(data["{price}"], {fast})
    slow_line = {ma_fn}(data["{price}"], {slow})
    target = pd.Series(0.0, index=data.index)
    long_mask = (fast_line > slow_line) & fast_line.notna() & slow_line.notna()
    target.loc[long_mask] = 1.0
"""
    if long_short:
        body += """
    short_mask = (fast_line < slow_line) & fast_line.notna() & slow_line.notna()
    target.loc[short_mask] = -1.0
"""
    body += """
    return target.fillna(0.0)
"""
    return embed_program_metadata(textwrap.dedent(body).strip(), metadata)


def _compile_rsi(strategy_spec: StrategySpec) -> str:
    params = strategy_spec.params
    price = getattr(params, "price", "close")
    period = getattr(params, "period")
    overbought = getattr(params, "overbought")
    oversold = getattr(params, "oversold")
    metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
    long_short = strategy_spec.execution.position_mode == "long_short"
    body = f"""
import pandas as pd
pandas = pd

def generate_positions(ohlcv: pd.DataFrame):
    data = ohlcv.copy()
    indicator = rsi(data["{price}"], {period})
    entries = indicator <= {oversold}
    exits = indicator >= 50
"""
    if long_short:
        body += f"""
    short_entries = indicator >= {overbought}
    short_exits = indicator <= 50
    return {{
        "entries": entries.fillna(False),
        "exits": exits.fillna(False),
        "short_entries": short_entries.fillna(False),
        "short_exits": short_exits.fillna(False),
    }}
"""
    else:
        body += """
    return {"entries": entries.fillna(False), "exits": exits.fillna(False)}
"""
    return embed_program_metadata(textwrap.dedent(body).strip(), metadata)


def _compile_macd(strategy_spec: StrategySpec) -> str:
    params = strategy_spec.params
    price = getattr(params, "price", "close")
    fast = getattr(params, "fast")
    slow = getattr(params, "slow")
    signal = getattr(params, "signal")
    metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
    long_short = strategy_spec.execution.position_mode == "long_short"
    body = f"""
import pandas as pd
pandas = pd

def generate_positions(ohlcv: pd.DataFrame) -> pd.Series:
    data = ohlcv.copy()
    macd_line, signal_line = macd(data["{price}"], {fast}, {slow}, {signal})
    target = pd.Series(0.0, index=data.index)
    long_mask = (macd_line > signal_line) & macd_line.notna() & signal_line.notna()
    target.loc[long_mask] = 1.0
"""
    if long_short:
        body += """
    short_mask = (macd_line < signal_line) & macd_line.notna() & signal_line.notna()
    target.loc[short_mask] = -1.0
"""
    body += """
    return target.fillna(0.0)
"""
    return embed_program_metadata(textwrap.dedent(body).strip(), metadata)


def _compile_bollinger(strategy_spec: StrategySpec) -> str:
    params = strategy_spec.params
    price = getattr(params, "price", "close")
    period = getattr(params, "period")
    std = getattr(params, "std")
    metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
    long_short = strategy_spec.execution.position_mode == "long_short"
    body = f"""
import pandas as pd
pandas = pd

def generate_positions(ohlcv: pd.DataFrame):
    data = ohlcv.copy()
    upper, mid, lower = bollinger_bands(data["{price}"], {period}, {std})
    entries = data["{price}"] <= lower
    exits = data["{price}"] >= mid
"""
    if long_short:
        body += f"""
    short_entries = data["{price}"] >= upper
    short_exits = data["{price}"] <= mid
    return {{
        "entries": entries.fillna(False),
        "exits": exits.fillna(False),
        "short_entries": short_entries.fillna(False),
        "short_exits": short_exits.fillna(False),
    }}
"""
    else:
        body += """
    return {"entries": entries.fillna(False), "exits": exits.fillna(False)}
"""
    return embed_program_metadata(textwrap.dedent(body).strip(), metadata)


def _compile_breakout(strategy_spec: StrategySpec) -> str:
    params = strategy_spec.params
    price = getattr(params, "price", "close")
    lookback = getattr(params, "lookback")
    exit_lookback = getattr(params, "exit_lookback", None) or max(2, lookback // 2)
    metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
    long_short = strategy_spec.execution.position_mode == "long_short"
    body = f"""
import pandas as pd
pandas = pd

def generate_positions(ohlcv: pd.DataFrame):
    data = ohlcv.copy()
    breakout_high = data["{price}"].rolling({lookback}).max().shift(1)
    breakout_low = data["{price}"].rolling({lookback}).min().shift(1)
    exit_floor = data["{price}"].rolling({exit_lookback}).min().shift(1)
    exit_ceiling = data["{price}"].rolling({exit_lookback}).max().shift(1)
    entries = data["{price}"] > breakout_high
    exits = data["{price}"] < exit_floor
"""
    if long_short:
        body += f"""
    short_entries = data["{price}"] < breakout_low
    short_exits = data["{price}"] > exit_ceiling
    return {{
        "entries": entries.fillna(False),
        "exits": exits.fillna(False),
        "short_entries": short_entries.fillna(False),
        "short_exits": short_exits.fillna(False),
    }}
"""
    else:
        body += """
    return {"entries": entries.fillna(False), "exits": exits.fillna(False)}
"""
    return embed_program_metadata(textwrap.dedent(body).strip(), metadata)


def _compile_mean_reversion(strategy_spec: StrategySpec) -> str:
    params = strategy_spec.params
    price = getattr(params, "price", "close")
    period = getattr(params, "period")
    entry_z = getattr(params, "entry_z")
    exit_z = getattr(params, "exit_z")
    metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
    long_short = strategy_spec.execution.position_mode == "long_short"
    body = f"""
import pandas as pd
pandas = pd

def generate_positions(ohlcv: pd.DataFrame):
    data = ohlcv.copy()
    mid = data["{price}"].rolling({period}).mean()
    vol = data["{price}"].rolling({period}).std()
    z = ((data["{price}"] - mid) / vol.replace(0, float("nan"))).fillna(0.0)
    entries = z <= -{entry_z}
    exits = z >= -{exit_z}
"""
    if long_short:
        body += f"""
    short_entries = z >= {entry_z}
    short_exits = z <= {exit_z}
    return {{
        "entries": entries.fillna(False),
        "exits": exits.fillna(False),
        "short_entries": short_entries.fillna(False),
        "short_exits": short_exits.fillna(False),
    }}
"""
    else:
        body += """
    return {"entries": entries.fillna(False), "exits": exits.fillna(False)}
"""
    return embed_program_metadata(textwrap.dedent(body).strip(), metadata)


def _compile_builtin_program(strategy_spec: StrategySpec) -> str:
    kind = strategy_spec.kind
    if kind == StrategyKind.sma_crossover:
        return _compile_sma_like(strategy_spec, use_ema=False)
    if kind == StrategyKind.ema_crossover:
        return _compile_sma_like(strategy_spec, use_ema=True)
    if kind == StrategyKind.rsi:
        return _compile_rsi(strategy_spec)
    if kind == StrategyKind.macd:
        return _compile_macd(strategy_spec)
    if kind == StrategyKind.bollinger:
        return _compile_bollinger(strategy_spec)
    if kind == StrategyKind.breakout:
        return _compile_breakout(strategy_spec)
    if kind == StrategyKind.mean_reversion:
        return _compile_mean_reversion(strategy_spec)
    raise ValueError(f"Unsupported deterministic compiler kind: {kind}")


def generate_program(strategy_spec: StrategySpec) -> str:
    if str(strategy_spec.kind) == "StrategyKind.python" or getattr(strategy_spec.kind, "value", None) == "python":
        code = getattr(strategy_spec.params, "code", "")
        if isinstance(code, str) and code.strip():
            metadata = _metadata_for_spec(strategy_spec, signal_semantics=_infer_signal_semantics(code))
            return _normalize_python_strategy_code(code, metadata)
        user_prompt = "Strategy spec (JSON): " + strategy_spec.model_dump_json()
        client = _get_client()
        call = client.messages.create(
            model=settings.llm_model,
            max_tokens=2048,
            system=_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = ""
        for block in call.content:
            if getattr(block, "text", None):
                raw += block.text
        metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
        return _normalize_python_strategy_code(raw.strip(), metadata)
    return _compile_builtin_program(strategy_spec)


def repair_program(strategy_spec: StrategySpec, broken_code: str, error_detail: str) -> str:
    if strategy_spec.kind != StrategyKind.python:
        return generate_program(strategy_spec)
    client = _get_client()
    user_prompt = (
        "Strategy spec (JSON): "
        + strategy_spec.model_dump_json()
        + "\n\nBroken code:\n"
        + broken_code
        + "\n\nRuntime error:\n"
        + error_detail
        + "\n\nFix the code so it runs in the target backtesting engine."
    )
    call = client.messages.create(
        model=settings.llm_model,
        max_tokens=2048,
        system=_repair_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    raw = ""
    for block in call.content:
        if getattr(block, "text", None):
            raw += block.text
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("python"):
            raw = raw[6:]
    metadata = _metadata_for_spec(strategy_spec, signal_semantics=_infer_signal_semantics(raw))
    return _normalize_python_strategy_code(raw.strip(), metadata)

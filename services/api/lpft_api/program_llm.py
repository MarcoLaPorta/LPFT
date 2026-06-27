from __future__ import annotations

import ast
import re
import textwrap
from anthropic import Anthropic

from lpft_api.capabilities import assess_strategy_spec
from lpft_api.config import settings
from lpft_api.dsl import StrategyKind, StrategySpec
from lpft_shared.engine import ProgramMetadata, ProgramSecurityError, embed_program_metadata, validate_python

LPFT_META_PREFIX = "# LPFT-META:"

_client: Anthropic | None = None


def _strip_lpft_meta_header(code: str) -> str:
    lines = code.splitlines()
    if lines and lines[0].startswith(LPFT_META_PREFIX):
        return "\n".join(lines[1:])
    return code


def _python_syntax_error_message(code: str) -> str | None:
    """None se `ast.parse` riesce sul corpo (senza riga META)."""
    body = _strip_lpft_meta_header(code)
    try:
        ast.parse(body)
    except SyntaxError as e:
        ln = e.lineno or 0
        return f"{e.msg} (line {ln})"
    return None


def _collect_python_static_issues(code: str) -> list[str]:
    issues: list[str] = []
    try:
        validate_python(code)
    except ProgramSecurityError as e:
        issues.append(f"security: {e}")
    syn = _python_syntax_error_message(code)
    if syn:
        issues.append(f"syntax: {syn}")
    return issues

PROGRAM_MAX_TOKENS = 8192

_prompt = """You write custom Python for the LPFT shared backtesting engine.

Output ONLY Python source (no markdown fences, no explanation after the code).

The server will inject `# LPFT-META: {...}` from the StrategySpec JSON you receive — do NOT add LPFT-META yourself and do not hardcode symbols/timeframe that contradict the JSON.

Required structure:
- A module-level docstring summarizing the strategy in 2–4 sentences.
- `def generate_positions(ohlcv: pd.DataFrame)` (preferred) OR `generate_signals` with the same signature rules as below.
- Use only `pandas` and columns: open, high, low, close, volume on `ohlcv`.
- Initialize every float Series with 0.0 (not integer 0) to avoid dtype traps.
- Handle warm-up: do not emit trades until indicators have enough history; use `.shift(1)` or equivalent so decisions at bar t use data available at bar close (no lookahead).
- Replace inf/NaN explicitly (e.g. after division or rolling std).
- Prefer clear, vectorized logic; comment non-obvious thresholds and windows.

Minimal pattern (adapt thresholds/windows to the spec; output real code without fences):
  import pandas as pd
  pandas = pd
  def generate_positions(ohlcv: pd.DataFrame):
      data = ohlcv.copy()
      close = data["close"]
      fast = close.rolling(20, min_periods=20).mean()
      slow = close.rolling(50, min_periods=50).mean()
      sig = (fast > slow).shift(1).fillna(False)
      target = pd.Series(0.0, index=data.index)
      target.loc[sig] = 1.0
      return target

Return shape (pick one):
- `pd.Series` of target positions in [-1, 1] or [0, 1] aligned to `ohlcv.index`, OR
- `dict` with `target_position` Series, OR legacy dict/tuple with entries/exits (booleans) if the spec truly needs event semantics.

Length: aim for **robust production code**, not a minimal snippet — typically **60–180 lines** including comments unless the strategy is trivially simple. If the StrategySpec implies multi-step logic (filters, regimes, stops), implement it explicitly.

Do not reference bid/ask, order book, or data not in OHLCV."""
_repair_prompt = """You repair or complete Python trading strategy code for LPFT backtesting.
Return only Python code (no markdown fences).

Rules:
- Must define `generate_positions(ohlcv: pd.DataFrame)` or `generate_signals` with the same constraints as production LPFT code.
- Use only pandas and OHLCV columns: open, high, low, close, volume.
- Do NOT add `# LPFT-META` (injected server-side from StrategySpec).
- If the draft is a short stub, expand it into a full implementation: docstring, comments, NaN/inf handling, warm-up bars, vectorized logic where possible.
- Initialize numeric series with 0.0; avoid lookahead; use shift(1) where decisions must use prior bar data.
- Align fee/slippage/timing semantics with the StrategySpec contract block in the user message when relevant.
- Do not output explanations outside the code.
"""


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


def _substantive_line_count(code: str) -> int:
    """Righe non vuote e non solo commento (#)."""
    n = 0
    for line in code.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        n += 1
    return n


def _spec_contract_block(strategy_spec: StrategySpec) -> str:
    """Human-readable contract so the code LLM aligns with risk/universe/execution from StrategySpec."""
    hp = getattr(strategy_spec.data, "history_period", None)
    hp_s = str(hp) if hp is not None else "(unset — engine may apply defaults)"
    notes = (strategy_spec.data.notes or "").strip()
    if len(notes) > 600:
        notes = notes[:600] + "…"
    return (
        "\n\n--- LPFT ENGINE CONTRACT (must align; # LPFT-META is injected server-side — do NOT write it) ---\n"
        f"symbols: {strategy_spec.universe.symbols}\n"
        f"bar timeframe: {getattr(strategy_spec.universe.timeframe, 'value', strategy_spec.universe.timeframe)}\n"
        f"history_period (backtest window): {hp_s}\n"
        f"entry_timing: {strategy_spec.execution.entry_timing}\n"
        f"position_mode: {strategy_spec.execution.position_mode}\n"
        f"rebalance: {strategy_spec.execution.rebalance}\n"
        f"fee_bps / slippage_bps: {strategy_spec.risk.fee_bps} / {strategy_spec.risk.slippage_bps}\n"
        f"max_position_pct / max_gross_exposure: {strategy_spec.risk.max_position_pct} / {strategy_spec.risk.max_gross_exposure}\n"
        f"data.notes (design intent): {notes or '(none)'}\n"
        "Implement generate_positions consistent with these; respect warm-up and no lookahead.\n"
    )


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
        entry_timing=str(strategy_spec.execution.entry_timing),
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


def _validate_or_repair_python(strategy_spec: StrategySpec, normalized_code: str) -> str:
    """Security (`validate_python`) + sintassi (`ast.parse`); un repair LLM se necessario."""
    issues = _collect_python_static_issues(normalized_code)
    if not issues:
        return normalized_code
    repaired = repair_program(strategy_spec, normalized_code, "\n".join(issues))
    issues2 = _collect_python_static_issues(repaired)
    if issues2:
        raise ValueError("Program validation failed after repair: " + "; ".join(issues2))
    return repaired


def check_python_program_validation(code: str) -> "PythonProgramValidation":
    """Risultato controlli statici (utile per risposta API)."""
    from lpft_api.schemas import PythonProgramValidation

    syn = _python_syntax_error_message(code)
    security_ok = True
    try:
        validate_python(code)
    except ProgramSecurityError:
        security_ok = False
    return PythonProgramValidation(ast_ok=syn is None, security_ok=security_ok)


def compile_preflight_dict(code: str) -> dict:
    """Sintesi compile statica (ast + security) prima del run_generate_signals / backtest."""
    pv = check_python_program_validation(code)
    return {
        "ast_ok": pv.ast_ok,
        "security_ok": pv.security_ok,
        "detail": None
        if pv.ast_ok and pv.security_ok
        else ("ast or security check failed — see repair path"),
    }


def generate_program(strategy_spec: StrategySpec) -> str:
    if str(strategy_spec.kind) == "StrategyKind.python" or getattr(strategy_spec.kind, "value", None) == "python":
        code = getattr(strategy_spec.params, "code", "")
        if isinstance(code, str) and code.strip():
            metadata = _metadata_for_spec(strategy_spec, signal_semantics=_infer_signal_semantics(code))
            out = _normalize_python_strategy_code(code, metadata)
            return _validate_or_repair_python(strategy_spec, out)
        user_prompt = "Strategy spec (JSON): " + strategy_spec.model_dump_json() + _spec_contract_block(strategy_spec)
        client = _get_client()
        call = client.messages.create(
            model=settings.llm_model,
            max_tokens=PROGRAM_MAX_TOKENS,
            system=_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = ""
        for block in call.content:
            if getattr(block, "text", None):
                raw += block.text
        raw = raw.strip()
        # Seconda passata se la prima risposta è troppo corta (troppo spesso accade con kind "python").
        if _substantive_line_count(raw) < 22:
            expand = client.messages.create(
                model=settings.llm_model,
                max_tokens=PROGRAM_MAX_TOKENS,
                system=_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": user_prompt
                        + "\n\nThe previous draft was too short for production. Rewrite as a FULL implementation "
                        "(typically 60+ substantive lines): docstring, comments, explicit NaN handling, warm-up period, "
                        "vectorized pandas. Replace the previous draft entirely.\n\nPrevious draft:\n"
                        + raw,
                    }
                ],
            )
            raw2 = ""
            for block in expand.content:
                if getattr(block, "text", None):
                    raw2 += block.text
            if raw2.strip():
                raw = raw2.strip()
        metadata = _metadata_for_spec(strategy_spec, signal_semantics="target_position")
        out = _normalize_python_strategy_code(raw, metadata)
        return _validate_or_repair_python(strategy_spec, out)
    return _compile_builtin_program(strategy_spec)


def repair_program(strategy_spec: StrategySpec, broken_code: str, error_detail: str) -> str:
    if strategy_spec.kind != StrategyKind.python:
        return generate_program(strategy_spec)
    client = _get_client()
    user_prompt = (
        "Strategy spec (JSON): "
        + strategy_spec.model_dump_json()
        + _spec_contract_block(strategy_spec)
        + "\n\nBroken code:\n"
        + broken_code
        + "\n\nRuntime error:\n"
        + error_detail
        + "\n\nFix the code so it runs in the target backtesting engine."
    )
    call = client.messages.create(
        model=settings.llm_model,
        max_tokens=PROGRAM_MAX_TOKENS,
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

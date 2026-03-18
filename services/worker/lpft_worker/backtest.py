from __future__ import annotations

from pathlib import Path

import pandas as pd

from lpft_worker.programs import run_generate_signals


def run_backtest(
    ohlcv: pd.DataFrame,
    program_code: str,
    output_dir: Path,
) -> dict:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        signals = run_generate_signals(program_code, ohlcv)
    except Exception as e:
        raise RuntimeError(f"generate_signals failed: {e}") from e
    if not isinstance(signals, pd.Series):
        signals = pd.Series(signals, index=ohlcv.index)
    signals = signals.reindex(ohlcv.index).fillna(0)
    close = ohlcv["close"].astype(float)
    position = 0.0
    initial_equity = 10_000.0
    equity = float(initial_equity)
    eq = [equity]
    pos_hist = [0.0]
    for i in range(1, len(ohlcv)):
        ret = close.iloc[i] / close.iloc[i - 1] - 1.0
        if signals.iloc[i - 1] > 0:
            position = 1.0
        elif signals.iloc[i - 1] < 0:
            position = 0.0
        equity *= 1.0 + position * ret
        eq.append(float(equity))
        pos_hist.append(float(position))
    equity_series = pd.Series(eq, index=ohlcv.index)
    equity_series.to_csv(output_dir / "equity.csv", header=True)
    returns = equity_series.pct_change().fillna(0.0)
    peak = equity_series.cummax()
    dd = (equity_series / peak - 1.0).fillna(0.0)
    max_drawdown = float(dd.min()) if len(dd) else 0.0

    # Trades (long-only) + CSV
    pos = pd.Series(pos_hist, index=ohlcv.index)
    entries = (pos.diff().fillna(0) > 0)
    exits = (pos.diff().fillna(0) < 0)
    entry_idx = list(entries[entries].index)
    exit_idx = list(exits[exits].index)
    n = min(len(entry_idx), len(exit_idx))
    trade_rows = []
    wins = 0
    for k in range(n):
        e_i = entry_idx[k]
        x_i = exit_idx[k]
        if x_i <= e_i:
            continue
        entry_price = float(close.loc[e_i])
        exit_price = float(close.loc[x_i])
        pnl_pct = (exit_price / entry_price) - 1.0 if entry_price != 0 else 0.0
        pnl = pnl_pct * initial_equity
        wins += 1 if pnl_pct > 0 else 0
        trade_rows.append(
            {
                "entry_time": str(e_i),
                "exit_time": str(x_i),
                "entry_price": entry_price,
                "exit_price": exit_price,
                "pnl_pct": float(pnl_pct),
                "pnl": float(pnl),
            }
        )
    pd.DataFrame(trade_rows).to_csv(output_dir / "trades.csv", index=False)

    num_trades = float(len(trade_rows))
    win_rate = float(wins / len(trade_rows)) if trade_rows else 0.0
    total_return = float(equity_series.iloc[-1] / equity_series.iloc[0] - 1.0) if len(equity_series) > 1 else 0.0
    net_pnl = float(equity_series.iloc[-1] - equity_series.iloc[0]) if len(equity_series) else 0.0
    std = float(returns.std(ddof=0)) if len(returns) else 0.0
    mean = float(returns.mean()) if len(returns) else 0.0
    sharpe = float((mean / std) * (252.0 ** 0.5)) if std > 0 else 0.0

    metrics = {
        "total_return": total_return,
        "net_pnl": net_pnl,
        "max_drawdown": max_drawdown,
        "sharpe_ratio": sharpe,
        "num_trades": num_trades,
        "win_rate": win_rate,
        "final_equity": float(equity_series.iloc[-1]) if len(equity_series) else float(initial_equity),
    }
    import json
    (output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (output_dir / "code.py").write_text(program_code)
    return metrics

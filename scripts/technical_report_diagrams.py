#!/usr/bin/env python3
"""Genera diagrammi PNG per il report PDF LPFT/AFX."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

# Palette (leggibile su stampa bianca)
C_BG = "#ffffff"
C_BOX = "#f3f4f8"
C_BOX_ACCENT = "#ede9fe"
C_BORDER = "#6b7280"
C_ACCENT = "#5b21b6"
C_TEXT = "#111827"
C_ARROW = "#4b5563"
C_DB = "#dbeafe"
C_EXT = "#fef3c7"


def _fig(w=10, h=6):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_facecolor(C_BG)
    fig.patch.set_facecolor(C_BG)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis("off")
    return fig, ax


def _box(ax, x, y, w, h, title, lines=(), accent=False):
    fc = C_BOX_ACCENT if accent else C_BOX
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.4,rounding_size=1.2",
        facecolor=fc,
        edgecolor=C_ACCENT if accent else C_BORDER,
        linewidth=1.5 if accent else 1,
    )
    ax.add_patch(patch)
    ax.text(x + w / 2, y + h - 6, title, ha="center", va="top", fontsize=10, fontweight="bold", color=C_ACCENT if accent else C_TEXT)
    ty = y + h - 14
    for line in lines:
        ax.text(x + w / 2, ty, line, ha="center", va="top", fontsize=7.5, color=C_TEXT)
        ty -= 5


def _arrow(ax, x1, y1, x2, y2, label=""):
    arr = FancyArrowPatch(
        (x1, y1),
        (x2, y2),
        arrowstyle="-|>",
        mutation_scale=12,
        color=C_ARROW,
        linewidth=1.2,
    )
    ax.add_patch(arr)
    if label:
        ax.text((x1 + x2) / 2, (y1 + y2) / 2 + 2, label, ha="center", fontsize=7, color=C_BORDER)


def diagram_system_context() -> Path:
    fig, ax = _fig(11, 7)
    ax.text(50, 96, "Fig. 1 — Contesto di sistema (vista d'insieme)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    _box(ax, 40, 82, 20, 10, "Utente / Trader", ("Wallet non-custodial", "Browser Safari/Chrome"))
    _arrow(ax, 50, 82, 50, 74)

    _box(ax, 28, 58, 44, 16, "apps/web — Next.js :3000", ("Chat fiduciaria · /exchange", "Backtest TS · Prisma AFX"), accent=True)
    _arrow(ax, 50, 58, 50, 50, "HTTPS")

    _box(ax, 4, 32, 22, 14, "Anthropic API", ("Claude", "Tool calling"))
    _box(ax, 30, 32, 22, 14, "Yahoo Finance", ("OHLCV adjClose",))
    _box(ax, 56, 32, 22, 14, "PostgreSQL", ("DB afx_dev", "Prisma ORM"), )
    _box(ax, 74, 32, 22, 14, "Redis", ("Intent bus", "Code RQ"))

    _arrow(ax, 28, 40, 18, 40)
    _arrow(ax, 42, 40, 38, 40)
    _arrow(ax, 58, 40, 62, 40)
    _arrow(ax, 68, 40, 78, 40)

    _box(ax, 28, 8, 44, 16, "services/api — FastAPI :8000", ("LPFT Python · lpft_shared", "Strategie · Backtest RQ"), accent=True)
    _arrow(ax, 50, 32, 50, 24)
    _box(ax, 4, 10, 18, 12, "PostgreSQL", ("DB lpft", "SQLModel"))
    _arrow(ax, 28, 16, 22, 16)

    out = _save(fig, "01-system-context")
    return out


def diagram_monorepo() -> Path:
    fig, ax = _fig(10, 8)
    ax.text(50, 96, "Fig. 2 — Strati del monorepo (un solo prodotto)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    layers = [
        (88, "Esperienza utente", "apps/web — React 19, App Router, Tailwind", True),
        (72, "Agente & API BFF", "/api/chat, /api/execution, /api/strategies", True),
        (56, "Dominio quant (TS)", "services/quant — event-driven-engine", False),
        (40, "Dominio exchange", "Prisma: vault, execution, RWA, RFQ", False),
        (24, "Servizio LPFT (Python)", "services/api + worker + lpft_shared", False),
        (8, "Infrastruttura", "Docker: Postgres ×2 logic, Redis, volumi", False),
    ]
    for y, title, sub, acc in layers:
        _box(ax, 8, y, 84, 12, title, (sub,), accent=acc)
    _arrow(ax, 50, 88, 50, 84)
    for y in [84, 68, 52, 36, 20]:
        _arrow(ax, 50, y, 50, y - 4)

    return _save(fig, "02-monorepo-layers")


def diagram_chat_flow() -> Path:
    fig, ax = _fig(11, 9)
    ax.text(50, 97, "Fig. 3 — Flusso chat → backtest → report (percorso principale)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    steps = [
        (82, "1. Messaggio utente", "/ + FiduciaryChat"),
        (70, "2. POST /api/chat", "streamText + tool Anthropic"),
        (58, "3. Tool quant", "buildQuantitativeStrategy"),
        (46, "4. Motore TS", "event-driven-engine + Yahoo"),
        (34, "5. Persistenza", "StrategySnapshot Prisma"),
        (22, "6. Widget inline", "metriche + grafico equity"),
        (10, "7. Report / Salva", "/analysis/[id] · /strategies"),
    ]
    for y, t, s in steps:
        _box(ax, 25, y, 50, 10, t, (s,), accent=(y == 58))
        if y > 10:
            _arrow(ax, 50, y, 50, y - 2)

    _box(ax, 78, 46, 18, 28, "Output dati", ("equity[]", "trades[]", "CAGR/Sharpe", "projections"))
    _arrow(ax, 75, 50, 78, 50, "JSON")

    return _save(fig, "03-chat-backtest-flow")


def diagram_dual_engine() -> Path:
    fig, ax = _fig(11, 7)
    ax.text(50, 96, "Fig. 4 — Due motori quant (coesistenza documentata)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    _box(ax, 4, 52, 42, 38, "Engine TS (chat)", (
        "Quando: UX / FiduciaryChat",
        "Entry: afx-chat-tools.ts",
        "Core: event-driven-engine.ts",
        "Dati: Yahoo + MarketDataBar",
        "Output: widget + snapshot",
    ), accent=True)

    _box(ax, 54, 52, 42, 38, "Engine Python (API)", (
        "Quando: :8000 / worker RQ",
        "Entry: lpft_api/main.py",
        "Core: lpft_shared/engine.py",
        "Dati: Yahoo/Alpaca",
        "Output: runs + artifacts",
    ), accent=True)

    ax.text(50, 44, "NON merge in Fase A — scelta per contesto", ha="center", fontsize=9, style="italic", color=C_BORDER)

    _box(ax, 20, 8, 60, 28, "Integrazione futura / attuale parziale", (
        "Redis intent: LPFT API → worker:intents → ExecutionLog",
        "Stesso wallet utente; DB separati (lpft vs afx_dev)",
        "docs/QUANT_ENGINES.md = regola di selezione",
    ))

    return _save(fig, "04-dual-quant-engine")


def diagram_data_topology() -> Path:
    fig, ax = _fig(11, 7)
    ax.text(50, 96, "Fig. 5 — Topologia dati e persistenza", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    _box(ax, 6, 58, 38, 30, "PostgreSQL — afx_dev", (
        "Prisma (apps/web)",
        "User, Conversation, Message",
        "StrategySnapshot, ExecutionLog",
        "SmartVault, MarketDataBar, …",
    ), accent=True)

    _box(ax, 56, 58, 38, 30, "PostgreSQL — lpft", (
        "SQLModel (services/api)",
        "Strategies, Runs",
        "Artifacts, Datasets",
    ), accent=True)

    _box(ax, 31, 22, 38, 24, "Redis :6379", (
        "Canale afx:intents:new",
        "Coda job RQ backtest",
        "LPFT_REDIS_URL condiviso",
    ))

    _arrow(ax, 25, 58, 40, 46, "intent")
    _arrow(ax, 75, 58, 60, 46, "queue")
    _box(ax, 6, 8, 88, 10, "Stesso cluster Docker (infra/docker-compose) — database logici separati", ())

    return _save(fig, "05-data-topology")


def diagram_execution_fsm() -> Path:
    fig, ax = _fig(12, 5)
    ax.text(50, 94, "Fig. 6 — Ciclo di vita ExecutionLog (esecuzione / RLFF)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    states = [
        (4, 55, "DRAFT"),
        (22, 55, "PENDING_\nSIGNATURE"),
        (44, 55, "PENDING"),
        (64, 55, "CONFIRMED"),
        (82, 55, "FAILED"),
        (44, 35, "LOGGED_\nPROPOSAL"),
        (64, 35, "CANCELLED"),
    ]
    for x, y, label in states:
        _box(ax, x, y, 16, 14, label.replace("\n", " "), ())

    _arrow(ax, 20, 62, 22, 62)
    _arrow(ax, 38, 62, 44, 62)
    _arrow(ax, 60, 62, 64, 62)
    ax.text(52, 68, "sweep / chain", fontsize=7, color=C_BORDER)
    _arrow(ax, 52, 55, 52, 49)
    ax.text(8, 48, "proposeExecution", fontsize=7, color=C_ACCENT)
    ax.text(70, 48, "npm run sweep (mock tx)", fontsize=7, color=C_ACCENT)

    _box(ax, 8, 8, 84, 18, "Campi RLFF: userPrompt, aiReasoning, pnlResult, strategyMetrics, userFeedback, promptVersion", ())

    return _save(fig, "06-execution-lifecycle")


def diagram_infra_docker() -> Path:
    fig, ax = _fig(11, 7)
    ax.text(50, 96, "Fig. 7 — Infrastruttura locale (Docker + processi host)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    _box(ax, 8, 70, 84, 20, "Host macOS — sviluppo", (
        "npm run dev → :3000  |  uvicorn → :8000  |  worker RQ  |  worker:intents",
    ), accent=True)

    _box(ax, 8, 38, 40, 26, "docker compose (infra/)", ("postgres:5432", "redis:6379"))
    _box(ax, 52, 38, 40, 26, "Processi Node/Python", ("Prisma → afx_dev", "SQLModel → lpft"))

    _arrow(ax, 28, 70, 28, 64)
    _arrow(ax, 72, 70, 72, 64)
    _arrow(ax, 28, 38, 28, 32)
    _arrow(ax, 72, 38, 72, 32)

    _box(ax, 8, 8, 84, 22, "./scripts/start-lpft.sh", (
        "Libera porte 3000/8000 · avvia Docker se possibile · API + Next",
        "AVVIO.md = runbook completo",
    ))

    return _save(fig, "07-infra-docker")


def diagram_routing() -> Path:
    fig, ax = _fig(10, 6)
    ax.text(50, 94, "Fig. 8 — Routing mercato (PRIMARY vs SECONDARY)", ha="center", fontsize=12, fontweight="bold", color=C_TEXT)

    _box(ax, 35, 72, 30, 12, "Ticker + orario", ("suggestMarketRoutingMode",))
    _arrow(ax, 50, 72, 50, 64)

    _box(ax, 8, 42, 26, 18, "PRIMARY_MINT_BURN", ("RWA in RTH", "mint/burn 1:1"))
    _box(ax, 37, 42, 26, 18, "PRIMARY_RFQ_ATOMIC", ("Fuori RTH", "RFQ atomico"))
    _box(ax, 66, 42, 26, 18, "SECONDARY_AMM", ("Crypto", "DEX whitelist"))

    _arrow(ax, 50, 64, 21, 60)
    _arrow(ax, 50, 64, 50, 60)
    _arrow(ax, 50, 64, 79, 60)

    _box(ax, 15, 8, 70, 22, "WhitelistedDexRouter in Prisma — validate router_address prima di PENDING", ())

    return _save(fig, "08-market-routing")


def _save(fig, name: str) -> Path:
    out_dir = Path(__file__).resolve().parents[1] / "docs" / "report-assets"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.png"
    fig.savefig(path, dpi=160, bbox_inches="tight", facecolor=C_BG)
    plt.close(fig)
    return path


DIAGRAMS: list[tuple[str, str, callable]] = [
    ("01-system-context", "Contesto di sistema: utente, Next.js, API Python, servizi esterni.", diagram_system_context),
    ("02-monorepo-layers", "Strati del monorepo dal UI all'infrastruttura.", diagram_monorepo),
    ("03-chat-backtest-flow", "Flusso principale dalla chat al report salvato.", diagram_chat_flow),
    ("04-dual-quant-engine", "Confronto motori TypeScript e Python.", diagram_dual_engine),
    ("05-data-topology", "Database afx_dev, lpft e Redis.", diagram_data_topology),
    ("06-execution-lifecycle", "Stati ExecutionLog e RLFF.", diagram_execution_fsm),
    ("07-infra-docker", "Deploy locale Docker + processi.", diagram_infra_docker),
    ("08-market-routing", "Decisione routing mercato primario/secondario.", diagram_routing),
]


def generate_all() -> list[tuple[Path, str]]:
    return [(fn(), caption) for _id, caption, fn in DIAGRAMS]


if __name__ == "__main__":
    for p, cap in generate_all():
        print(p, "—", cap)

#!/usr/bin/env python3
"""Genera PDF di analisi tecnica LPFT/AFX — versione estesa."""

from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / f"LPFT-AFX-Analisi-Tecnica-{date.today().isoformat()}.pdf"
FONT = "/Library/Fonts/Arial Unicode.ttf"


class ReportPDF(FPDF):
    def __init__(self) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.add_font("Body", "", FONT)
        self.add_font("Body", "B", FONT)
        self.add_font("Body", "I", FONT)
        self.set_auto_page_break(auto=True, margin=16)
        self.set_margins(16, 16, 16)

    @property
    def content_w(self) -> float:
        return self.w - self.l_margin - self.r_margin

    def write_block(self, h: float, text: str, align: str = "L") -> None:
        self.set_x(self.l_margin)
        self.multi_cell(self.content_w, h, text, align=align)

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Body", "I", 7.5)
        self.set_text_color(120, 120, 120)
        self.cell(0, 5, "LPFT / AFX — Analisi tecnica estesa", align="L")
        self.ln(6)

    def footer(self) -> None:
        self.set_y(-11)
        self.set_font("Body", "I", 7.5)
        self.set_text_color(120, 120, 120)
        self.cell(0, 7, f"Pagina {self.page_no()}/{{nb}}", align="C")

    def title_page(self, title: str, subtitle: str) -> None:
        self.add_page()
        self.set_font("Body", "B", 20)
        self.set_text_color(30, 30, 40)
        self.write_block(11, title, align="C")
        self.ln(3)
        self.set_font("Body", "", 11)
        self.set_text_color(80, 80, 90)
        self.write_block(6.5, subtitle, align="C")
        self.ln(6)
        self.set_font("Body", "I", 9)
        self.write_block(5, f"Data report: {date.today().strftime('%d %B %Y')}", align="C")
        self.write_block(5, "Versione: estesa con diagrammi d'architettura", align="C")
        self.ln(8)

    def toc_page(self, entries: list[tuple[str, str]]) -> None:
        self.add_page()
        self.h1("Indice")
        for num, title in entries:
            self.set_font("Body", "", 9.5)
            self.set_text_color(40, 40, 50)
            self.write_block(5, f"{num}  {title}")

    def h1(self, text: str) -> None:
        self.ln(3)
        self.set_font("Body", "B", 13)
        self.set_text_color(50, 40, 120)
        self.write_block(7, text)
        self.ln(1.5)

    def h2(self, text: str) -> None:
        self.ln(1.5)
        self.set_font("Body", "B", 10.5)
        self.set_text_color(40, 40, 50)
        self.write_block(6, text)
        self.ln(0.5)

    def body(self, text: str) -> None:
        self.set_font("Body", "", 9)
        self.set_text_color(30, 30, 35)
        self.write_block(4.8, text)
        self.ln(1)

    def bullet(self, text: str) -> None:
        self.set_font("Body", "", 8.8)
        self.set_text_color(30, 30, 35)
        self.write_block(4.6, f"  •  {text}")

    def mono(self, text: str) -> None:
        self.set_font("Body", "", 8)
        self.set_text_color(50, 50, 60)
        self.write_block(4.2, text)
        self.ln(1)

    def figure(self, path: Path, caption: str) -> None:
        """Inserisce diagramma PNG a tutta larghezza con didascalia."""
        if not path.exists():
            self.body(f"[Diagramma mancante: {path.name}]")
            return
        if self.get_y() > 240:
            self.add_page()
        self.ln(2)
        img_w = self.content_w
        self.image(str(path), x=self.l_margin, w=img_w)
        self.ln(2)
        self.set_font("Body", "I", 8.5)
        self.set_text_color(80, 80, 90)
        self.write_block(4.5, caption)
        self.ln(2)


TOC = [
    ("0", "Architettura visuale — diagrammi"),
    ("1", "Executive summary e visione prodotto"),
    ("2", "Architettura logica e flussi dati"),
    ("3", "Stack tecnologico dettagliato"),
    ("4", "Agente fiduciario (chat AI)"),
    ("5", "Tool chat — specifica funzionale"),
    ("6", "Motore quant TypeScript (event-driven)"),
    ("7", "Libreria lib/ (moduli applicativi)"),
    ("8", "API REST Next.js — inventario"),
    ("9", "API FastAPI Python — inventario"),
    ("10", "Schema Prisma — modelli e migrazioni"),
    ("11", "UI React — componenti principali"),
    ("12", "Metriche e interpretazione"),
    ("13", "RLFF e miglioramento modello"),
    ("14", "Exchange, routing e on-chain"),
    ("15", "Fasi di implementazione A–D"),
    ("16", "Test, qualità e debito tecnico"),
    ("17", "Operatività e troubleshooting"),
    ("18", "Variabili d'ambiente"),
    ("19", "Appendice — struttura directory"),
    ("20", "Guardrail esecuzione e routing"),
    ("21", "Motore Python lpft_shared"),
    ("22", "Script operativi"),
    ("23", "Compiler strategia quant"),
    ("24", "Stato repository Git"),
    ("25", "Glossario"),
    ("26", "Conclusioni e prossimi passi"),
]


def load_content_module():
    path = ROOT / "scripts" / "technical_report_content.py"
    spec = importlib.util.spec_from_file_location("technical_report_content", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def load_diagrams_module():
    path = ROOT / "scripts" / "technical_report_diagrams.py"
    spec = importlib.util.spec_from_file_location("technical_report_diagrams", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def build() -> Path:
    pdf = ReportPDF()
    pdf.alias_nb_pages()

    pdf.title_page(
        "LPFT / Agentic Finance Exchange",
        "Analisi tecnica completa ed estesa — stato del progetto",
    )
    pdf.toc_page(TOC)

    diagrams_mod = load_diagrams_module()
    diagrams = diagrams_mod.generate_all()

    content = load_content_module()
    content.populate(pdf, diagrams=diagrams)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    return OUT


if __name__ == "__main__":
    path = build()
    print(path)

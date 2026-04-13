#!/usr/bin/env python3
"""
Import market master-data symbols into market_symbols.

Supports:
- US / HK market directories
- Common Stock / ETF first-pass filtering
- dry-run validation without touching the database
- upsert by symbol
- inactive marking for rows omitted from the current import batch
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ALLOWED_MARKETS = {"US", "HK"}
ALLOWED_INSTRUMENT_TYPES = {"Common Stock", "ETF"}


@dataclass(frozen=True)
class NormalizedSymbolRow:
    symbol: str
    instrument_name: str
    market: str
    exchange: str
    country: str
    instrument_type: str
    aliases: list[str]
    source: str


def normalize_symbol(symbol: str, market: str) -> str:
    raw = symbol.strip().upper()
    if market == "HK":
        raw = raw.removesuffix(".HK")
        return f"{raw.zfill(4)}.HK"
    return raw


def normalize_aliases(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        alias = item.strip()
        if not alias:
            continue
        lowered = alias.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(alias)
    return normalized


def normalize_instrument_type(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if normalized in ALLOWED_INSTRUMENT_TYPES:
        return normalized

    upper = normalized.upper()
    if upper in {"COMMON STOCK", "STOCK", "EQUITY"}:
        return "Common Stock"
    if upper in {"ETF", "EXCHANGE TRADED FUND"}:
        return "ETF"
    return None


def normalize_row(row: dict[str, Any], market: str, source_name: str) -> NormalizedSymbolRow | None:
    symbol_value = row.get("symbol")
    instrument_name = row.get("instrument_name")
    exchange = row.get("exchange")
    country = row.get("country")

    if not isinstance(symbol_value, str) or not symbol_value.strip():
        return None
    if not isinstance(instrument_name, str) or not instrument_name.strip():
        return None
    if not isinstance(exchange, str) or not exchange.strip():
        return None
    if not isinstance(country, str) or not country.strip():
        return None

    instrument_type = normalize_instrument_type(row.get("instrument_type"))
    if instrument_type is None:
        return None

    symbol = normalize_symbol(symbol_value, market)
    aliases = normalize_aliases(row.get("aliases"))

    return NormalizedSymbolRow(
        symbol=symbol,
        instrument_name=instrument_name.strip(),
        market=market,
        exchange=exchange.strip(),
        country=country.strip(),
        instrument_type=instrument_type,
        aliases=aliases,
        source=source_name,
    )


def load_rows(source_file: Path) -> list[dict[str, Any]]:
    payload = json.loads(source_file.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("source file must be a JSON array")
    rows = [item for item in payload if isinstance(item, dict)]
    return rows


def normalize_rows(rows: Iterable[dict[str, Any]], market: str, source_name: str) -> list[NormalizedSymbolRow]:
    normalized: list[NormalizedSymbolRow] = []
    seen_symbols: set[str] = set()

    for row in rows:
        normalized_row = normalize_row(row, market, source_name)
        if normalized_row is None:
            continue
        if normalized_row.symbol in seen_symbols:
            continue
        seen_symbols.add(normalized_row.symbol)
        normalized.append(normalized_row)

    return normalized


def print_dry_run_summary(
    rows: list[NormalizedSymbolRow],
    market: str,
    source_name: str,
    source_file: Path,
) -> None:
    instrument_counts: dict[str, int] = {kind: 0 for kind in ALLOWED_INSTRUMENT_TYPES}
    for row in rows:
        instrument_counts[row.instrument_type] = instrument_counts.get(row.instrument_type, 0) + 1

    summary = {
        "dry_run": True,
        "market": market,
        "source": source_name,
        "source_file": str(source_file),
        "rows": len(rows),
        "instrument_types": instrument_counts,
        "sample_symbols": [row.symbol for row in rows[:10]],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def upsert_rows(db_url: str, rows: list[NormalizedSymbolRow], market: str, source_name: str) -> tuple[int, int]:
    from sqlalchemy import create_engine, text

    engine = create_engine(db_url)

    payload = [
        {
            "symbol": row.symbol,
            "instrument_name": row.instrument_name,
            "market": row.market,
            "exchange": row.exchange,
            "country": row.country,
            "instrument_type": row.instrument_type,
            "aliases": json.dumps(row.aliases, ensure_ascii=False),
            "source": row.source,
        }
        for row in rows
    ]

    with engine.begin() as connection:
        for item in payload:
            connection.execute(
                text(
                    """
                    INSERT INTO market_symbols
                        (symbol, instrument_name, market, exchange, country, instrument_type, aliases, source, is_active, updated_at)
                    VALUES
                        (:symbol, :instrument_name, :market, :exchange, :country, :instrument_type, CAST(:aliases AS jsonb), :source, TRUE, NOW())
                    ON CONFLICT (symbol) DO UPDATE SET
                        instrument_name = EXCLUDED.instrument_name,
                        market = EXCLUDED.market,
                        exchange = EXCLUDED.exchange,
                        country = EXCLUDED.country,
                        instrument_type = EXCLUDED.instrument_type,
                        aliases = EXCLUDED.aliases,
                        source = EXCLUDED.source,
                        is_active = TRUE,
                        updated_at = NOW()
                    """
                ),
                item,
            )

        imported_symbols = [row.symbol for row in rows]
        deactivated = connection.execute(
            text(
                """
                UPDATE market_symbols
                SET is_active = FALSE, updated_at = NOW()
                WHERE market = :market
                  AND source = :source
                  AND symbol <> ALL(:symbols)
                """
            ),
            {"market": market, "source": source_name, "symbols": imported_symbols or ["__none__"]},
        )

    return len(rows), deactivated.rowcount or 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import market symbols into market master data tables")
    parser.add_argument("--market", required=True, choices=sorted(ALLOWED_MARKETS), help="Target market")
    parser.add_argument("--source-file", required=True, help="Path to JSON array containing raw symbol rows")
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL", ""), help="Database URL")
    parser.add_argument("--source-name", default="import", help="Logical source label stored on imported rows")
    parser.add_argument("--dry-run", action="store_true", help="Validate and summarize rows without writing to database")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_file = Path(args.source_file)

    if not source_file.exists():
        print(f"source file not found: {source_file}", file=sys.stderr)
        return 1

    try:
        raw_rows = load_rows(source_file)
        normalized_rows = normalize_rows(raw_rows, args.market, args.source_name)
    except Exception as exc:  # noqa: BLE001
        print(f"failed to normalize source rows: {exc}", file=sys.stderr)
        return 1

    if args.dry_run:
        print_dry_run_summary(normalized_rows, args.market, args.source_name, source_file)
        return 0

    if not args.db_url.strip():
        print("db url required unless --dry-run is used", file=sys.stderr)
        return 1

    try:
        imported, deactivated = upsert_rows(args.db_url, normalized_rows, args.market, args.source_name)
    except Exception as exc:  # noqa: BLE001
        print(f"database import failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "success": True,
                "market": args.market,
                "source": args.source_name,
                "imported": imported,
                "deactivated": deactivated,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

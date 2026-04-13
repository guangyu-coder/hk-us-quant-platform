#!/usr/bin/env python3
"""
Build market movers snapshots from market_symbols and real-time quotes.

The script reads active symbols from market_symbols, fetches quotes in batches,
computes gainers and losers by change_percent, and appends ranked rows into
market_movers_snapshots.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from market_data import get_multiple_quotes  # noqa: E402

ALLOWED_MARKETS = {"US", "HK"}
ALLOWED_INSTRUMENT_TYPES = {"Common Stock", "ETF"}
BATCH_SIZE = 25


@dataclass(frozen=True)
class MarketSymbolRow:
    symbol: str
    instrument_name: str
    market: str
    exchange: str
    country: str
    instrument_type: str
    source: str


@dataclass(frozen=True)
class MoversRow:
    market: str
    instrument_type: str
    direction: str
    symbol: str
    instrument_name: str
    exchange: str
    country: str
    price: float | None
    change: float | None
    change_percent: float | None
    currency: str | None
    rank: int
    captured_at: datetime
    source: str


def normalize_market(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in ALLOWED_MARKETS:
        raise ValueError(f"unsupported market: {value}")
    return normalized


def normalize_instrument_type(value: str) -> str:
    normalized = value.strip()
    if normalized in ALLOWED_INSTRUMENT_TYPES:
        return normalized

    upper = normalized.upper()
    if upper in {"COMMON STOCK", "STOCK", "EQUITY"}:
        return "Common Stock"
    if upper in {"ETF", "EXCHANGE TRADED FUND"}:
        return "ETF"
    raise ValueError(f"unsupported instrument type: {value}")


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def load_symbols(db_url: str, market: str, instrument_type: str) -> list[MarketSymbolRow]:
    from sqlalchemy import create_engine, text

    engine = create_engine(db_url)
    query = text(
        """
        SELECT symbol, instrument_name, market, exchange, country, instrument_type, source
        FROM market_symbols
        WHERE is_active = TRUE
          AND market = :market
          AND instrument_type = :instrument_type
        ORDER BY instrument_name ASC, symbol ASC
        """
    )

    with engine.begin() as connection:
        rows = connection.execute(
            query,
            {"market": market, "instrument_type": instrument_type},
        ).mappings().all()

    return [
        MarketSymbolRow(
            symbol=str(row["symbol"]),
            instrument_name=str(row["instrument_name"]),
            market=str(row["market"]),
            exchange=str(row["exchange"]),
            country=str(row["country"]),
            instrument_type=str(row["instrument_type"]),
            source=str(row["source"]),
        )
        for row in rows
    ]


def fetch_quotes(symbols: list[str], apikey: str | None) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for batch in chunked(symbols, BATCH_SIZE):
        payload = get_multiple_quotes(batch, apikey)
        batch_results = payload.get("results", {})
        for symbol in batch:
            result = batch_results.get(symbol) or {}
            if isinstance(result, dict):
                results[symbol] = result
    return results


def quote_to_mover_row(
    symbol_row: MarketSymbolRow,
    quote: dict[str, Any],
    direction: str,
    rank: int,
    captured_at: datetime,
) -> MoversRow | None:
    data = quote.get("data", {})
    if not isinstance(data, dict):
        return None

    price = data.get("price")
    previous_close = data.get("previous_close")

    try:
        price_value = float(price)
        previous_close_value = float(previous_close)
    except (TypeError, ValueError):
        return None

    if previous_close_value <= 0:
        return None

    change = price_value - previous_close_value
    change_percent = (change / previous_close_value) * 100.0
    currency = "HKD" if symbol_row.market == "HK" else "USD"

    return MoversRow(
        market=symbol_row.market,
        instrument_type=symbol_row.instrument_type,
        direction=direction,
        symbol=symbol_row.symbol,
        instrument_name=symbol_row.instrument_name,
        exchange=symbol_row.exchange,
        country=symbol_row.country,
        price=round(price_value, 4),
        change=round(change, 4),
        change_percent=round(change_percent, 4),
        currency=currency,
        rank=rank,
        captured_at=captured_at,
        source=str(quote.get("source") or "script"),
    )


def build_snapshot_rows(
    symbols: list[MarketSymbolRow],
    quotes: dict[str, dict[str, Any]],
    limit: int,
    captured_at: datetime,
) -> list[MoversRow]:
    scored: list[tuple[MarketSymbolRow, float, dict[str, Any]]] = []

    for symbol_row in symbols:
        quote = quotes.get(symbol_row.symbol)
        if not quote or not quote.get("success", False):
            continue

        data = quote.get("data", {})
        if not isinstance(data, dict):
            continue

        try:
            price = float(data.get("price"))
            previous_close = float(data.get("previous_close"))
        except (TypeError, ValueError):
            continue

        if previous_close <= 0:
            continue

        change_percent = ((price - previous_close) / previous_close) * 100.0
        scored.append((symbol_row, change_percent, quote))

    gainers = sorted(
        scored,
        key=lambda item: (-item[1], item[0].symbol),
    )[:limit]
    losers = sorted(
        scored,
        key=lambda item: (item[1], item[0].symbol),
    )[:limit]

    rows: list[MoversRow] = []
    for rank, (symbol_row, _, quote) in enumerate(gainers, start=1):
        mover = quote_to_mover_row(symbol_row, quote, "gainers", rank, captured_at)
        if mover is not None:
            rows.append(mover)

    for rank, (symbol_row, _, quote) in enumerate(losers, start=1):
        mover = quote_to_mover_row(symbol_row, quote, "losers", rank, captured_at)
        if mover is not None:
            rows.append(mover)

    return rows


def insert_snapshot_rows(db_url: str, rows: list[MoversRow]) -> int:
    if not rows:
        return 0

    from sqlalchemy import create_engine, text

    engine = create_engine(db_url)
    statement = text(
        """
        INSERT INTO market_movers_snapshots
            (market, instrument_type, direction, symbol, instrument_name, exchange, country,
             price, change, change_percent, currency, rank, captured_at, source)
        VALUES
            (:market, :instrument_type, :direction, :symbol, :instrument_name, :exchange, :country,
             :price, :change, :change_percent, :currency, :rank, :captured_at, :source)
        """
    )

    payload = [
        {
            "market": row.market,
            "instrument_type": row.instrument_type,
            "direction": row.direction,
            "symbol": row.symbol,
            "instrument_name": row.instrument_name,
            "exchange": row.exchange,
            "country": row.country,
            "price": row.price,
            "change": row.change,
            "change_percent": row.change_percent,
            "currency": row.currency,
            "rank": row.rank,
            "captured_at": row.captured_at,
            "source": row.source,
        }
        for row in rows
    ]

    with engine.begin() as connection:
        connection.execute(statement, payload)

    return len(rows)


def print_dry_run_summary(
    market: str,
    instrument_type: str,
    limit: int,
    symbols: list[MarketSymbolRow],
    rows: list[MoversRow],
    captured_at: datetime,
) -> None:
    summary = {
        "dry_run": True,
        "market": market,
        "instrument_type": instrument_type,
        "limit": limit,
        "captured_at": captured_at.isoformat(),
        "symbols": len(symbols),
        "rows": len(rows),
        "gainers": [row.symbol for row in rows if row.direction == "gainers"],
        "losers": [row.symbol for row in rows if row.direction == "losers"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build market movers snapshots")
    parser.add_argument("--market", required=True, choices=sorted(ALLOWED_MARKETS))
    parser.add_argument("--instrument-type", required=True, choices=sorted(ALLOWED_INSTRUMENT_TYPES))
    parser.add_argument("--limit", type=int, default=20, help="Maximum gainers/losers per snapshot")
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL", ""), help="Database URL")
    parser.add_argument("--dry-run", action="store_true", help="Compute movers without writing to the database")
    parser.add_argument("--apikey", default=os.environ.get("TWELVE_DATA_API_KEY", ""), help="Optional quote API key")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    market = normalize_market(args.market)
    instrument_type = normalize_instrument_type(args.instrument_type)
    limit = max(1, args.limit)
    captured_at = datetime.now(timezone.utc)

    if not args.db_url.strip():
        print("db url required to read market_symbols", file=sys.stderr)
        return 1

    try:
        symbols = load_symbols(args.db_url, market, instrument_type)
        if not symbols and not args.dry_run:
            print(f"no active symbols found for {market} {instrument_type}", file=sys.stderr)
            return 1

        quotes = fetch_quotes([row.symbol for row in symbols], args.apikey.strip() or None)
        rows = build_snapshot_rows(symbols, quotes, limit, captured_at)
    except Exception as exc:  # noqa: BLE001
        print(f"failed to build market movers: {exc}", file=sys.stderr)
        return 1

    if args.dry_run:
        print_dry_run_summary(market, instrument_type, limit, symbols, rows, captured_at)
        return 0

    try:
        inserted = insert_snapshot_rows(args.db_url, rows)
    except Exception as exc:  # noqa: BLE001
        print(f"database write failed: {exc}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "success": True,
                "market": market,
                "instrument_type": instrument_type,
                "captured_at": captured_at.isoformat(),
                "rows": inserted,
                "gainers": len([row for row in rows if row.direction == "gainers"]),
                "losers": len([row for row in rows if row.direction == "losers"]),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_market_movers import MarketSymbolRow, build_snapshot_rows


def make_symbol(symbol: str) -> MarketSymbolRow:
    return MarketSymbolRow(
        symbol=symbol,
        instrument_name=symbol,
        market="US",
        exchange="NASDAQ",
        country="United States",
        instrument_type="Common Stock",
        source="test",
    )


def make_quote(price: float, previous_close: float) -> dict:
    return {
        "success": True,
        "source": "test",
        "data": {
            "price": price,
            "previous_close": previous_close,
        },
    }


class BuildMarketMoversTests(unittest.TestCase):
    def test_zero_limit_includes_all_successful_symbols_for_both_directions(self) -> None:
        captured_at = datetime.now(timezone.utc)
        symbols = [
            make_symbol("AAA"),
            make_symbol("BBB"),
            make_symbol("CCC"),
        ]
        quotes = {
            "AAA": make_quote(105, 100),
            "BBB": make_quote(97, 100),
            "CCC": make_quote(101, 100),
        }

        rows = build_snapshot_rows(symbols, quotes, 0, captured_at)

        self.assertEqual(len([row for row in rows if row.direction == "gainers"]), 3)
        self.assertEqual(len([row for row in rows if row.direction == "losers"]), 3)
        self.assertEqual(
            [row.symbol for row in rows if row.direction == "gainers"],
            ["AAA", "CCC", "BBB"],
        )
        self.assertEqual(
            [row.symbol for row in rows if row.direction == "losers"],
            ["BBB", "CCC", "AAA"],
        )


if __name__ == "__main__":
    unittest.main()

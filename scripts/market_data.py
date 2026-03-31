#!/usr/bin/env python3
"""
Real Market Data Provider using Twelve Data API
Twelve Data offers a generous free tier with real-time quotes
API Documentation: https://twelvedata.com/docs
"""

import sys
import os

# Suppress warnings
import warnings
warnings.filterwarnings("ignore")

# Suppress urllib3 warnings specifically
try:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    # Also suppress the specific OpenSSL warning if possible
    os.environ["PYTHONWARNINGS"] = "ignore"
except ImportError:
    pass

import requests
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry
import json
from datetime import datetime
from typing import Optional, Dict, Any

# Configure retry strategy
retry_strategy = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "OPTIONS"]
)
adapter = HTTPAdapter(max_retries=retry_strategy)
http = requests.Session()
http.mount("https://", adapter)
http.mount("http://", adapter)

# API key resolution:
# 1) --apikey CLI arg (handled in function calls)
# 2) environment variable TWELVE_DATA_API_KEY
API_KEY = os.environ.get("TWELVE_DATA_API_KEY", "").strip()
ALLOW_MOCK_FALLBACK = os.environ.get("ALLOW_MOCK_MARKET_DATA", "false").strip().lower() == "true"

BASE_URL = "https://api.twelvedata.com"

DEFAULT_LOCAL_MARKETS = [
    {"symbol": "AAPL", "instrument_name": "Apple Inc.", "aliases": ["Apple", "苹果"], "exchange": "NASDAQ", "country": "United States", "instrument_type": "Common Stock"},
    {"symbol": "AMZN", "instrument_name": "Amazon.com, Inc.", "aliases": ["Amazon", "亚马逊"], "exchange": "NASDAQ", "country": "United States", "instrument_type": "Common Stock"},
    {"symbol": "GOOGL", "instrument_name": "Alphabet Inc.", "aliases": ["Google", "Alphabet", "谷歌"], "exchange": "NASDAQ", "country": "United States", "instrument_type": "Common Stock"},
    {"symbol": "MSFT", "instrument_name": "Microsoft Corporation", "aliases": ["Microsoft", "微软"], "exchange": "NASDAQ", "country": "United States", "instrument_type": "Common Stock"},
    {"symbol": "NVDA", "instrument_name": "NVIDIA Corporation", "aliases": ["NVIDIA", "英伟达"], "exchange": "NASDAQ", "country": "United States", "instrument_type": "Common Stock"},
    {"symbol": "TSLA", "instrument_name": "Tesla, Inc.", "aliases": ["Tesla", "特斯拉"], "exchange": "NASDAQ", "country": "United States", "instrument_type": "Common Stock"},
    {"symbol": "0700.HK", "instrument_name": "Tencent Holdings Limited", "aliases": ["Tencent", "腾讯"], "exchange": "HKEX", "country": "Hong Kong", "instrument_type": "Equity"},
    {"symbol": "0941.HK", "instrument_name": "China Mobile Limited", "aliases": ["China Mobile", "中国移动"], "exchange": "HKEX", "country": "Hong Kong", "instrument_type": "Equity"},
    {"symbol": "9988.HK", "instrument_name": "Alibaba Group Holding Limited", "aliases": ["Alibaba", "阿里巴巴"], "exchange": "HKEX", "country": "Hong Kong", "instrument_type": "Equity"},
]

# Try to import yfinance, but don't fail if it's not installed or broken
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except (ImportError, Exception) as e:
    print(f"DEBUG: yfinance import failed: {e}", file=sys.stderr)
    YFINANCE_AVAILABLE = False


def generate_mock_quote(symbol: str) -> Dict[str, Any]:
    import random
    
    base_price = 200.0
    if symbol.upper() == "TSLA": base_price = 250.0
    elif symbol.upper() == "AAPL": base_price = 180.0
    elif symbol.upper() == "NVDA": base_price = 500.0
    
    # Generate somewhat realistic looking data
    price = base_price * (1 + random.uniform(-0.02, 0.02))
    
    return {
        "symbol": symbol,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "success": True,
        "source": "mock_fallback",
        "degraded": True,
        "fallback_used": True,
        "note": "Real data unavailable (API limit/IP block). Showing demo data.",
        "data": {
            "price": round(price, 2),
            "previous_close": base_price,
            "open": base_price,
            "high": round(price * 1.01, 2),
            "low": round(price * 0.99, 2),
            "volume": random.randint(1000000, 5000000)
        }
    }


def get_quote_yahoo(symbol: str) -> Dict[str, Any]:
    """
    Get real-time quote from Yahoo Finance
    """
    if not YFINANCE_AVAILABLE:
        return {"symbol": symbol, "success": False, "error": "yfinance not installed"}

    try:
        # Handling for different exchange suffixes if needed
        # Yahoo uses .HK for Hong Kong, which matches our system
        
        ticker = yf.Ticker(symbol)
        
        price = None
        prev_close = None
        open_p = None
        high = None
        low = None
        volume = None
        
        # Try fast_info first
        try:
            info = ticker.fast_info
            # Accessing these properties might trigger download/errors
            price = info.last_price
            prev_close = info.previous_close
            open_p = info.open
            high = info.day_high
            low = info.day_low
            try:
                volume = info.last_volume
            except:
                volume = 0
        except Exception:
            # fast_info failed, will try history
            pass
        
        if price is None:
             # Try fetching 1 day history as fallback
            hist = ticker.history(period="1d")
            if not hist.empty:
                price = hist["Close"].iloc[-1]
                prev_close = hist["Close"].iloc[-1] # Approximation if prev close not avail
                open_p = hist["Open"].iloc[-1]
                high = hist["High"].iloc[-1]
                low = hist["Low"].iloc[-1]
                volume = hist["Volume"].iloc[-1]
            else:
                return {"symbol": symbol, "success": False, "error": "No data found on Yahoo"}

        # Construct response matching Twelve Data format structure for compatibility
        return {
            "symbol": symbol,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "success": True,
            "source": "yahoo",
            "degraded": False,
            "fallback_used": False,
            "data": {
                "price": float(price or 0),
                "previous_close": float(prev_close or 0),
                "open": float(open_p or 0),
                "high": float(high or 0),
                "low": float(low or 0),
                "volume": int(volume or 0),
            }
        }
    except Exception as e:
        return {"symbol": symbol, "success": False, "error": f"Yahoo Error: {str(e)}"}


def get_quote_yahoo_with_fallback(symbol: str) -> Dict[str, Any]:
    """
    Get quote from Yahoo, with mock fallback if it fails
    """
    yahoo_result = get_quote_yahoo(symbol)
    if yahoo_result.get("success"):
        return yahoo_result
    if ALLOW_MOCK_FALLBACK:
        return generate_mock_quote(symbol)
    return yahoo_result


def _parse_local_market_symbols() -> list:
    """
    Build a small local universe of symbols for offline search/list fallbacks.
    """
    configured = os.environ.get("MARKET_DATA_SYMBOLS", "").strip()
    symbols = []
    seen = set()

    def add_symbol(entry: Dict[str, Any]) -> None:
        symbol = str(entry.get("symbol", "")).strip().upper()
        if not symbol or symbol in seen:
            return
        seen.add(symbol)
        symbols.append({
            "symbol": symbol,
            "instrument_name": entry.get("instrument_name", symbol),
            "aliases": entry.get("aliases", []),
            "exchange": entry.get("exchange", ""),
            "country": entry.get("country", ""),
            "instrument_type": entry.get("instrument_type", "Equity"),
        })

    for entry in DEFAULT_LOCAL_MARKETS:
        add_symbol(entry)

    if configured:
        for raw_symbol in configured.split(","):
            symbol = raw_symbol.strip().upper()
            if not symbol:
                continue
            if symbol.endswith(".HK") and symbol[:-3].isdigit():
                display_name = f"{symbol[:-3].lstrip('0') or symbol[:-3]} HK Equity"
                exchange = "HKEX"
                country = "Hong Kong"
            else:
                display_name = symbol
                exchange = "NASDAQ" if not symbol.endswith(".HK") else "HKEX"
                country = "United States" if exchange == "NASDAQ" else "Hong Kong"
            add_symbol({
                "symbol": symbol,
                "instrument_name": display_name,
                "exchange": exchange,
                "country": country,
                "instrument_type": "Equity",
            })

    return symbols


def _search_local_market_symbols(query: str) -> list:
    normalized = (query or "").strip().lower()
    if not normalized:
        return []

    candidates = _parse_local_market_symbols()
    matches = []
    seen = set()

    hk_numeric_query = normalized
    if normalized.isdigit():
        hk_numeric_query = normalized.zfill(4) + ".hk"

    for item in candidates:
        symbol = item["symbol"]
        haystack = " ".join([
            symbol,
            item.get("instrument_name", ""),
            " ".join(item.get("aliases", [])),
            item.get("exchange", ""),
            item.get("country", ""),
            item.get("instrument_type", ""),
        ]).lower()

        score = 0
        if normalized == symbol.lower():
            score = 100
        elif normalized in symbol.lower():
            score = 90
        elif normalized in haystack:
            score = 70
        elif hk_numeric_query == symbol.lower():
            score = 95
        elif hk_numeric_query in haystack:
            score = 75

        if score <= 0 or symbol in seen:
            continue

        seen.add(symbol)
        matches.append((score, item))

    matches.sort(key=lambda pair: (-pair[0], pair[1]["symbol"]))
    results = [item for _, item in matches]

    # If the query looks like a Hong Kong numeric code and nothing matched,
    # synthesize a searchable HK instrument so the frontend still has a result.
    if not results and normalized.isdigit():
        hk_symbol = f"{normalized.upper()}.HK"
        results.append({
            "symbol": hk_symbol,
            "instrument_name": f"{normalized.upper()} HK Equity",
            "aliases": [],
            "exchange": "HKEX",
            "country": "Hong Kong",
            "instrument_type": "Equity",
        })

    return results


def map_interval_to_yahoo(interval: str) -> str:
    normalized = (interval or "1day").lower()
    interval_map = {
        "1m": "1m",
        "1min": "1m",
        "5m": "5m",
        "5min": "5m",
        "15m": "15m",
        "15min": "15m",
        "30m": "30m",
        "30min": "30m",
        "1h": "60m",
        "60m": "60m",
        "1day": "1d",
        "1d": "1d",
        "day": "1d",
        "1week": "1wk",
        "1wk": "1wk",
        "1w": "1wk",
        "1month": "1mo",
        "1mo": "1mo",
    }
    return interval_map.get(normalized, "1d")


def get_historical_data_yahoo(symbol: str, interval: str = "1day", start_date: str = None, end_date: str = None) -> Dict[str, Any]:
    """
    Get historical data from Yahoo Finance.
    Works well as a fallback for HK symbols such as 0700.HK.
    """
    if not YFINANCE_AVAILABLE:
        return {"symbol": symbol, "success": False, "error": "yfinance not installed"}

    try:
        ticker = yf.Ticker(symbol)
        yahoo_interval = map_interval_to_yahoo(interval)

        history_kwargs: Dict[str, Any] = {"interval": yahoo_interval}
        if start_date:
            history_kwargs["start"] = start_date
        if end_date:
            history_kwargs["end"] = end_date
        if not start_date and not end_date:
            history_kwargs["period"] = "1mo"

        hist = ticker.history(**history_kwargs)
        if hist.empty:
            return {"symbol": symbol, "success": False, "error": "No historical data found on Yahoo"}

        processed_values = []
        for index, row in hist.iterrows():
            timestamp = index.to_pydatetime().isoformat()
            processed_values.append({
                "timestamp": timestamp,
                "open": float(row.get("Open", 0) or 0),
                "high": float(row.get("High", 0) or 0),
                "low": float(row.get("Low", 0) or 0),
                "close": float(row.get("Close", 0) or 0),
                "price": float(row.get("Close", 0) or 0),
                "volume": int(row.get("Volume", 0) or 0),
            })

        return {
            "symbol": symbol,
            "success": True,
            "source": "yahoo",
            "degraded": False,
            "fallback_used": False,
            "data": processed_values,
        }
    except Exception as e:
        if ALLOW_MOCK_FALLBACK:
            return generate_mock_history(symbol, interval, 30)
        return {"symbol": symbol, "success": False, "error": f"Yahoo history error: {str(e)}"}


def get_quote_tencent(symbol: str) -> Dict[str, Any]:
    """
    Get real-time quote from Tencent Finance (for HK/CN stocks)
    Format: http://qt.gtimg.cn/q=hk00700
    """
    try:
        # Convert symbol format: 0700.HK -> hk00700
        if symbol.endswith(".HK"):
            code = symbol.replace(".HK", "")
            # HK stocks need 5 digits (e.g. 700 -> 00700)
            code = code.zfill(5)
            qt_symbol = f"hk{code}"
        elif symbol.isdigit(): # Assume HK if just numbers, or could be CN
             # Default to HK for this context or need more logic
             qt_symbol = f"hk{symbol}"
        else:
            return {"symbol": symbol, "success": False, "error": "Invalid format for Tencent"}

        url = f"http://qt.gtimg.cn/q={qt_symbol}"
        response = requests.get(url, timeout=5)
        
        if response.status_code != 200:
             return {"symbol": symbol, "success": False, "error": f"Tencent API Error: {response.status_code}"}

        # Response encoding is GBK
        content = response.content.decode('gbk', errors='ignore')
        
        if '="' not in content:
             return {"symbol": symbol, "success": False, "error": f"Invalid response format: {content[:50]}..."}
             
        data_str = content.split('="')[1].strip('";\n')
        parts = data_str.split('~')
        
        if len(parts) < 30:
             return {"symbol": symbol, "success": False, "error": f"Insufficient data parts: {len(parts)}, Content: {data_str}"}

        # Parse fields
        price = float(parts[3])
        prev_close = float(parts[4])
        open_p = float(parts[5])
        volume = float(parts[6])
        
        # High/Low might be at 33/34, but let's double check if valid
        # If not available, use current price
        try:
            high = float(parts[33])
            low = float(parts[34])
        except (IndexError, ValueError):
            high = price
            low = price
            
        # Timestamp parsing
        ts_str = parts[30] # 2026/01/23 10:03:47
        try:
            dt = datetime.strptime(ts_str, "%Y/%m/%d %H:%M:%S")
            from datetime import timedelta
            dt_utc = dt - timedelta(hours=8)
            timestamp = dt_utc.isoformat() + "Z"
        except:
            timestamp = datetime.utcnow().isoformat() + "Z"

        return {
            "symbol": symbol,
            "timestamp": timestamp,
            "success": True,
            "source": "tencent",
            "degraded": False,
            "fallback_used": False,
            "data": {
                "price": price,
                "previous_close": prev_close,
                "open": open_p,
                "high": high,
                "low": low,
                "volume": int(volume),
            }
        }
    except Exception as e:
        return {"symbol": symbol, "success": False, "error": f"Tencent Error: {str(e)}"}


def get_quote(symbol: str, apikey: str = None) -> Dict[str, Any]:
    """
    Get real-time quote for a stock.
    Tries Twelve Data first (if Key is valid), then falls back to Yahoo Finance or Tencent (for HK).
    """
    # Special handling for HK stocks
    if symbol.endswith(".HK"):
        return get_quote_tencent(symbol)

    key = (apikey or API_KEY).strip()
    use_yahoo = False

    if not key and YFINANCE_AVAILABLE:
        use_yahoo = True
    
    if not use_yahoo:
        try:
            url = f"{BASE_URL}/quote"
            params = {
                "symbol": symbol,
                "apikey": key
            }
            
            response = http.get(url, params=params, timeout=10, verify=False)
            data = response.json()
            
            if "status" in data and data["status"] == "error":
                # If error is about plan limit or symbol not found, try Yahoo
                if YFINANCE_AVAILABLE:
                    return get_quote_yahoo_with_fallback(symbol)
                return {"symbol": symbol, "success": False, "error": data.get("message", "API Error")}
            
            # Parse the response
            return {
                "symbol": symbol,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "success": True,
                "source": "twelvedata",
                "degraded": False,
                "fallback_used": False,
                "data": {
                    "price": float(data.get("close", 0) or 0),
                    "previous_close": float(data.get("previous_close", 0) or 0),
                    "open": float(data.get("open", 0) or 0),
                    "high": float(data.get("high", 0) or 0),
                    "low": float(data.get("low", 0) or 0),
                    "volume": int(data.get("volume", 0) or 0),
                }
            }
        except Exception as e:
            # On network error, try Yahoo
            if YFINANCE_AVAILABLE:
                return get_quote_yahoo_with_fallback(symbol)
            if ALLOW_MOCK_FALLBACK:
                return generate_mock_quote(symbol)
            return {"symbol": symbol, "success": False, "error": f"Network/API Error: {str(e)}"}

    # Fallback or direct Yahoo call
    return get_quote_yahoo_with_fallback(symbol)


def get_multiple_quotes(symbols: list, apikey: str = None) -> Dict[str, Any]:
    """
    Get real-time quotes for multiple stocks
    """
    results = {}
    for sym in symbols:
        results[sym] = get_quote(sym, apikey)
        
    return {
        "symbols": symbols,
        "results": results,
        "success": True,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


def get_stock_info(symbol: str, apikey: str = None) -> Dict[str, Any]:
    """
    Get detailed stock information
    """
    # For now, just wrap get_quote or basic yahoo info
    # ... (existing profile implementation logic could be kept or improved)
    # Keeping it simple for this update
    return get_quote(symbol, apikey)


def search_symbols(query: str, apikey: str = None) -> Dict[str, Any]:
    """
    Search for symbols using Twelve Data API
    """
    key = (apikey or API_KEY).strip()
    try:
        if not key:
            local_results = _search_local_market_symbols(query)
            return {
                "success": True,
                "data": local_results,
                "source": "local_fallback",
                "note": "TWELVE_DATA_API_KEY is not configured; returning local symbol matches",
            }
        url = f"{BASE_URL}/symbol_search"
        params = {
            "symbol": query,
            "apikey": key
        }
        
        response = http.get(url, params=params, timeout=10, verify=False)
        data = response.json()
        
        if "status" in data and data["status"] == "error":
            local_results = _search_local_market_symbols(query)
            if local_results:
                return {
                    "success": True,
                    "data": local_results,
                    "source": "local_fallback",
                    "note": f"Twelve Data search unavailable: {data.get('message', 'API Error')}",
                }
            return {"success": False, "error": data.get("message", "API Error")}
            
        return {
            "success": True,
            "data": data.get("data", [])
        }
    except Exception as e:
        local_results = _search_local_market_symbols(query)
        if local_results:
            return {
                "success": True,
                "data": local_results,
                "source": "local_fallback",
                "note": f"Falling back to local symbol matches after search error: {e}",
            }
        return {"success": False, "error": str(e)}


def get_available_symbols(exchange: str = None, country: str = None, type: str = None, apikey: str = None) -> Dict[str, Any]:
    """
    Get list of available symbols from Twelve Data API
    """
    key = (apikey or API_KEY).strip()
    try:
        if not key:
            data = _parse_local_market_symbols()
            if exchange:
                data = [item for item in data if item["exchange"].lower() == exchange.strip().lower()]
            if country:
                data = [item for item in data if item["country"].lower() == country.strip().lower()]
            if type:
                data = [item for item in data if item["instrument_type"].lower() == type.strip().lower()]
            return {
                "success": True,
                "count": len(data),
                "data": data,
                "source": "local_fallback",
            }
        url = f"{BASE_URL}/stocks"
        params = {
            "apikey": key
        }
        if exchange:
            params["exchange"] = exchange
        if country:
            params["country"] = country
        if type:
            params["type"] = type
            
        response = http.get(url, params=params, timeout=30, verify=False)
        data = response.json()
        
        if "status" in data and data["status"] == "error":
            fallback_data = _parse_local_market_symbols()
            if exchange:
                fallback_data = [item for item in fallback_data if item["exchange"].lower() == exchange.strip().lower()]
            if country:
                fallback_data = [item for item in fallback_data if item["country"].lower() == country.strip().lower()]
            if type:
                fallback_data = [item for item in fallback_data if item["instrument_type"].lower() == type.strip().lower()]
            if fallback_data:
                return {
                    "success": True,
                    "count": len(fallback_data),
                    "data": fallback_data,
                    "source": "local_fallback",
                    "note": f"Twelve Data list unavailable: {data.get('message', 'API Error')}",
                }
            return {"success": False, "error": data.get("message", "API Error")}
            
        return {
            "success": True,
            "count": data.get("count", 0),
            "data": data.get("data", [])
        }
    except Exception as e:
        fallback_data = _parse_local_market_symbols()
        if exchange:
            fallback_data = [item for item in fallback_data if item["exchange"].lower() == exchange.strip().lower()]
        if country:
            fallback_data = [item for item in fallback_data if item["country"].lower() == country.strip().lower()]
        if type:
            fallback_data = [item for item in fallback_data if item["instrument_type"].lower() == type.strip().lower()]
        if fallback_data:
            return {
                "success": True,
                "count": len(fallback_data),
                "data": fallback_data,
                "source": "local_fallback",
                "note": f"Falling back to local symbol list after error: {e}",
            }
        return {"success": False, "error": str(e)}


def generate_mock_history(symbol: str, interval="1day", outputsize=30) -> Dict[str, Any]:
    import random
    from datetime import timedelta
    
    base_price = 200.0
    if symbol.upper() == "TSLA": base_price = 250.0
    elif symbol.upper() == "AAPL": base_price = 180.0
    
    data = []
    current_price = base_price
    
    # Generate past dates
    now = datetime.utcnow()
    
    for i in range(outputsize):
        date = now - timedelta(days=(outputsize - i))
        change = random.uniform(-0.02, 0.02)
        current_price = current_price * (1 + change)
        
        data.append({
            "timestamp": date.strftime("%Y-%m-%d"),
            "open": round(current_price * 0.99, 2),
            "high": round(current_price * 1.01, 2),
            "low": round(current_price * 0.98, 2),
            "close": round(current_price, 2),
            "price": round(current_price, 2),
            "volume": random.randint(1000000, 5000000)
        })
        
    return {
        "symbol": symbol,
        "success": True,
        "source": "mock_fallback",
        "degraded": True,
        "fallback_used": True,
        "data": data
    }


def get_historical_data(symbol: str, interval: str = "1day", outputsize: int = 30, start_date: str = None, end_date: str = None, apikey: str = None) -> Dict[str, Any]:
    """
    Get historical time series data
    """
    if symbol.upper().endswith(".HK"):
        yahoo_history = get_historical_data_yahoo(symbol, interval, start_date, end_date)
        if yahoo_history.get("success"):
            return yahoo_history
        if ALLOW_MOCK_FALLBACK:
            return generate_mock_history(symbol, interval, outputsize)
        return {
            "symbol": symbol,
            "success": True,
            "source": "local_fallback",
            "degraded": True,
            "fallback_used": True,
            "note": yahoo_history.get("error", "HK historical data unavailable"),
            "data": generate_mock_history(symbol, interval, outputsize)["data"],
        }

    key = (apikey or API_KEY).strip()
    try:
        if not key and YFINANCE_AVAILABLE:
            return get_historical_data_yahoo(symbol, interval, start_date, end_date)
        url = f"{BASE_URL}/time_series"
        params = {
            "symbol": symbol,
            "interval": interval,
            "apikey": key
        }
        
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        if not start_date and not end_date:
            params["outputsize"] = outputsize
        
        response = http.get(url, params=params, timeout=15, verify=False)
        data = response.json()
        
        if "status" in data and data["status"] == "error":
            yahoo_fallback = get_historical_data_yahoo(symbol, interval, start_date, end_date)
            if yahoo_fallback.get("success"):
                return yahoo_fallback
            return {"symbol": symbol, "success": False, "error": data.get("message", "API Error")}
            
        values = data.get("values", [])
        # Process values to match our internal format if needed
        # Twelve Data returns: datetime, open, high, low, close, volume
        
        processed_values = []
        for v in values:
            processed_values.append({
                "timestamp": v["datetime"], # Format is usually "2023-01-01" or "2023-01-01 00:00:00"
                "open": float(v["open"]),
                "high": float(v["high"]),
                "low": float(v["low"]),
                "close": float(v["close"]),
                "price": float(v["close"]), # Map close to price for consistency
                "volume": int(v["volume"])
            })
            
        return {
            "symbol": symbol,
            "success": True,
            "meta": data.get("meta", {}),
            "source": "twelvedata",
            "degraded": False,
            "fallback_used": False,
            "data": processed_values
        }
    except Exception as e:
        yahoo_fallback = get_historical_data_yahoo(symbol, interval, start_date, end_date)
        if yahoo_fallback.get("success"):
            return yahoo_fallback
        if ALLOW_MOCK_FALLBACK:
            return generate_mock_history(symbol, interval, outputsize)
        return {
            "symbol": symbol,
            "success": True,
            "source": "local_fallback",
            "degraded": True,
            "fallback_used": True,
            "note": str(e),
            "data": generate_mock_history(symbol, interval, outputsize)["data"],
        }


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Real Market Data Provider")
    parser.add_argument("--symbol", type=str, help="Single stock symbol (e.g., AAPL, 0700.HK)")
    parser.add_argument("--symbols", type=str, help="Comma-separated stock symbols")
    parser.add_argument("--search", type=str, help="Search for stock symbols by name or ticker")
    parser.add_argument("--history", action="store_true", help="Get historical data")
    parser.add_argument("--interval", type=str, default="1day", help="Interval for historical data (e.g. 1day, 1h, 1week)")
    parser.add_argument("--outputsize", type=int, default=30, help="Number of data points")
    parser.add_argument("--start", type=str, help="Start date (e.g. 2023-01-01)")
    parser.add_argument("--end", type=str, help="End date (e.g. 2023-01-31)")
    parser.add_argument("--list-market", action="store_true", help="List available symbols (optionally filtered by exchange/country/type)")
    parser.add_argument("--exchange", type=str, help="Filter by exchange (e.g., NASDAQ, NYSE)")
    parser.add_argument("--country", type=str, help="Filter by country (e.g., United States)")
    parser.add_argument("--type", type=str, help="Filter by type (e.g., Common Stock, ETF)")
    parser.add_argument("--apikey", type=str, help="Twelve Data API key (optional)")
    
    args = parser.parse_args()
    
    try:
        if args.symbol and args.history:
            result = get_historical_data(args.symbol, args.interval, args.outputsize, args.start, args.end, args.apikey)
            print(json.dumps(result, indent=2))
        elif args.symbol:
            result = get_quote(args.symbol, args.apikey)
            print(json.dumps(result, indent=2))
        elif args.symbols:
            symbol_list = [s.strip() for s in args.symbols.split(",")]
            result = get_multiple_quotes(symbol_list, args.apikey)
            print(json.dumps(result, indent=2))
        elif args.search:
            result = search_symbols(args.search, args.apikey)
            print(json.dumps(result, indent=2))
        elif args.list_market:
            result = get_available_symbols(args.exchange, args.country, args.type, args.apikey)
            print(json.dumps(result, indent=2))
        else:
            # Default: return data for popular stocks
            print("No arguments provided. Fetching popular stocks...", file=sys.stderr)
            popular_stocks = [
                "AAPL",      # Apple
                "NVDA",      # Nvidia
                "0700.HK",   # Tencent
                "9988.HK",   # Alibaba
            ]
            result = get_multiple_quotes(popular_stocks, args.apikey)
            print(json.dumps(result, indent=2))
    except Exception as e:
        # Catch any unhandled exceptions to prevent 500 errors in backend
        error_response = {
            "success": False,
            "error": f"Unhandled script error: {str(e)}",
            "type": "unhandled_exception"
        }
        print(json.dumps(error_response, indent=2))

"""Fetches ETF holdings from etf.com.

etf.com sits behind Cloudflare, which rejects ordinary HTTP clients (Node, plain curl)
on their TLS fingerprint with a 403 regardless of headers. curl_cffi impersonates a real
browser's TLS handshake, which is the whole reason this service exists as a separate
process instead of living in the Node backend.
"""

from typing import Any, Dict, List, Optional

from curl_cffi import requests

API_URL = "https://api-prod.etf.com/v2/fund/fund-details"
IMPERSONATE = "chrome"
TIMEOUT_SECONDS = 30

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
}


def fetch_holdings(symbol: str) -> Dict[str, Any]:
    """Return {status, rows, asOf, error} for a ticker.

    status is one of:
      "etf"     - holdings were returned
      "not-etf" - the provider knows the ticker and it is not a fund
      "error"   - the request or the response could not be handled
    """
    payload = {
        "query": "topHoldings",
        "variables": {"ticker": symbol.upper(), "fund_isin": ""},
    }

    try:
        response = requests.post(
            API_URL,
            json=payload,
            headers=HEADERS,
            impersonate=IMPERSONATE,
            timeout=TIMEOUT_SECONDS,
        )
    except Exception as exc:  # network, TLS, timeout
        return _error(f"request_failed: {type(exc).__name__}")

    if response.status_code != 200:
        return _error(f"http_{response.status_code}")

    try:
        data = response.json()
    except Exception:
        return _error("invalid_json")

    if not isinstance(data, dict):
        return _error("unexpected_response")

    sections = (data.get("data") or {}).get("topHoldings")

    # The provider answers with topHoldings: null for anything that is not a fund
    if sections is None:
        return {"status": "not-etf", "rows": [], "asOf": None}

    rows = _extract_rows(sections)

    if rows is None:
        return _error("holdings_section_missing")

    return {
        "status": "etf",
        "rows": rows,
        "asOf": _as_of(rows),
    }


def _extract_rows(sections: Any) -> Optional[List[Dict[str, Any]]]:
    """Holdings live in the "all_holdings" entry of the topHoldings payload."""
    if not isinstance(sections, dict) or not isinstance(sections.get("data"), list):
        return None

    for section in sections["data"]:
        if isinstance(section, dict) and section.get("name") == "all_holdings":
            rows = section.get("data")
            if isinstance(rows, list):
                # Pass through only the fields the backend uses
                return [
                    {
                        "symbol": row.get("symbol"),
                        "name": row.get("name"),
                        "weight": row.get("weight"),
                        "asOf": row.get("asOf"),
                    }
                    for row in rows
                    if isinstance(row, dict)
                ]
            return None

    return None


def _as_of(rows: List[Dict[str, Any]]) -> Optional[str]:
    """Every row carries the same as-of date; take it from the first one that has it."""
    for row in rows:
        as_of = row.get("asOf")
        if isinstance(as_of, str) and as_of:
            return as_of[:10]
    return None


def _error(reason: str) -> Dict[str, Any]:
    return {"status": "error", "rows": [], "asOf": None, "error": reason}

"""Fetches ETF holdings and fund profiles from etf.com.

etf.com sits behind Cloudflare, which rejects ordinary HTTP clients (Node, plain curl)
on their TLS fingerprint with a 403 regardless of headers. curl_cffi impersonates a real
browser's TLS handshake, which is the whole reason this service exists as a separate
process instead of living in the Node backend.
"""

from typing import Any, Dict, List, Optional, Tuple

from curl_cffi import requests

API_URL = "https://api-prod.etf.com/v2/fund/fund-details"
IMPERSONATE = "chrome"
TIMEOUT_SECONDS = 30

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# Profile section -> the etf.com query that returns it. One request each; the `all`
# query bundles them but also carries every holding, which is megabytes for VT.
PROFILE_QUERIES = {
    "overview": "overviewPage",
    "sectors": "sectorIndustryBreakdown",
    "countries": "countries",
    "regions": "regions",
    "marketCap": "fundMarketcap",
    "portfolio": "fundPortfolioData",
}


def fetch_holdings(symbol: str) -> Dict[str, Any]:
    """Return {status, rows, asOf, error} for a ticker.

    status is one of:
      "etf"     - holdings were returned
      "not-etf" - the provider knows the ticker and it is not a fund
      "error"   - the request or the response could not be handled
    """
    sections, error = _query("topHoldings", symbol)

    if error:
        return _holdings_error(error)

    # The provider answers with topHoldings: null for anything that is not a fund
    if sections is None:
        return {"status": "not-etf", "rows": [], "asOf": None}

    rows = _extract_rows(sections)

    if rows is None:
        return _holdings_error("holdings_section_missing")

    return {
        "status": "etf",
        "rows": rows,
        "asOf": _as_of(rows),
    }


def fetch_profile(symbol: str) -> Dict[str, Any]:
    """Return {status, sections, errors} describing a fund as a whole.

    sections holds the provider's own rows, unparsed (weights and values arrive as
    strings like "24.71%", "$1404.32B" or "None%"; the backend interprets them):
      summary, portfolio, competitors - [{name, label, value}] / provider rows
      sectors, countries, regions     - [{name, weight}]
      marketCap                       - [{name, value}]
      growth                          - [{navDate, tenkValue}], growth of $10k

    A section that fails is left out and its reason recorded in `errors`, so one bad
    request costs that section rather than the whole profile.
    """
    raw: Dict[str, Any] = {}
    errors: Dict[str, str] = {}

    for key, query in PROFILE_QUERIES.items():
        section, error = _query(query, symbol)
        if error:
            errors[key] = error
        else:
            raw[key] = section

    if not raw:
        return {"status": "error", "sections": {}, "errors": errors, "error": "all_requests_failed"}

    overview = raw.get("overview") or {}

    # Every section is null for anything that is not a fund
    if "overview" in raw and overview.get("fundSummaryData") is None:
        return {"status": "not-etf", "sections": {}, "errors": errors}

    sections = {
        "summary": _fields(overview.get("fundSummaryData")),
        "portfolio": _fields(raw.get("portfolio")),
        "sectors": _fields(raw.get("sectors")),
        "countries": _fields(raw.get("countries")),
        "regions": _fields(raw.get("regions")),
        "marketCap": _fields(raw.get("marketCap")),
        "growth": (overview.get("growthData") or {}).get("data") or [],
        "competitors": _fields(overview.get("fundCompetingData")),
    }

    return {"status": "etf", "sections": sections, "errors": errors}


def _query(query: str, symbol: str) -> Tuple[Any, Optional[str]]:
    """POST one query; return (data[query], None) or (None, reason)."""
    payload = {
        "query": query,
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
        return None, f"request_failed: {type(exc).__name__}"

    if response.status_code != 200:
        return None, f"http_{response.status_code}"

    try:
        data = response.json()
    except Exception:
        return None, "invalid_json"

    if not isinstance(data, dict):
        return None, "unexpected_response"

    return (data.get("data") or {}).get(query), None


def _fields(section: Any) -> List[Any]:
    """Most sections wrap their rows as {name, label, fields: [...]}."""
    if isinstance(section, dict) and isinstance(section.get("fields"), list):
        return section["fields"]
    return []


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


def _holdings_error(reason: str) -> Dict[str, Any]:
    return {"status": "error", "rows": [], "asOf": None, "error": reason}

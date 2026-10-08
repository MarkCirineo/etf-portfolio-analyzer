"""Whether etf.com answers from this machine. The holdings service depends on it, and
Cloudflare sometimes blocks data-centre addresses. Run (needs only Docker):

    docker run --rm -i python:3.12-slim sh -c "pip install -q curl_cffi && python -" < deploy/check-etf-com.py
"""

from curl_cffi import requests

response = requests.post(
    "https://api-prod.etf.com/v2/fund/fund-details",
    json={"query": "topHoldings", "variables": {"ticker": "VXUS", "fund_isin": ""}},
    impersonate="chrome",
    timeout=30,
)
rows = response.text.count('"symbol"') if response.status_code == 200 else 0

print(f"HTTP {response.status_code}, {rows} holdings")
print("PASS: etf.com works from here" if rows > 1000 else "FAIL: etf.com is blocking this machine")

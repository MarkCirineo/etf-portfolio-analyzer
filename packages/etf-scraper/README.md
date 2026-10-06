# ETF Holdings Service

Fetches ETF holdings from etf.com for the Node backend.

## Why this is a separate process

etf.com's API is behind Cloudflare, which blocks clients by TLS fingerprint. Node (and
plain `curl` on Linux) get a `403 Sorry, you have been blocked` no matter what headers they
send. [`curl_cffi`](https://github.com/lexiforest/curl_cffi) impersonates a real browser's
TLS handshake, so this small Python service does the fetching and the backend calls it over
localhost.

The payoff is complete data: for VXUS, etf.com returns 8,745 rows covering 94% of the fund,
where Alpha Vantage (the backend's fallback) returns 37 rows covering 5%, because it only
reports positions with a US-listed ticker.

## Setup

```bash
python -m venv venv
venv/Scripts/activate      # Windows
source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

Optional `.env` in this directory:

```env
PORT=3101
HOST=127.0.0.1
```

## Running

```bash
python app.py
```

`yarn dev` from the repo root starts this alongside the backend and frontend. The backend
finds it at `etf_scraper_url` in its config and falls back to Alpha Vantage when it is not
reachable.

## API

### `GET /etf-holdings/{symbol}`

```json
{
    "status": "etf",
    "asOf": "2026-08-31",
    "rows": [{ "symbol": "2330", "name": "Taiwan Semiconductor...", "weight": "3.94%" }]
}
```

`status` is `etf`, `not-etf` (the ticker is not a fund), or `error` (with an `error` field).
Always returns HTTP 200 so the backend can tell a provider problem from a transport one.
Symbols are as the fund reports them, which for foreign listings means a local exchange
ticker (`2330`, `005930`) rather than a US symbol.

### `GET /health`

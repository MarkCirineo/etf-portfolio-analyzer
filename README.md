# ETF Portfolio Analyzer

Enter the ETFs and stocks you hold, with share counts, and see what you actually own: every
underlying security by dollar exposure and percent of portfolio, plus an estimated share
count of each (e.g. how many shares of Apple you own through VTI and SPY).

## How it works

-   **Holdings** for each ETF come from etf.com, fetched by the small Python service in
    `packages/etf-scraper` (see its README for why it is a separate process), refreshed daily
    and cached in Redis for up to a month. Alpha Vantage's `ETF_PROFILE` is the fallback when
    that service is not running; it only reports positions with a US-listed ticker, so
    international funds come back badly incomplete (VXUS: 5% of the fund versus 94%).
-   **Prices** come from Finnhub and are cached in Redis. While the market is open a price is
    refreshed after 30 minutes; after the close it is kept until the next open (NYSE holidays
    included). Stale prices are served while a refresh is queued, never dropped.
-   **Exposure** to a security = Σ over ETFs of `shares × ETF price × weight` plus any direct
    position. This only needs the prices of what you entered, so it is available within
    seconds. **Share count** = exposure ÷ the security's own price, which fills in as quotes
    arrive.
-   Finnhub's free tier allows 60 quotes a minute, so the queue is paced at ~54/min and only
    the 300 largest positions by exposure are priced, largest first. Everything else still
    shows exposure and percent, just no share count. Positions a fund reports under a foreign
    exchange ticker (`2330` for TSMC) are never quoted, since Finnhub cannot resolve them.
-   The list page subscribes over Socket.IO and re-renders as prices land.

Whatever the holdings data does not account for is reported as its own "not covered" figure,
broken down per fund — never folded into cash. Other limits: weights are published to two
decimals, holdings are typically a few weeks old (each fund's as-of date is shown), and a
leveraged fund reports what it physically holds (cash and swaps), not its multiplied index
exposure.

## Packages

| Package                | Stack                                                    |
| ---------------------- | -------------------------------------------------------- |
| `packages/backend`     | Express, TypeScript, Postgres (Kysely), Redis, Socket.IO |
| `packages/frontend`    | SvelteKit 5, Tailwind                                    |
| `packages/etf-scraper` | Python, FastAPI, curl_cffi — fetches ETF holdings        |

## Setup

Requirements: Node 20+, Yarn 1, Python 3.9+, Postgres, Redis, a
[Finnhub](https://finnhub.io) API key and an [Alpha Vantage](https://www.alphavantage.co) API
key (free tiers work).

```bash
yarn install
cd packages/backend && yarn install
cd ../frontend && yarn install
cd ../etf-scraper && python -m venv venv && venv/Scripts/activate && pip install -r requirements.txt
```

Copy `packages/backend/src/example.config.ts` to `packages/backend/src/config.ts` and fill
in the keys, database and Redis connection, and the frontend origin (`http://localhost:5173`
in development). Tables are created on first start.

The frontend reads the API base URL from `packages/frontend/.env` (`VITE_API_URL`).

## Running

```bash
yarn dev             # all three together
yarn backend:dev     # backend only (builds with rollup, restarts on changes)
yarn frontend:dev    # frontend only (Vite on :5173)
yarn etf-scraper:dev # holdings service only (:3101)
```

`yarn etf-scraper:dev` runs `python app.py`, so activate that package's virtualenv first (or
point `python` at it).

Native modules in `packages/backend/node_modules` are built for the platform that ran
`yarn install`, so run the backend on the same platform (e.g. inside WSL if that is where
you installed and where Postgres/Redis live).

## Checks

```bash
cd packages/backend && yarn build:tsc && yarn lint
cd packages/frontend && yarn check && yarn lint
```

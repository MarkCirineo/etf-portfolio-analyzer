# ETF Portfolio Analyzer

See what you actually own. Add your brokerage accounts and the ETFs and stocks in each, and
the app looks through every fund to the thousands of companies underneath: how much of each
you own in dollars, as a share of your portfolio, and as an estimated share count (how many
shares of Apple you hold through VTI, QQQ and your own position, combined).

## Features

-   **Accounts.** A portfolio is one or more accounts (Roth IRA, taxable, 401(k), HSA…), each
    with its own holdings. Everything is combined by default; the account switcher narrows
    the whole dashboard to one account or one account type.
-   **Dashboard.** Value and today's change, fund fees, estimated income, a treemap of the
    largest holdings, GICS sectors, regions and countries, company size and valuation, a
    growth-of-$10k backtest of the current mix, fund overlap, and a searchable explorer of
    every underlying holding.
-   **Drill-down.** For any holding: which funds and which accounts it comes through, and how
    its share count is worked out.
-   **Scenarios.** What-if lists analysed the same way, comparable side by side with the main
    portfolio.

## Where the data comes from

| Data                           | Source                                                                                 | Cached            |
| ------------------------------ | -------------------------------------------------------------------------------------- | ----------------- |
| ETF holdings and fund profiles | etf.com, through `packages/etf-scraper` (Alpha Vantage as a US-only fallback)          | refreshed daily   |
| Prices                         | Finnhub                                                                                | 30 min while open |
| GICS sectors                   | holdings of Vanguard's US and iShares' global sector funds, matched company by company | refreshed weekly  |
| Which tickers are US listings  | the SEC's ticker list                                                                  | refreshed weekly  |
| Ticker search                  | Nasdaq's daily directory of US listings                                                | refreshed daily   |

Everything is cached in Redis. Exposure to a company is `shares × ETF price × weight`, summed
over your funds plus any direct position, so it only needs the prices of what you entered.
Share counts divide that by the company's own price; Finnhub's free tier allows 60 quotes a
minute, so only the 300 largest positions are priced, largest first, and the page updates
over Socket.IO as prices arrive.

**Limits worth knowing.** Holdings are usually a few weeks old (each fund's date is shown).
Companies listed only abroad (`2330` for TSMC) have exposure but no share count. Tickers
repeat across exchanges, so holdings are matched by ticker and name, and only companies the
SEC lists under that ticker are priced. GICS sectors cover nearly all US stocks but about two
thirds of a broad international fund; the rest is shown as unclassified. Whatever a fund's
data does not account for is reported as "not covered", never folded into cash.

## Packages

| Package                | Stack                                                    |
| ---------------------- | -------------------------------------------------------- |
| `packages/backend`     | Express, TypeScript, Postgres (Kysely), Redis, Socket.IO |
| `packages/frontend`    | SvelteKit 5, Tailwind                                    |
| `packages/etf-scraper` | Python, FastAPI, curl_cffi (see its README for why)      |

## Development

Requirements: Node 20+, Yarn 1, Python 3.9+, Postgres, Redis, and free
[Finnhub](https://finnhub.io) and [Alpha Vantage](https://www.alphavantage.co) API keys.

```bash
yarn install
cd packages/backend && yarn install
cd ../frontend && yarn install
cd ../etf-scraper && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

1. Copy `packages/backend/src/example.config.ts` to `config.ts` beside it and fill in the API
   keys, Postgres, Redis, a JWT secret, and the frontend origin (`http://localhost:5173`).
2. Set `VITE_API_URL` in `packages/frontend/.env` (`http://localhost:3100/api` for a backend on
   port 3100).

Tables are created, and migrations run, when the backend starts.

```bash
yarn dev             # all three together
yarn backend:dev     # backend only, rebuilt and restarted on changes
yarn frontend:dev    # frontend only, Vite on :5173
yarn etf-scraper:dev # holdings service only, :3101 (activate its virtualenv first)
```

Native modules are built for the platform that ran `yarn install`, so run the backend where
you installed it (inside WSL, for example, if Postgres and Redis live there).

## Checks

```bash
cd packages/backend && yarn build:tsc && yarn lint
cd packages/frontend && yarn check && yarn lint
```

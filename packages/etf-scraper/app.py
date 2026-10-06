"""HTTP wrapper around the etf.com holdings fetcher.

Exists as a separate process because fetching etf.com needs a browser TLS fingerprint
(see etf_com.py); the Node backend calls this over localhost and caches the result.
"""

from fastapi import FastAPI
from pydantic_settings import BaseSettings

from etf_com import fetch_holdings, fetch_profile


class Settings(BaseSettings):
    """Loaded from the environment or a .env file in this directory."""

    port: int = 3101
    host: str = "127.0.0.1"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

app = FastAPI(title="ETF Holdings Service")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "etf-scraper"}


# Plain `def` routes: the fetches block, and FastAPI runs sync routes in a thread pool,
# so one slow request does not stall the others the way a blocking `async def` would.


@app.get("/etf-holdings/{symbol}")
def get_holdings(symbol: str):
    """Holdings for a ticker.

    Always answers 200; the caller decides what to do with a status of "error", so a
    failure here never looks like a transport problem to the backend.
    """
    cleaned = symbol.strip().upper()

    if not cleaned:
        return {"status": "error", "rows": [], "asOf": None, "error": "symbol_required"}

    return fetch_holdings(cleaned)


@app.get("/etf-profile/{symbol}")
def get_profile(symbol: str):
    """Fund-level data: sectors, countries, regions, market-cap split, expense ratio,
    yield and valuation, growth-of-$10k history, and similar funds. Always answers 200.
    """
    cleaned = symbol.strip().upper()

    if not cleaned:
        return {"status": "error", "sections": {}, "errors": {}, "error": "symbol_required"}

    return fetch_profile(cleaned)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)

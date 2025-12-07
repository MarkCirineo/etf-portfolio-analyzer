"""
FastAPI server for ETF holdings scraping service.
"""
from typing import List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings
from etf_scraper import get_etf_holdings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    port: int = 8000
    host: str = "127.0.0.1"
    # CORS allowed origins (comma-separated, or "*" for all)
    # Default allows localhost for development
    allowed_origins: str = "http://localhost:3000,http://localhost:5173"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
    
    def get_allowed_origins(self) -> List[str]:
        """Parse allowed_origins string into a list."""
        if self.allowed_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


settings = Settings()

app = FastAPI(title="ETF Scraper Service")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "etf-scraper"}


@app.get("/etf-holdings/{symbol}")
async def get_holdings(symbol: str):
    """
    Get ETF holdings for a given symbol.
    
    Args:
        symbol: ETF ticker symbol (e.g., 'SPY')
        
    Returns:
        JSON response with holdings array and failed status.
        Format: {
            'holdings': [{'symbol': str, 'weight': float, 'name': str}, ...],
            'failed': bool,
            'error': str (optional)
        }
        Where 'weight' is a percentage value (0-100) and 'name' is the company/holding name.
        The 'error' field is optional and only present when 'failed' is True or a partial
        failure occurs. It contains a human-readable error message explaining why the request
        failed (e.g., 'timeout_error', 'gateway_error', 'parse_error', 'transport_error',
        'upstream_request_failed').
        
    Raises:
        HTTPException: 400 if symbol is invalid, 5xx for upstream/parse errors
    """
    if not symbol or not symbol.strip():
        raise HTTPException(status_code=400, detail="Symbol is required")
    
    result = get_etf_holdings(symbol.strip().upper())
    
    if result.get("failed") is True and result.get("error"):
        error_type = result.get("error")
        
        if error_type == "timeout_error":
            raise HTTPException(
                status_code=504,
                detail="Service timeout while fetching ETF holdings"
            )
        elif error_type == "gateway_error":
            raise HTTPException(
                status_code=502,
                detail="Gateway error while fetching ETF holdings"
            )
        else:
            # Generic transport/parse failures
            raise HTTPException(
                status_code=500,
                detail="Failed to fetch or parse ETF holdings"
            )
    
    # Return 200 for valid holdings or legitimate "no holdings" business case
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)


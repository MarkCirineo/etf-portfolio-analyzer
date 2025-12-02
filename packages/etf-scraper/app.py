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
    host: str = "0.0.0.0"
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
            'failed': bool
        }
        Where 'weight' is a percentage value (0-100) and 'name' is the company/holding name.
    """
    if not symbol or not symbol.strip():
        raise HTTPException(status_code=400, detail="Symbol is required")
    
    result = get_etf_holdings(symbol.strip().upper())
    
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)


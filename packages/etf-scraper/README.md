# ETF Scraper Service

Python microservice that scrapes ETF holdings data from etf.com.

## Requirements

-   **Python 3.7+** (works with any modern Python version, including 3.14+)

## Setup

1. Create a virtual environment:

```bash
python -m venv venv
```

2. Activate the virtual environment:

-   Windows: `venv\Scripts\activate`
-   macOS/Linux: `source venv/bin/activate`

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Configure environment variables (optional):
   Create a `.env` file in this directory:

```env
PORT=8000
HOST=0.0.0.0
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

-   `PORT`: Server port (default: 8000)
-   `HOST`: Server host (default: 0.0.0.0)
-   `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins, or "\*" for all (default: localhost origins)

## Running

Start the service:

```bash
python app.py
```

Or using uvicorn directly:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

The service will run on `http://localhost:8000`

## API Endpoints

### GET `/etf-holdings/{symbol}`

Fetches ETF holdings for a given ticker symbol.

**Example:**

```bash
curl http://localhost:8000/etf-holdings/SPY
```

**Response:**

```json
{
    "holdings": [
        { "symbol": "AAPL", "weight": 7.2, "name": "Apple Inc." },
        { "symbol": "MSFT", "weight": 6.8, "name": "Microsoft Corporation" }
    ],
    "failed": false
}
```

## Integration

This service is called by the Node.js backend to replace AlphaVantage API calls for ETF holdings data.

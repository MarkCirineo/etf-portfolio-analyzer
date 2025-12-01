"""
ETF Scraper module that fetches ETF holdings data from etf.com API.
"""
from typing import List, Dict, Optional
import cloudscraper
import json


def get_etf_holdings(symbol: str) -> Dict[str, any]:
    """
    Fetch ETF holdings from etf.com API.
    
    Args:
        symbol: ETF ticker symbol (e.g., 'SPY')
        
    Returns:
        Dictionary with 'holdings' list and 'failed' boolean.
        Format: {
            'holdings': [{'symbol': str, 'weight': float}, ...],
            'failed': bool
        }
    """
    try:
        print(f"Fetching ETF holdings for {symbol} from etf.com API")
        
        # Use cloudscraper to bypass any protection
        scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'windows',
                'desktop': True
            }
        )
        
        # ETF.com API endpoint
        api_url = "https://api-prod.etf.com/v2/fund/fund-details"
        
        # API payload - try different queries to get all holdings
        # First try "topHoldings" which might be limited
        # Then try "allHoldings" if available
        payloads = [
            {
                "query": "allHoldings",  # Try to get all holdings first
                "variables": {
                    "ticker": symbol.upper(),
                    "fund_isin": ""
                }
            },
            {
                "query": "topHoldings",  # Fallback to top holdings
                "variables": {
                    "ticker": symbol.upper(),
                    "fund_isin": ""
                }
            }
        ]
        
        # Headers
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        # Make POST request - try different queries
        response = None
        for payload in payloads:
            try:
                print(f"Trying query: {payload['query']}")
                response = scraper.post(
                    api_url,
                    json=payload,
                    headers=headers,
                    timeout=30
                )
                response.raise_for_status()
                break  # Success, use this response
            except Exception as e:
                # If it fails, try next payload
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 400:
                        print(f"Query '{payload['query']}' failed, trying next...")
                        continue
                print(f"Failed to fetch from etf.com API for {symbol}: {str(e)}")
                if hasattr(e, 'response') and e.response is not None:
                    print(f"Response status: {e.response.status_code}")
                    try:
                        print(f"Response body: {e.response.text[:500]}")
                    except:
                        pass
        
        if not response:
            return {
                'holdings': [],
                'failed': True
            }
        
        # Parse response
        try:
            data = response.json()
        except json.JSONDecodeError as e:
            print(f"Failed to parse JSON response: {str(e)}")
            print(f"Response text: {response.text[:500]}")
            return {
                'holdings': [],
                'failed': True
            }
        
        holdings = []
        
        # Extract holdings from response
        # Based on the API response structure:
        # data.topHoldings.data[3].data contains the holdings array
        # where data[3] is the "all_holdings" item
        
        try:
            top_holdings = data.get('data', {}).get('topHoldings', {})
            if top_holdings:
                holdings_list = top_holdings.get('data', [])
                
                # Find the "all_holdings" item (name: "all_holdings")
                for item in holdings_list:
                    if isinstance(item, dict) and item.get('name') == 'all_holdings':
                        holdings_data = item.get('data', [])
                        
                        # Process each holding
                        print(f"Found {len(holdings_data)} holdings in API response")
                        skipped_count = 0
                        skipped_details = []
                        
                        for holding in holdings_data:
                            if isinstance(holding, dict):
                                # Extract name (company name or holding name)
                                name = holding.get('name', '').strip()
                                
                                # Extract symbol (handle None values - use name as fallback)
                                ticker = holding.get('symbol')
                                if ticker:
                                    ticker = str(ticker).strip().upper()
                                elif name:
                                    # If no symbol but we have a name (like "U.S. Dollar"), use the name as identifier
                                    ticker = name.upper()
                                else:
                                    skipped_count += 1
                                    skipped_details.append(f"Missing both symbol and name: {holding}")
                                    continue
                                
                                # Extract weight (comes as "7.49%")
                                weight_str = holding.get('weight', '')
                                if not weight_str:
                                    skipped_count += 1
                                    skipped_details.append(f"{ticker}: Missing weight")
                                    continue
                                
                                try:
                                    # Remove % and convert to float (preserve all decimals)
                                    weight_str_clean = str(weight_str).replace('%', '').strip()
                                    weight_float = float(weight_str_clean)
                                    
                                    # Round to 8 decimal places to preserve maximum precision (e.g., 0.01123456)
                                    weight_float = round(weight_float, 8)
                                    
                                    if weight_float > 0 and weight_float <= 100:
                                        holdings.append({
                                            'symbol': ticker,
                                            'weight': weight_float,
                                            'name': name  # Include company name
                                        })
                                    else:
                                        skipped_count += 1
                                        skipped_details.append(f"{ticker}: weight {weight_float} is out of range")
                                except (ValueError, TypeError) as e:
                                    skipped_count += 1
                                    skipped_details.append(f"{ticker}: Error parsing weight '{weight_str}': {str(e)}")
                                    continue
                        
                        if skipped_count > 0:
                            print(f"Skipped {skipped_count} holdings:")
                            for detail in skipped_details[:5]:  # Show first 5 skipped
                                print(f"  - {detail}")
                            if len(skipped_details) > 5:
                                print(f"  ... and {len(skipped_details) - 5} more")
                        break
        except Exception as e:
            print(f"Error extracting holdings from response structure: {str(e)}")
        
        # If we didn't find holdings, print the response structure for debugging
        if not holdings:
            print(f"Could not find holdings in API response. Response structure:")
            print(json.dumps(data, indent=2)[:1000])  # Print first 1000 chars
        
        print(f"Successfully extracted {len(holdings)} holdings for {symbol}")
        
        return {
            'holdings': holdings,
            'failed': len(holdings) == 0
        }
        
    except Exception as e:
        import traceback
        print(f"Error fetching ETF holdings for {symbol}: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        return {
            'holdings': [],
            'failed': True
        }

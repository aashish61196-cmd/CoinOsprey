const axios = require('axios');
const logger = require('../utils/logger');

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const NSE_BASE_URL = process.env.NSE_API_BASE_URL || 'https://www.nseindia.com/api';

const httpClient = axios.create({
  timeout: 8000,
  headers: { Accept: 'application/json' },
});

// ---- Simple retry wrapper for flaky external APIs ----
async function withRetry(fn, retries = 2, delayMs = 500) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Get current price + 24h change for a single coin by symbol or CoinGecko id.
 */
async function getCoinPrice(symbolOrId) {
  try {
    const id = symbolOrId.toLowerCase();
    const response = await withRetry(() =>
      httpClient.get(`${COINGECKO_BASE_URL}/simple/price`, {
        params: {
          ids: id,
          vs_currencies: 'usd,inr',
          include_24hr_change: true,
          include_market_cap: true,
        },
      })
    );

    const data = response.data[id];
    if (!data) return null;

    return {
      symbol: symbolOrId.toUpperCase(),
      priceUsd: data.usd,
      priceInr: data.inr,
      change24h: data.usd_24h_change,
      marketCapUsd: data.usd_market_cap,
    };
  } catch (err) {
    logger.logError(err, `cryptoAPI.getCoinPrice - ${symbolOrId}`);
    throw new Error(`Failed to fetch price for ${symbolOrId}`);
  }
}

/**
 * Get detailed market data for a coin (rank, volume, supply, ATH, etc.)
 */
async function getCoinMarketData(symbolOrId) {
  try {
    const id = symbolOrId.toLowerCase();
    const response = await withRetry(() =>
      httpClient.get(`${COINGECKO_BASE_URL}/coins/${id}`, {
        params: {
          localization: false,
          tickers: false,
          community_data: false,
          developer_data: false,
        },
      })
    );

    const d = response.data;
    return {
      name: d.name,
      rank: d.market_cap_rank,
      volume24h: d.market_data?.total_volume?.usd,
      circulatingSupply: d.market_data?.circulating_supply,
      totalSupply: d.market_data?.total_supply,
      ath: d.market_data?.ath?.usd,
      athDate: d.market_data?.ath_date?.usd,
      atl: d.market_data?.atl?.usd,
    };
  } catch (err) {
    logger.logError(err, `cryptoAPI.getCoinMarketData - ${symbolOrId}`);
    return null; // non-critical enrichment data; don't fail the whole request
  }
}

/**
 * Get top N coins by market cap, for the site-wide ticker bar.
 */
async function getTopCoins(limit = 10) {
  try {
    const response = await withRetry(() =>
      httpClient.get(`${COINGECKO_BASE_URL}/coins/markets`, {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: limit,
          page: 1,
          sparkline: false,
        },
      })
    );

    return response.data.map((coin) => ({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h,
      marketCap: coin.market_cap,
      image: coin.image,
    }));
  } catch (err) {
    logger.logError(err, 'cryptoAPI.getTopCoins');
    throw new Error('Failed to fetch top coins list');
  }
}

/**
 * Get a live quote for an Indian stock (NSE). NSE's public API is unofficial
 * and rate-limit/session sensitive - wrap carefully and fail gracefully.
 */
async function getIndianStockQuote(symbol) {
  try {
    const response = await withRetry(() =>
      httpClient.get(`${NSE_BASE_URL}/quote-equity`, {
        params: { symbol: symbol.toUpperCase() },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://www.nseindia.com/',
        },
      })
    );

    const d = response.data;
    if (!d?.priceInfo) return null;

    return {
      symbol: symbol.toUpperCase(),
      price: d.priceInfo.lastPrice,
      change: d.priceInfo.change,
      changePercent: d.priceInfo.pChange,
      dayHigh: d.priceInfo.intraDayHighLow?.max,
      dayLow: d.priceInfo.intraDayHighLow?.min,
      previousClose: d.priceInfo.previousClose,
    };
  } catch (err) {
    logger.logError(err, `cryptoAPI.getIndianStockQuote - ${symbol}`);
    return null; // NSE API is unreliable; let caller handle "no data" gracefully
  }
}

module.exports = {
  getCoinPrice,
  getCoinMarketData,
  getTopCoins,
  getIndianStockQuote,
};

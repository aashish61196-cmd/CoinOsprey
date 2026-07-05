const logger = require("../middleware/utils/logger");

const BASE = process.env.COINGECKO_API_BASE || "https://api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY || "";

// Simple in-memory cache so the free CoinGecko tier doesn't rate-limit us
// every time the site's ticker/dashboard polls this backend.
const cache = new Map();
const TTL_MS = 60 * 1000; // 60s

async function cachedFetch(key, url) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < TTL_MS) {
    return { data: hit.data, live: false, cached: true };
  }

  try {
    const headers = API_KEY ? { "x-cg-pro-api-key": API_KEY } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    const data = await res.json();
    cache.set(key, { data, time: Date.now() });
    return { data, live: true, cached: false };
  } catch (err) {
    logger.warn(`cryptoAPI: live fetch failed for ${key} (${err.message})`);
    if (hit) return { data: hit.data, live: false, cached: true }; // serve stale
    throw err;
  }
}

async function getMarkets(limit = 50) {
  const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=24h`;
  return cachedFetch(`markets:${limit}`, url);
}

async function getGlobal() {
  const url = `${BASE}/global`;
  const { data, live, cached } = await cachedFetch("global", url);
  const g = data.data || data; // CoinGecko wraps global stats in { data: {...} }
  return {
    live,
    cached,
    data: {
      total_market_cap_usd: g.total_market_cap ? g.total_market_cap.usd : 0,
      total_volume_usd: g.total_volume ? g.total_volume.usd : 0,
      btc_dominance: g.market_cap_percentage ? g.market_cap_percentage.btc : 0,
      active_cryptocurrencies: g.active_cryptocurrencies || 0,
      market_cap_change_24h: g.market_cap_change_percentage_24h_usd || 0,
    },
  };
}

async function getFearGreed() {
  // CoinGecko doesn't provide Fear & Greed; alternative.me does, and matches
  // the data shape the frontend's CoinOspreyAPI already expects.
  const url = "https://api.alternative.me/fng/?limit=1";
  const { data, live, cached } = await cachedFetch("fng", url);
  const item = (data.data && data.data[0]) || { value: 50, value_classification: "Neutral" };
  return {
    live,
    cached,
    data: { value: Number(item.value), classification: item.value_classification },
  };
}

module.exports = { getMarkets, getGlobal, getFearGreed };

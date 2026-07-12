// Simple in-memory cache so the frontend ticker doesn't get rate-limited
// by CoinGecko / alternative.me on repeated requests.
let cache = {};
const CACHE_TTL = 60 * 1000; // 60 seconds

async function cachedFetch(key, url) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].time) < CACHE_TTL) {
    return cache[key].data;
  }
  const response = await fetch(url);
  const data = await response.json();
  cache[key] = { data, time: now };
  return data;
}

exports.markets = async (req, res) => {
  try {
    const data = await cachedFetch(
      'markets',
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1'
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.global = async (req, res) => {
  try {
    const data = await cachedFetch('global', 'https://api.coingecko.com/api/v3/global');
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.fearGreed = async (req, res) => {
  try {
    const data = await cachedFetch('feargreed', 'https://api.alternative.me/fng/');
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

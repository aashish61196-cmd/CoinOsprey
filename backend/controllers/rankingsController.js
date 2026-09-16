const axios = require('axios');

// ---------------------------------------------------------------------------
// CoinOsprey Rankings — CoinMarketCap proxy
//
// This controller is the ONLY place that talks to CoinMarketCap. The API key
// is read from process.env.CMC_API_KEY (server-side only) and is never sent
// to the browser. Results are cached in-memory for a few minutes so a burst
// of visitors doesn't burn through the CoinMarketCap rate limit.
// ---------------------------------------------------------------------------

const CMC_LISTINGS_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

let cache = { data: null, updatedAt: null, time: 0 };

// Palette reused from the existing rankings.html design so newly-live coins
// still render with the same "colored initials" logo style already in use.
const COLOR_PALETTE = ['#f5a623', '#7c5cff', '#1fb6a8', '#4b5468', '#e2960f', '#e0293e', '#2563eb', '#0e9f6e'];

// Maps CoinMarketCap tags onto the category buckets the Rankings page
// already knows how to render (layer1, defi, ai, meme, layer2, rwa, gaming,
// depin). Anything that doesn't match falls back to 'other', which mirrors
// how stablecoins were already categorized in the page's original mock data.
const TAG_TO_CATEGORY = [
  { category: 'layer1', tags: ['layer-1'] },
  { category: 'layer2', tags: ['layer-2'] },
  { category: 'defi', tags: ['defi'] },
  { category: 'ai', tags: ['artificial-intelligence', 'ai-big-data'] },
  { category: 'meme', tags: ['memes'] },
  { category: 'rwa', tags: ['real-world-assets', 'tokenized-assets'] },
  { category: 'gaming', tags: ['gaming', 'play-to-earn'] },
  { category: 'depin', tags: ['depin'] },
];

function categoryFromTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return 'other';
  for (const entry of TAG_TO_CATEGORY) {
    if (tags.some((t) => entry.tags.includes(t))) return entry.category;
  }
  return 'other';
}

function colorForIndex(i) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length];
}

function toNumber(n) {
  return typeof n === 'number' && !Number.isNaN(n) ? n : 0;
}

function normalize(cmcData) {
  return cmcData.map((coin, i) => {
    const quote = (coin.quote && coin.quote.USD) || {};
    return {
      id: coin.slug || String(coin.id),
      rank: coin.cmc_rank || i + 1,
      name: coin.name,
      symbol: coin.symbol,
      slug: coin.slug,
      logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
      price: toNumber(quote.price),
      change1h: toNumber(quote.percent_change_1h),
      change24h: toNumber(quote.percent_change_24h),
      change7d: toNumber(quote.percent_change_7d),
      marketCap: toNumber(quote.market_cap),
      volume24h: toNumber(quote.volume_24h),
      circulatingSupply: toNumber(coin.circulating_supply),
      totalSupply: toNumber(coin.total_supply),
      maxSupply: toNumber(coin.max_supply),
      category: categoryFromTags(coin.tags),
      color: colorForIndex(i),
    };
  });
}

async function fetchFromCoinMarketCap() {
  const apiKey = process.env.CMC_API_KEY;
  if (!apiKey) {
    const err = new Error('CMC_API_KEY is not configured on the server.');
    err.isConfigError = true;
    throw err;
  }

  const response = await axios.get(CMC_LISTINGS_URL, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'X-CMC_PRO_API_KEY': apiKey,
      Accept: 'application/json',
    },
    params: {
      start: 1,
      limit: 100,
      convert: 'USD',
    },
  });

  const payload = response.data && response.data.data;
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected response shape from CoinMarketCap.');
  }

  return normalize(payload);
}

exports.getRankings = async (req, res) => {
  const now = Date.now();

  // Serve from cache if it's still fresh.
  if (cache.data && now - cache.time < CACHE_TTL_MS) {
    return res.json({ success: true, data: cache.data, updatedAt: cache.updatedAt, cached: true });
  }

  try {
    const data = await fetchFromCoinMarketCap();
    cache = { data, updatedAt: new Date().toISOString(), time: now };
    return res.json({ success: true, data, updatedAt: cache.updatedAt, cached: false });
  } catch (err) {
    // Server-side logging only — never leak internals or the API key to the client.
    console.error('Rankings API error:', err.isConfigError ? err.message : (err.response ? err.response.status : err.message));

    // If CoinMarketCap fails but we still have a (possibly stale) cache, prefer
    // serving that over a hard error so the page doesn't go blank.
    if (cache.data) {
      return res.json({ success: true, data: cache.data, updatedAt: cache.updatedAt, cached: true, stale: true });
    }

    if (err.isConfigError) {
      return res.status(500).json({ success: false, message: 'Market data is temporarily unavailable. Please try again.' });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ success: false, message: 'Market data is temporarily unavailable. Please try again.' });
    }
    if (err.response && err.response.status === 429) {
      return res.status(429).json({ success: false, message: 'Market data is temporarily unavailable. Please try again.' });
    }
    return res.status(502).json({ success: false, message: 'Market data is temporarily unavailable. Please try again.' });
  }
};

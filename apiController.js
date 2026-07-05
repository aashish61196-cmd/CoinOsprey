const { getCoinPrice, getCoinMarketData, getTopCoins, getIndianStockQuote } = require('../services/cryptoAPI');
const Article = require('../models/Article');
const logger = require('../utils/logger');

// Simple in-memory cache to avoid hammering external APIs on every request.
// Suitable for single-instance deployments; swap for Redis if scaling horizontally.
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// @desc    Get live ticker data for the site-wide ticker bar
// @route   GET /api/data/ticker
// @access  Public
exports.getTickerData = async (req, res, next) => {
  try {
    const cacheKey = 'ticker';
    const cached = getCached(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const coins = await getTopCoins(10);
    setCached(cacheKey, coins);

    res.status(200).json({ success: true, data: coins, cached: false });
  } catch (err) {
    logger.logError(err, 'apiController.getTickerData');
    res.status(503).json({
      success: false,
      message: 'Live market data is temporarily unavailable',
    });
  }
};

// @desc    Get live price + market data for a specific coin
// @route   GET /api/data/coin/:symbol
// @access  Public
exports.getCoinData = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `coin:${symbol.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const [price, marketData] = await Promise.all([
      getCoinPrice(symbol),
      getCoinMarketData(symbol),
    ]);

    if (!price) {
      return res.status(404).json({ success: false, message: `No data found for "${symbol}"` });
    }

    const data = { ...price, ...marketData };
    setCached(cacheKey, data);

    res.status(200).json({ success: true, data, cached: false });
  } catch (err) {
    logger.logError(err, `apiController.getCoinData - ${req.params.symbol}`);
    res.status(503).json({
      success: false,
      message: 'Could not fetch live data for this coin right now',
    });
  }
};

// @desc    Get live quote for an Indian stock (NSE/BSE)
// @route   GET /api/data/stock/:symbol
// @access  Public
exports.getStockData = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `stock:${symbol.toUpperCase()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const quote = await getIndianStockQuote(symbol);
    if (!quote) {
      return res.status(404).json({ success: false, message: `No data found for "${symbol}"` });
    }

    setCached(cacheKey, quote);
    res.status(200).json({ success: true, data: quote, cached: false });
  } catch (err) {
    logger.logError(err, `apiController.getStockData - ${req.params.symbol}`);
    res.status(503).json({
      success: false,
      message: 'Could not fetch live data for this stock right now',
    });
  }
};

// @desc    Site-wide search across articles (title, excerpt, content, tags)
// @route   GET /api/data/search
// @access  Public
exports.searchArticles = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const results = await Article.find(
      { status: 'published', $text: { $search: q } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(Number(limit))
      .select('title slug excerpt thumbnail assetSymbol publishedAt')
      .populate('category', 'name slug');

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
};

// @desc    Autocomplete suggestions for asset symbols/names as user types
// @route   GET /api/data/autocomplete
// @access  Public
exports.autocompleteAssets = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.status(200).json({ success: true, data: [] });
    }

    const regex = new RegExp(`^${q.trim()}`, 'i');
    const results = await Article.aggregate([
      {
        $match: {
          status: 'published',
          $or: [{ assetSymbol: regex }, { assetName: regex }],
        },
      },
      {
        $group: {
          _id: '$assetSymbol',
          assetName: { $first: '$assetName' },
          marketType: { $first: '$marketType' },
          latestArticleSlug: { $first: '$slug' },
        },
      },
      { $limit: 10 },
    ]);

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
};

// @desc    Health check endpoint for uptime monitoring
// @route   GET /api/data/health
// @access  Public
exports.healthCheck = (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

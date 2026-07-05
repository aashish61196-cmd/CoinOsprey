const cryptoAPI = require("../services/cryptoAPI");

// GET /api/crypto/markets?limit=50
exports.getMarkets = async (req, res, next) => {
  try {
    const limit = Math.min(250, parseInt(req.query.limit) || 50);
    const { data, live } = await cryptoAPI.getMarkets(limit);
    res.json({ success: true, live, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/crypto/global
exports.getGlobal = async (req, res, next) => {
  try {
    const { data, live } = await cryptoAPI.getGlobal();
    res.json({ success: true, live, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/crypto/fear-greed
exports.getFearGreed = async (req, res, next) => {
  try {
    const { data, live } = await cryptoAPI.getFearGreed();
    res.json({ success: true, live, data });
  } catch (err) {
    next(err);
  }
};

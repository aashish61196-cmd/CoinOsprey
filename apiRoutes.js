const express = require('express');
const router = express.Router();

const {
  getTickerData,
  getCoinData,
  getStockData,
  searchArticles,
  autocompleteAssets,
  healthCheck,
} = require('../controllers/apiController');

// ---- All public, read-only data endpoints ----
router.get('/health', healthCheck);
router.get('/ticker', getTickerData);
router.get('/search', searchArticles);
router.get('/autocomplete', autocompleteAssets);
router.get('/coin/:symbol', getCoinData);
router.get('/stock/:symbol', getStockData);

module.exports = router;

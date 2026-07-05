const express = require('express');
const router = express.Router();

const {
  getSitemap,
  getRobotsTxt,
  getArticleStructuredData,
  analyzeArticleSeo,
} = require('../controllers/seoController');

const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/admin');

// ---- Public SEO endpoints (crawlers + frontend) ----
router.get('/sitemap.xml', getSitemap);
router.get('/robots.txt', getRobotsTxt);
router.get('/structured-data/article/:slug', getArticleStructuredData);

// ---- Editor/admin-only: SEO quality analysis before publishing ----
router.get('/analyze/:id', protect, authorize('editor', 'admin'), analyzeArticleSeo);

module.exports = router;

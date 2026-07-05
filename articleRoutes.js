const express = require('express');
const router = express.Router();

const {
  createArticle,
  getArticles,
  getArticleBySlug,
  updateArticle,
  deleteArticle,
  publishArticle,
  getTrendingArticles,
  getRelatedArticles,
} = require('../controllers/articleController');

const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/admin');
const { uploadSingle, handleUploadError } = require('../middleware/upload');

// ---- Public routes ----
// Note: getArticles/getArticleBySlug read req.user when present (via optional
// auth) to allow editors/admins to preview drafts, but work fine without it.
router.get('/trending', getTrendingArticles);
router.get('/:id/related', getRelatedArticles);
router.get('/:slug', getArticleBySlug);
router.get('/', getArticles);

// ---- Protected routes (editor/admin only) ----
router.post(
  '/',
  protect,
  authorize('editor', 'admin'),
  uploadSingle('thumbnail'),
  handleUploadError,
  createArticle
);

router.put('/:id', protect, updateArticle); // ownership checked inside controller
router.delete('/:id', protect, deleteArticle); // ownership checked inside controller

router.patch('/:id/publish', protect, authorize('editor', 'admin'), publishArticle);

module.exports = router;

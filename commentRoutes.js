const express = require('express');
const router = express.Router();

const {
  createComment,
  getArticleComments,
  updateComment,
  deleteComment,
  toggleLikeComment,
  moderateComment,
  getPendingComments,
} = require('../controllers/commentController');

const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/admin');

// ---- Moderation queue (editor/admin only) ----
// Placed before the article-scoped routes below since it doesn't take an
// article id param and would otherwise never be reachable if mounted oddly.
router.get('/pending', protect, authorize('editor', 'admin'), getPendingComments);

// ---- Article-scoped routes ----
router.get('/article/:articleId', getArticleComments);
router.post('/article/:articleId', protect, createComment);

// ---- Single comment routes ----
router.put('/:id', protect, updateComment); // ownership checked inside controller
router.delete('/:id', protect, deleteComment); // ownership or editor/admin checked inside
router.patch('/:id/like', protect, toggleLikeComment);
router.patch('/:id/moderate', protect, authorize('editor', 'admin'), moderateComment);

module.exports = router;

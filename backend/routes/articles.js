const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const { protect, adminOnly } = require('../middleware/auth');  // ✅ correct path

// Public routes
router.get('/', articleController.getPublished);

// Admin routes (specific path pehle rakhna zaroori hai wagarna '/:slug' isko match kar lega)
router.get('/admin/all', protect, adminOnly, articleController.getAllForAdmin);
router.post('/', protect, adminOnly, articleController.create);
router.put('/:id', protect, adminOnly, articleController.update);
router.delete('/:id', protect, adminOnly, articleController.remove);

// Public single article (yeh sabse last mein honi chahiye)
router.get('/:slug', articleController.getBySlug);

module.exports = router;

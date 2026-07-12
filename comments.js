const router = require('express').Router();
const ctrl = require('../controllers/commentController');
const { protect, adminOnly } = require('../middleware/auth');

router.post('/', ctrl.create);
router.get('/article/:id', ctrl.getForArticle);
router.patch('/:id/status', protect, adminOnly, ctrl.updateStatus);
router.delete('/:id', protect, adminOnly, ctrl.remove);

module.exports = router;

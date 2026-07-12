const router = require('express').Router();
const ctrl = require('../controllers/articleController');
const { protect, adminOnly } = require('../middleware/auth');

router.get('/', ctrl.getPublished);
router.get('/admin/all', protect, adminOnly, ctrl.getAllForAdmin);
router.get('/:slug', ctrl.getBySlug);
router.post('/', protect, adminOnly, ctrl.create);
router.put('/:id', protect, adminOnly, ctrl.update);
router.delete('/:id', protect, adminOnly, ctrl.remove);

module.exports = router;

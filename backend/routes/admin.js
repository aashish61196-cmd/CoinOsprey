const router = require('express').Router();
const ctrl = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');

router.get('/stats', protect, adminOnly, ctrl.stats);
router.get('/users', protect, adminOnly, ctrl.listUsers);
router.get('/categories', protect, adminOnly, ctrl.listCategories);
router.post('/categories', protect, adminOnly, ctrl.createCategory);
router.delete('/categories/:id', protect, adminOnly, ctrl.deleteCategory);

module.exports = router;

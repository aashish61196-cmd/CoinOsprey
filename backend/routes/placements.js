const router = require('express').Router();
const ctrl = require('../controllers/placementController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

// Content Console-only, same protect/adminOnly gate as advertisers.js and
// articles.js — no new role logic introduced for this module.

router.post('/seed-defaults', protect, requirePermission('advertising.settings'), ctrl.seedDefaults);

router.get('/', protect, requirePermission('advertising.view'), ctrl.list);
router.get('/:id', protect, requirePermission('advertising.view'), ctrl.getOne);
router.post('/', protect, requirePermission('advertising.create'), ctrl.create);
router.put('/:id', protect, requirePermission('advertising.edit'), ctrl.update);
router.patch('/:id/active', protect, requirePermission('advertising.edit'), ctrl.setActive);
router.delete('/:id', protect, requirePermission('advertising.delete'), ctrl.remove);

module.exports = router;

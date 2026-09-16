const router = require('express').Router();
const ctrl = require('../controllers/campaignController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

// Same protect/adminOnly gate as every other Advertising route.
// NOTE: /meta/options must be registered before /:id or it would be
// swallowed by the :id param route.
router.get('/meta/options', protect, requirePermission('advertising.view'), ctrl.options);

router.get('/', protect, requirePermission('advertising.view'), ctrl.list);
router.get('/:id', protect, requirePermission('advertising.view'), ctrl.getOne);
router.post('/', protect, requirePermission('advertising.create'), ctrl.create);
router.put('/:id', protect, requirePermission('advertising.edit'), ctrl.update);
router.patch('/:id/status', protect, requirePermission('advertising.publish'), ctrl.updateStatus);
router.delete('/:id', protect, requirePermission('advertising.delete'), ctrl.remove);

// PART 10B: Advertising Pricing & Revenue Management — same
// protect/adminOnly gate as every other Advertising route, no new
// permission system.
router.get('/:id/pricing', protect, requirePermission('advertising.view'), ctrl.getPricing);
router.put('/:id/pricing', protect, requirePermission('advertising.edit'), ctrl.updatePricing);
router.delete('/:id/pricing', protect, requirePermission('advertising.delete'), ctrl.removePricing);
router.get('/:id/revenue', protect, requirePermission('advertising.analytics'), ctrl.getRevenue);

module.exports = router;

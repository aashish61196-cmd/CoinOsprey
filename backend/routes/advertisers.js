const router = require('express').Router();
const ctrl = require('../controllers/advertiserController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

// Every route in this file is Content Console-only — there is no public
// advertiser-facing endpoint here. Reuses the exact same protect/adminOnly
// gate as /api/articles and /api/admin; no new role logic introduced.

// Specific path before the "/:id" catch-alls, same convention as articles.js
router.get('/meta/industries', protect, requirePermission('advertising.view'), ctrl.industries);

router.get('/', protect, requirePermission('advertising.view'), ctrl.list);
router.get('/:id', protect, requirePermission('advertising.view'), ctrl.getOne);
router.post('/', protect, requirePermission('advertising.create'), ctrl.create);
router.put('/:id', protect, requirePermission('advertising.edit'), ctrl.update);
router.patch('/:id/status', protect, requirePermission('advertising.edit'), ctrl.updateStatus);
router.delete('/:id', protect, requirePermission('advertising.delete'), ctrl.remove);

module.exports = router;

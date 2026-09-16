const router = require('express').Router();
const ctrl = require('../controllers/adInventoryController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

// Same protect/adminOnly gate as every other Advertising route in this
// project (advertisers.js, campaigns.js, placements.js, advertisements.js,
// creatives.js) — no new permission system introduced for Inventory.
router.get('/', protect, requirePermission('advertising.view'), ctrl.list);

module.exports = router;

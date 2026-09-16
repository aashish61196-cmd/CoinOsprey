const router = require('express').Router();
const ctrl = require('../controllers/adSettingController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

router.get('/', protect, requirePermission('advertising.settings'), ctrl.get);
router.put('/', protect, requirePermission('advertising.settings'), ctrl.update);

module.exports = router;

const express = require('express');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/creativeController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');
const { MAX_FILE_SIZE_BYTES } = require('../utils/creativeValidation');

// Content Console-only, same protect/adminOnly gate as placements.js and
// advertisers.js — no new role logic introduced for this module.
//
// Memory storage (never touches disk), same as the existing generic
// upload route. The real MIME/type check happens in creativeValidation.js
// against actual file bytes — this multer-level limit is just a cheap
// first line of defense against oversized uploads before they're even
// fully buffered.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 }
});

const creativeFiles = upload.fields([
  { name: 'desktopImage', maxCount: 1 },
  { name: 'mobileImage', maxCount: 1 }
]);

router.get('/', protect, requirePermission('advertising.view'), ctrl.list);
router.get('/:id', protect, requirePermission('advertising.view'), ctrl.getOne);
router.post('/', protect, requirePermission('advertising.create'), creativeFiles, ctrl.create);
router.put('/:id', protect, requirePermission('advertising.edit'), ctrl.update);
router.post('/:id/replace', protect, requirePermission('advertising.edit'), creativeFiles, ctrl.replace);
router.patch('/:id/assign', protect, requirePermission('advertising.edit'), ctrl.assign);
router.patch('/:id/unassign', protect, requirePermission('advertising.edit'), ctrl.unassign);
router.delete('/:id', protect, requirePermission('advertising.delete'), ctrl.remove);

module.exports = router;

const router = require('express').Router();
const ctrl = require('../controllers/newsletterController');
const { protect, adminOnly } = require('../middleware/auth');

router.post('/subscribe', ctrl.subscribe);
router.get('/unsubscribe', ctrl.unsubscribe);
router.get('/admin/subscribers', protect, adminOnly, ctrl.listSubscribers);

module.exports = router;

const express = require('express');
const router = express.Router();

const {
  subscribe,
  confirmSubscription,
  unsubscribe,
  updatePreferences,
  getSubscribers,
  sendCampaign,
} = require('../controllers/newsletterController');

const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/admin');

// ---- Public routes ----
router.post('/subscribe', subscribe);
router.get('/confirm/:token', confirmSubscription);
router.get('/unsubscribe/:token', unsubscribe);
router.put('/preferences/:token', updatePreferences);

// ---- Admin-only routes ----
router.get('/subscribers', protect, authorize('admin'), getSubscribers);
router.post('/send-campaign', protect, authorize('admin'), sendCampaign);

module.exports = router;

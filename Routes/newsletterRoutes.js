const express = require("express");
const router = express.Router();
const {
  subscribe,
  unsubscribe,
  listSubscribers,
  sendCampaign,
} = require("../Controllers/newsletterController");
const { protect } = require("../middleware/auth");
const { permit } = require("../middleware/admin");

// Public
router.post("/subscribe", subscribe);
router.get("/unsubscribe", unsubscribe);

// Protected
router.get("/admin/subscribers", protect, permit("admin", "editor"), listSubscribers);
router.post("/admin/campaign", protect, permit("admin"), sendCampaign);

module.exports = router;

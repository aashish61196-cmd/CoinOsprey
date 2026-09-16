// backend/controllers/adInventoryController.js
//
// PART 12A — Advertising -> Inventory: HTTP layer.
//
// Thin on purpose: reuses the exact same clock-accuracy self-heal steps
// campaignController.list / advertisementController's own read paths
// already run before querying (so inventory can never show a
// stale/expired status just because no one has read that campaign or
// advertisement recently), then delegates the actual aggregation to
// services/adInventoryService.js. No new status system, no new
// authorization — the route file gates this with the same protect +
// adminOnly middleware as every other Advertising route.

const { syncCampaignSchedules } = require('./campaignController');
const { syncAdvertisementSchedules } = require('./advertisementController');
const { getAdvertisingInventory } = require('../services/adInventoryService');
const { INVENTORY_STATUSES } = require('../utils/adInventoryLogic');

// GET /api/advertising/inventory?placement=&device=&campaign=&status=&search=&date=
exports.list = async (req, res) => {
  try {
    const { placement, device, campaign, status, search, date } = req.query;

    if (status && !INVENTORY_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${INVENTORY_STATUSES.join(', ')}` });
    }

    // Same "self-heal on read" convention this codebase already uses
    // everywhere else (campaignController.list, advertisementController's
    // own list/getOne) — recompute clock-driven statuses before deriving
    // inventory from them, rather than trusting whatever status happened
    // to be persisted the last time either document was read.
    await Promise.all([syncCampaignSchedules(), syncAdvertisementSchedules()]);

    const result = await getAdvertisingInventory({
      placementId: placement,
      device,
      campaignId: campaign,
      status,
      search,
      date
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// backend/services/adInventoryService.js
//
// PART 12A — Advertising -> Inventory: DB orchestration layer.
//
// Same division of labor as advertisementDeliveryService.js: this file
// owns the DB round trip only (load real placements, batch-load their
// candidate advertisements with campaign/advertiser/creatives populated),
// and hands already-fetched documents to utils/adInventoryLogic.js for
// the actual derivation. Every value returned traces back to a real
// Placement/Campaign/Advertisement document — nothing here is seeded,
// guessed, or hardcoded.

const mongoose = require('mongoose');
const AdPlacement = require('../models/AdPlacement');
const Advertisement = require('../models/Advertisement');
const { buildInventoryItem } = require('../utils/adInventoryLogic');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * @param {object} params
 * @param {string} [params.placementId] - a single AdPlacement id or key to
 *   scope the result to (matches getOne-by-id-or-key convention already
 *   used by advertisementDeliveryService.resolvePlacement).
 * @param {string} [params.device] - "desktop" | "mobile" | "tablet"
 * @param {string} [params.campaignId] - only include items currently or
 *   next occupied by this campaign
 * @param {string} [params.status] - filter the returned items to this
 *   derived status (see adInventoryLogic.INVENTORY_STATUSES)
 * @param {string} [params.search] - case-insensitive match against
 *   placement name/key
 * @param {Date|string} [params.date] - override "now" (testing/backfill only)
 * @returns {Promise<{ items: object[] }>}
 */
async function getAdvertisingInventory(params = {}) {
  const { placementId, device, campaignId, status, search, date } = params;

  // ---- 1. load real placements (never seeded/fabricated) ----
  const placementFilter = {};
  if (placementId) {
    if (isValidId(placementId)) placementFilter._id = placementId;
    else placementFilter.key = String(placementId).trim().toLowerCase();
  }
  if (search && search.trim()) {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    placementFilter.$or = [{ name: re }, { key: re }];
  }

  const placements = await AdPlacement.find(placementFilter).sort({ isDefault: -1, name: 1 });

  if (placements.length === 0) {
    return { items: [] }; // spec item 16 — empty collection, never demo records
  }

  // ---- 2. batch-load every candidate advertisement for these placements
  // in ONE query (spec item 13 — no N+1). Status/schedule are NOT
  // filtered at the query level here (unlike the public delivery filter)
  // because inventory needs to see current AND future candidates in the
  // same pass; adInventoryLogic does that split in memory once, cheaply,
  // over this single already-fetched set. ----
  const placementIds = placements.map((p) => p._id);
  const adFilter = { placements: { $in: placementIds } };
  if (campaignId && isValidId(campaignId)) adFilter.campaign = campaignId;

  const ads = await Advertisement.find(adFilter)
    .select('name campaign advertiser placements schedule status approval priority targeting creatives')
    .populate('campaign', 'name status startDate endDate advertiser')
    .populate('advertiser', 'status')
    .populate('creatives', 'name status');
  // .populate() batches one query per ref field regardless of how many
  // advertisements matched — a fixed 3 extra queries total, not one per ad
  // and not one per placement.

  // ---- 3. group already-fetched ads by placement (in memory — no
  // repeated DB round trips per placement) ----
  const adsByPlacement = new Map(placementIds.map((id) => [String(id), []]));
  ads.forEach((ad) => {
    (ad.placements || []).forEach((pid) => {
      const key = String(pid);
      if (adsByPlacement.has(key)) adsByPlacement.get(key).push(ad);
    });
  });

  // ---- 4. derive each row via the pure logic layer ----
  let items = placements.map((placement) =>
    buildInventoryItem({
      placement,
      ads: adsByPlacement.get(String(placement._id)) || [],
      device,
      date
    })
  );

  // NOTE: `device` is not used to drop rows here — a placement that
  // doesn't support the requested device at all is still a real
  // inventory row (an admin filtering "Mobile" should still see that
  // "Top Banner" exists and is desktop-only); adInventoryLogic's
  // status/current/future/isRotating derivation above already accounts
  // for device targeting/support when deciding occupancy.
  if (status) items = items.filter((item) => item.status === status);

  return { items };
}

module.exports = { getAdvertisingInventory };

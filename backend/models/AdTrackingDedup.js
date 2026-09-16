const mongoose = require('mongoose');

// PART 10A — short-lived, privacy-conscious deduplication record for
// advertising analytics writes.
//
// This collection holds NOTHING analytics-shaped: no advertisement name,
// no visitor identifier, no IP. It holds only a single opaque dedup key
// and lets MongoDB's TTL index expire the row a few seconds later. The
// uniqueness constraint on `key` is what actually does the work: two
// concurrent/duplicate tracking requests (React effect double-fires, a
// browser retrying a POST, a rapid double-click) race to insert the same
// key, and exactly one of them wins — the other gets a duplicate-key
// error and is treated as "already counted", never as a second event.
//
// This intentionally does NOT identify a visitor across requests or
// sessions: the key is derived either from a per-render/per-click
// event id the frontend already throws away after firing (see
// ad-slot.js), or — if that's missing — from a coarse, few-second time
// bucket over (eventType, advertisementId, placementId, device), which
// cannot be used to track anyone (see advertisementAnalyticsService.js
// buildDedupKey for the exact derivation).
const adTrackingDedupSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 60 } // auto-purged ~60s later
}, { versionKey: false });

module.exports = mongoose.model('AdTrackingDedup', adTrackingDedupSchema);

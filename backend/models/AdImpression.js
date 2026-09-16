const mongoose = require('mongoose');

// One document per ad view. Deliberately holds no IP address, user ID,
// cookie ID or precise location — only the coarse dimensions needed for
// reporting (device class, language, country). campaign/placement are
// denormalized onto the event (copied from the Advertisement at the time
// of the impression) so reporting queries never need to join through
// Advertisement just to group by campaign or placement.
const adImpressionSchema = new mongoose.Schema({
  advertisement: { type: mongoose.Schema.Types.ObjectId, ref: 'Advertisement', required: true },
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  placement: { type: mongoose.Schema.Types.ObjectId, ref: 'AdPlacement', required: true },

  occurredAt: { type: Date, default: Date.now },

  device: { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'], default: 'unknown' },
  language: { type: String, default: '' },
  country: { type: String, default: '' }, // coarse ISO country code only

  // PART 10A: which page/section the impression was served on (one of
  // advertisementLogic.PAGE_TARGETING_KEYS, or '' if unknown). Added as
  // a plain optional field rather than a new collection/table — existing
  // documents simply have no value for it, which the analytics reads
  // already treat the same way byLanguage/byDevice treat a missing value
  // (grouped under "unspecified").
  page: { type: String, default: '' }
}, { timestamps: false });

adImpressionSchema.index({ advertisement: 1, occurredAt: -1 });
adImpressionSchema.index({ campaign: 1, occurredAt: -1 });
adImpressionSchema.index({ placement: 1, occurredAt: -1 });
// PART 10A: supports the future dashboard's day/page aggregation
// (spec items 15-16) without a full collection scan.
adImpressionSchema.index({ occurredAt: -1, page: 1 });

// Optional retention control for a high-volume event collection. Left
// commented out until a retention window is agreed with the business —
// enabling it will make MongoDB auto-delete rows older than N seconds.
// adImpressionSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.model('AdImpression', adImpressionSchema);

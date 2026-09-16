const mongoose = require('mongoose');

// Mirrors AdImpression exactly, kept as a separate collection (rather
// than an impression with a "wasClicked" flag) so the much smaller click
// stream can be queried/retained independently of the much larger
// impression stream. Same no-PII policy as AdImpression.
const adClickSchema = new mongoose.Schema({
  advertisement: { type: mongoose.Schema.Types.ObjectId, ref: 'Advertisement', required: true },
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  placement: { type: mongoose.Schema.Types.ObjectId, ref: 'AdPlacement', required: true },

  occurredAt: { type: Date, default: Date.now },

  device: { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'], default: 'unknown' },
  language: { type: String, default: '' },
  country: { type: String, default: '' },

  // PART 10A: see AdImpression.page — same convention, same reasoning.
  page: { type: String, default: '' }
}, { timestamps: false });

adClickSchema.index({ advertisement: 1, occurredAt: -1 });
adClickSchema.index({ campaign: 1, occurredAt: -1 });
adClickSchema.index({ placement: 1, occurredAt: -1 });
adClickSchema.index({ occurredAt: -1, page: 1 });

module.exports = mongoose.model('AdClick', adClickSchema);

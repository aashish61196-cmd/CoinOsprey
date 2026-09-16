const mongoose = require('mongoose');

// An AdCreative is a reusable media asset in the Advertising Creative
// Library. It is intentionally independent of any single Advertisement —
// admins upload once and then assign/reuse the same creative across one
// or more Advertisements, and/or tag it to a Campaign directly. This is
// what makes "Reuse" (see the console's Creatives page) possible: the
// relationship lives here as arrays/refs rather than requiring a creative
// to belong to exactly one ad from the moment it's uploaded.
//
// Responsive support: a creative can carry a desktop asset and, optionally,
// a separate mobile asset (e.g. 970x250 desktop / 320x100 mobile). If no
// mobile asset is uploaded, renderers should fall back to the desktop
// asset — this schema doesn't enforce that fallback itself, it just makes
// mobile optional.

const assetSchema = new mongoose.Schema({
  fileUrl: { type: String, default: '' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  mimeType: { type: String, default: '' },
  fileSizeBytes: { type: Number, default: 0 }
}, { _id: false });

const adCreativeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  altText: { type: String, default: '', trim: true },

  desktop: { type: assetSchema, default: () => ({}) },
  // Optional — omitted mobile asset means "use desktop everywhere".
  mobile: { type: assetSchema, default: () => ({}) },

  // Optional guidance link only, used at upload time to validate exact
  // pixel dimensions when a placement requires a fixed size. Not required
  // for a creative to exist in the library.
  placement: { type: mongoose.Schema.Types.ObjectId, ref: 'AdPlacement', default: null },

  // Library-level assignment. Both are optional and independent:
  // - campaign: ties this creative to a Campaign for reuse across every
  //   Advertisement inside it.
  // - advertisements: specific Advertisement(s) this creative is currently
  //   attached to. A creative can be reused across many Advertisements at
  //   once, which is why this is an array rather than a single ref.
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
  advertisements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Advertisement' }],

  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active', index: true },

  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true }); // createdAt doubles as "upload date"

adCreativeSchema.index({ advertisements: 1 });

module.exports = mongoose.model('AdCreative', adCreativeSchema);

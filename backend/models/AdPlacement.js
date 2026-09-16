const mongoose = require('mongoose');

// AdPlacement is a lookup table describing the physical/logical ad zones
// that exist on the site (e.g. "top-banner", "in-article"). It's defined
// once by an admin and then referenced by many Advertisements — the same
// relationship Category has to Article. This file intentionally knows
// nothing about advertisers or campaigns: a placement is just a slot
// definition, never tied to who is allowed to fill it.
//
// NOTE: this supersedes the Part 3 draft of this file — `size` (width/
// height numbers) was replaced with a single `recommendedDimensions`
// string, since several required placements (Homepage Feature, Sponsored
// Article, Newsletter, etc.) aren't fixed pixel boxes and shouldn't be
// forced into a width/height shape just to hold text like "Responsive" or
// "Article-level". `rotationMode` and `fallbackBehavior` were also
// tightened to the exact vocabulary the console's Placement Management
// screen supports.

const ROTATION_MODES = ['priority', 'even', 'random'];
const FALLBACK_BEHAVIORS = ['hide', 'collapse', 'house_ad'];
const DEVICES = ['desktop', 'mobile', 'both'];

const adPlacementSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },

  // Stable machine key used by the (future) public-page renderer to look
  // up which ads to show in a given slot. Set once at creation and never
  // changed afterward — every layer (controller + schema) enforces this,
  // since anything downstream (Advertisement.placements refs, cached
  // configs, etc.) will come to depend on the key never moving.
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z0-9]+(-[a-z0-9]+)*$/, 'key must be lowercase kebab-case (letters, numbers, hyphens)'],
    immutable: true
  },

  description: { type: String, default: '' },

  // Free text on purpose — e.g. "970x250", "320x100", but also "Responsive",
  // "Article-level", "Promotional" for placements that aren't a fixed pixel
  // box. This is guidance for creative production, not an enforced size.
  recommendedDimensions: { type: String, default: '', trim: true },

  device: { type: String, enum: DEVICES, default: 'both' },

  active: { type: Boolean, default: true, index: true },

  // How multiple eligible ads competing for this slot are chosen:
  // priority = highest-priority ad wins; even = equal round-robin split;
  // random = random pick per request.
  rotationMode: { type: String, enum: ROTATION_MODES, default: 'priority' },

  // What to show when no active/approved ad currently matches this slot:
  // hide = remove the slot entirely; collapse = keep layout space closed;
  // house_ad = show an internal/house creative instead of leaving it empty.
  fallbackBehavior: { type: String, enum: FALLBACK_BEHAVIORS, default: 'hide' },

  // Marks the 9 placements this module ships with by default. Purely
  // informational (e.g. shown as a "Default" badge in the console) — it
  // does not block editing or disabling. Deletion safety is instead based
  // on whether any Advertisement currently references the placement.
  isDefault: { type: Boolean, default: false }
}, { timestamps: true });

adPlacementSchema.index({ active: 1 });
adPlacementSchema.index({ device: 1 });

adPlacementSchema.statics.ROTATION_MODES = ROTATION_MODES;
adPlacementSchema.statics.FALLBACK_BEHAVIORS = FALLBACK_BEHAVIORS;
adPlacementSchema.statics.DEVICES = DEVICES;

// The 9 required default placement definitions. Kept as a static (rather
// than a separate seed script) so both the server startup hook and any
// one-off admin tooling call the exact same source of truth.
const DEFAULT_PLACEMENTS = [
  {
    name: 'Top Banner',
    key: 'top-banner',
    recommendedDimensions: '970x250',
    device: 'desktop',
    description: 'Large banner placed at the top of key pages.'
  },
  {
    name: 'Leaderboard',
    key: 'leaderboard',
    recommendedDimensions: '728x90',
    device: 'desktop',
    description: 'Standard leaderboard banner.'
  },
  {
    name: 'Sidebar',
    key: 'sidebar',
    recommendedDimensions: '300x250',
    device: 'desktop',
    description: 'Medium rectangle in the page sidebar.'
  },
  {
    name: 'Mobile Banner',
    key: 'mobile-banner',
    recommendedDimensions: '320x100',
    device: 'mobile',
    description: 'Compact banner sized for mobile viewports.'
  },
  {
    name: 'Homepage Feature',
    key: 'homepage-feature',
    recommendedDimensions: 'Responsive',
    device: 'both',
    description: 'Featured promotional slot on the homepage.'
  },
  {
    name: 'Sponsored Article',
    key: 'sponsored-article',
    recommendedDimensions: 'Article-level',
    device: 'both',
    description: 'A full article slot labeled as sponsored content.'
  },
  {
    name: 'In-Article Advertisement',
    key: 'in-article',
    recommendedDimensions: 'Responsive',
    device: 'both',
    description: 'Ad slot embedded within article body content.'
  },
  {
    name: 'Bottom Article Advertisement',
    key: 'bottom-article',
    recommendedDimensions: 'Responsive',
    device: 'both',
    description: 'Ad slot placed after the end of article content.'
  },
  {
    name: 'Newsletter',
    key: 'newsletter',
    recommendedDimensions: 'Promotional',
    device: 'both',
    description: 'Promotional slot inside the newsletter template.'
  }
];

adPlacementSchema.statics.DEFAULT_PLACEMENTS = DEFAULT_PLACEMENTS;

// Idempotent: safe to call on every server start. Only ever inserts —
// never overwrites a placement an admin has since edited, so re-deploying
// doesn't clobber configuration changes made in the console.
adPlacementSchema.statics.seedDefaults = async function seedDefaults() {
  const AdPlacement = this;
  for (const def of DEFAULT_PLACEMENTS) {
    // eslint-disable-next-line no-await-in-loop
    await AdPlacement.updateOne(
      { key: def.key },
      { $setOnInsert: { ...def, isDefault: true, active: true, rotationMode: 'priority', fallbackBehavior: 'hide' } },
      { upsert: true }
    );
  }
};

module.exports = mongoose.model('AdPlacement', adPlacementSchema);

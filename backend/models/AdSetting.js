const mongoose = require('mongoose');
const { isSafeUrlScheme } = require('../utils/urlValidation');

// Singleton settings document for the advertising system as a whole.
// Singleton is enforced application-side (controller should always
// upsert/find on { key: 'global' } rather than creating new documents),
// the same way a single-tenant config table would work in SQL.
const HOUSE_AD_CATEGORIES = ['latest_news','price_predictions','crypto_education','rankings','custom'];
const DEFAULT_AD_STATUS_VALUES = ['draft','pending_review','approved'];
const ROTATION_MODE_VALUES = ['priority','even','random'];

const houseAdSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, enum: HOUSE_AD_CATEGORIES, default: 'custom' },
  creative: { type: mongoose.Schema.Types.ObjectId, ref: 'AdCreative', required: true },
  destinationUrl: {
    type: String, required: true, trim: true,
    validate: { validator: (v) => isSafeUrlScheme(v), message: (props) => `${props.value} is not an allowed house advertisement destination URL` }
  },
  openInNewTab: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  priority: { type: Number, min: 1, default: 5 }
}, { _id: true });

const adSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },

  adsEnabled: { type: Boolean, default: true }, // site-wide kill switch
  defaultCurrency: { type: String, default: 'USD' },
  defaultTimezone: { type: String, default: 'UTC' },
  maxAdsPerPage: { type: Number, default: 6 },

  // PART 13 — global advertising defaults/display/tracking/safety.
  defaultAdvertisementStatus: { type: String, enum: DEFAULT_AD_STATUS_VALUES, default: 'draft' },
  defaultRotationMode: { type: String, enum: ROTATION_MODE_VALUES, default: 'priority' },
  display: {
    showAdvertisementLabel: { type: Boolean, default: true },
    responsiveBehavior: { type: String, enum: ['responsive','fixed'], default: 'responsive' },
    lazyLoading: { type: Boolean, default: true }
  },
  tracking: {
    impressionTracking: { type: Boolean, default: true },
    clickTracking: { type: Boolean, default: true },
    utmGeneration: { type: Boolean, default: true }
  },
  safety: {
    maxCreativeSizeBytes: { type: Number, min: 1024, max: 10485760, default: 3145728 },
    allowedFileTypes: { type: [String], default: ['image/jpeg','image/png','image/webp','image/svg+xml'] },
    externalUrlValidation: { type: Boolean, default: true }
  },
  houseAdsEnabled: { type: Boolean, default: true },
  houseAds: { type: [houseAdSchema], default: [] },

  // Fallback creative shown when a placement's fallbackBehavior is
  // "house_ad" and no eligible Advertisement currently matches it. This
  // was already reserved in Part 8A for exactly this PART 8B use case —
  // reused as-is rather than introducing a second/parallel "house ad"
  // concept modeled as a full Advertisement (which would require an
  // Advertiser, per that schema's `required: true`, and house ads must
  // NOT require a paid advertiser — spec item 7).
  houseAdCreative: { type: mongoose.Schema.Types.ObjectId, ref: 'AdCreative' },
  // PART 8B: the house creative alone has no click-through destination
  // (AdCreative is a pure media asset, reused across ordinary
  // Advertisements which each supply their own destinationUrl) — these
  // two fields pair with houseAdCreative to make it independently
  // deliverable.
  houseAdDestinationUrl: {
    type: String,
    default: '',
    trim: true,
    validate: {
      validator: (v) => !v || isSafeUrlScheme(v),
      message: (props) => `${props.value} is not an allowed house advertisement destination URL`
    }
  },
  houseAdOpenInNewTab: { type: Boolean, default: true },

  requireApprovalBeforeLive: { type: Boolean, default: true }
}, { timestamps: true });

adSettingSchema.statics.HOUSE_AD_CATEGORIES = HOUSE_AD_CATEGORIES;
adSettingSchema.statics.DEFAULT_AD_STATUS_VALUES = DEFAULT_AD_STATUS_VALUES;
adSettingSchema.statics.ROTATION_MODE_VALUES = ROTATION_MODE_VALUES;

module.exports = mongoose.model('AdSetting', adSettingSchema);

const mongoose = require('mongoose');
const { TIMEZONE_VALUES } = require('../utils/timezone');
const { isSafeUrlScheme } = require('../utils/urlValidation');
const {
  ADVERTISEMENT_TYPES,
  DEFAULT_ADVERTISEMENT_TYPE,
  ADVERTISEMENT_STATUSES,
  DEFAULT_ADVERTISEMENT_STATUS,
  PAGE_TARGETING_KEYS,
  DEVICE_TARGETING_VALUES,
  LANGUAGE_TARGETING_VALUES
} = require('../utils/advertisementLogic');

// Advertisement is the central entity: it ties a Campaign to one or more
// Placements, one or more Creatives, a schedule, targeting rules and an
// approval workflow. This is the record the public-page ad renderer
// ultimately queries against (status + schedule + placement + targeting).
//
// PART 7A-1 EXTENSION NOTES (read before changing this file further)
// --------------------------------------------------------------------
// - `placement` (single ref) was replaced with `placements` (array of
//   refs) to support one advertisement running in several slots at once,
//   per the many-to-many requirement. An array of ObjectId refs is this
//   project's existing pattern for many-to-many (see AdCreative.campaign
//   vs AdCreative.advertisements, or Advertisement.creatives below) —
//   there is no separate join-table convention anywhere else in this
//   codebase, so one wasn't introduced here either. Any code still
//   reading/writing the old singular `placement` field must be updated
//   (see backend/migrations/2026-advertisement-placements-array.js for a
//   one-time data migration if this ships against an existing database).
// - `status` enum was aligned to Campaign's already-established
//   vocabulary (`pending_review` instead of the old `pending_approval`,
//   plus the missing `scheduled` state) rather than inventing a second
//   naming scheme for the same concept. Nothing outside this file
//   referenced the old enum values (verified via repo-wide search), so
//   this is a safe rename, not a breaking one.
// - `priority`'s "lower number = higher priority" convention is kept
//   as-is: it was already established here before this part, and the
//   task instructions say to prefer an existing convention over the
//   spec's suggested default when one already exists.
// - Every enum/vocabulary that used to live only as inline schema
//   `enum: [...]` arrays now also lives in utils/advertisementLogic.js so
//   the (not-yet-built) Part 7A-2 controller/action layer, and this
//   schema, both validate against one shared source of truth.
const advertisementSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },

  // index: true omitted on advertiser/campaign/placements/status below —
  // each already gets an explicit .index() call further down (including
  // as part of compound indexes), and declaring both is redundant (see
  // objective: "do not over-index unnecessarily").
  advertiser: { type: mongoose.Schema.Types.ObjectId, ref: 'Advertiser', required: true },
  // Kept required: true, matching the convention already established in
  // this file before Part 7A-1 (i.e. this codebase's advertising
  // architecture does not currently allow campaign-less ads). If that
  // ever changes, drop `required` here and update
  // validateCampaignForAdvertisement()'s call sites accordingly — the
  // logic layer already tolerates campaign === null.
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },

  type: { type: String, enum: ADVERTISEMENT_TYPES, default: DEFAULT_ADVERTISEMENT_TYPE },

  // Many-to-many: one ad may run in several compatible slots at once.
  placements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AdPlacement' }],

  // Multiple creatives allow rotation within the same ad slot without
  // creating a separate Advertisement per image.
  creatives: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AdCreative' }],

  destinationUrl: {
    type: String,
    required: true,
    trim: true,
    // Defense in depth only — the authoritative check + normalization is
    // utils/urlValidation.validateDestinationUrl, run by the controller
    // layer before save (same division of labor as Campaign's schema vs.
    // campaignController.buildFields/validatePayload).
    validate: {
      validator: isSafeUrlScheme,
      message: (props) => `${props.value} is not an allowed destination URL`
    }
  },
  openInNewTab: { type: Boolean, default: true },

  schedule: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    timezone: { type: String, enum: TIMEZONE_VALUES, default: 'Asia/Kolkata' }
  },

  // Lower number = higher priority. Only meaningful when the ad's
  // AdPlacement.rotationMode is "priority".
  priority: { type: Number, default: 5, min: 1 },
  // Only meaningful when the placement's rotationMode is "weighted".
  rotationWeight: { type: Number, default: 1 },

  frequencyCap: {
    maxImpressions: { type: Number, default: 0 }, // 0 = unlimited
    per: { type: String, enum: ['session', 'day', 'week'], default: 'day' }
  },

  // Empty arrays mean "no restriction / all" for that dimension — same
  // convention as before this part, just extended with page/category/
  // article/urlPattern targeting.
  targeting: {
    languages: [{ type: String, enum: LANGUAGE_TARGETING_VALUES }], // matches Article.language
    devices: [{ type: String, enum: DEVICE_TARGETING_VALUES }],
    countries: [{ type: String }], // ISO 3166-1 alpha-2 codes
    // Page-level targeting keys (Homepage/News/Price Prediction/etc.).
    // "category"/"article" here mean "restrict by the ids below", not a
    // page in themselves.
    pages: [{ type: String, enum: PAGE_TARGETING_KEYS }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    articles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Article' }],
    // Match rules only (e.g. "/en/news/*") — never evaluated as code.
    // See utils/urlValidation.validateUrlPattern for the allowed charset.
    urlPatterns: [{ type: String, trim: true }]
  },

  status: {
    type: String,
    enum: ADVERTISEMENT_STATUSES,
    default: DEFAULT_ADVERTISEMENT_STATUS // NEW ADS MUST NEVER DEFAULT TO "active"
  },

  approval: {
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    // PART 12A: required whenever approval.status === 'rejected' (enforced
    // in the controller, same "schema stores it, controller enforces the
    // business rule" split already used elsewhere in this file — e.g.
    // destinationUrl's schema-level scheme check vs. the controller's
    // fuller validateDestinationUrl). Cleared back to '' on approve/resubmit.
    rejectionReason: { type: String, default: '' },
    // Pre-existing field, reused as the spec's "adminNote" — kept the name
    // that was already here rather than adding a second, duplicate text
    // field for the same purpose (spec: "Do NOT create duplicate status
    // fields" applies just as much to plain fields).
    notes: { type: String, default: '' }
  },

  internalNotes: { type: String, default: '' },

  // PART 8B: persistent delivery-rotation state. `lastServedAt` is used by
  // both PRIORITY (tie-break) and EVEN (round-robin fairness) rotation so
  // a tie/fairness decision survives across requests and server restarts
  // — deliberately NOT an in-memory counter, since this app runs as
  // request-scoped serverless-style handlers (see server.js's cached
  // Mongo connection pattern) with no shared process memory to rely on.
  // `deliveryCount` is EVEN rotation's round-robin cursor: whichever
  // eligible ad has been served the fewest times goes next. Neither field
  // is written anywhere except advertisementDeliveryService.recordDelivery()
  // (a single atomic $inc/$set), so concurrent requests can't race each
  // other into an inconsistent count.
  lastServedAt: { type: Date, default: null },
  deliveryCount: { type: Number, default: 0 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

advertisementSchema.index({ status: 1 });
advertisementSchema.index({ 'schedule.startDate': 1 });
advertisementSchema.index({ 'schedule.endDate': 1 });
advertisementSchema.index({ placements: 1, status: 1 });
advertisementSchema.index({ campaign: 1 });
advertisementSchema.index({ advertiser: 1 });

// Compound index for the hot-path public query: "which approved/active ads
// currently match this placement and are inside their schedule window?"
// PART 8A: added 'approval.status' — getEligibleAdvertisements()
// (services/advertisementDeliveryService.js) filters on it in the same
// query alongside status/placements/schedule, so it belongs in this
// index rather than being a separate one.
advertisementSchema.index({
  placements: 1,
  status: 1,
  'approval.status': 1,
  'schedule.startDate': 1,
  'schedule.endDate': 1
});

advertisementSchema.statics.TYPES = ADVERTISEMENT_TYPES;
advertisementSchema.statics.STATUSES = ADVERTISEMENT_STATUSES;
advertisementSchema.statics.PAGE_TARGETING_KEYS = PAGE_TARGETING_KEYS;

module.exports = mongoose.model('Advertisement', advertisementSchema);

const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const Advertiser = require('../models/Advertiser');
const Advertisement = require('../models/Advertisement');
const AdImpression = require('../models/AdImpression');
const AdClick = require('../models/AdClick');
const AdAuditLog = require('../models/AdAuditLog');
const { TIMEZONES, isValidTimezone, combineToUtc, splitFromUtc } = require('../utils/timezone');
const {
  PRICING_MODELS: AD_PRICING_MODELS,
  CURRENCIES,
  BILLING_PERIODS,
  MODEL_BILLING_PERIODS,
  validatePricingPayload
} = require('../utils/adPricingLogic');
const { computeEstimatedRevenue, getActualRevenue } = require('../services/adRevenueService');

const MANAGED_STATUSES = Campaign.MANAGED_STATUSES;
const ALL_STATUSES = Campaign.STATUSES;
const PRICING_MODELS = ['CPM', 'CPC', 'CPD', 'flat']; // legacy field's vocabulary only — see AD_PRICING_MODELS for Part 10B pricing

/* =========================================================================
   PART 10B: AUDIT LOGGING
   Same shared-writer pattern as advertisementController.writeAudit — one
   consistent shape (entityType/entityId/action/performedBy/changes/notes),
   never allowed to block the primary pricing action.
========================================================================= */
async function writeAudit({ entityId, action, performedBy, changes = {}, notes = '' }) {
  try {
    await AdAuditLog.create({ entityType: 'Campaign', entityId, action, performedBy, changes, notes });
  } catch (err) {
    console.error('AdAuditLog write failed:', err.message);
  }
}

/* =========================================================================
   SCHEDULE ENGINE
   Campaigns don't have a background worker to flip their status the
   instant a clock boundary is crossed (this app has no cron/queue), so
   instead every read path recomputes and persists the correct status
   first — the same "self-heal on request" approach server.js already
   uses for AdPlacement.seedDefaults(). This keeps a "scheduled" campaign
   reliably eligible starting at startDate and ineligible after endDate
   without needing any scheduled job.
========================================================================= */
function computeManagedStatus(campaign, now) {
  if (!MANAGED_STATUSES.includes(campaign.status)) return campaign.status; // untouched: draft/pending_review/rejected/cancelled/completed
  if (now > campaign.endDate) return 'expired';
  if (now < campaign.startDate) return 'scheduled';
  // Inside the eligibility window: a deliberate pause stays paused,
  // everything else becomes (or stays) active.
  return campaign.status === 'paused' ? 'paused' : 'active';
}

// Recomputes + persists status for every managed-status campaign. Cheap
// enough for this collection's expected size; only issues writes for the
// rows whose status actually changed.
async function syncCampaignSchedules(extraFilter = {}) {
  const now = new Date();
  const candidates = await Campaign.find({ status: { $in: MANAGED_STATUSES }, ...extraFilter }).select('status startDate endDate');
  const ops = [];
  for (const c of candidates) {
    const next = computeManagedStatus(c, now);
    if (next !== c.status) ops.push({ updateOne: { filter: { _id: c._id }, update: { status: next } } });
  }
  if (ops.length) await Campaign.bulkWrite(ops);
}

function isEligibleNow(campaign, now = new Date()) {
  return campaign.status === 'active' && campaign.startDate <= now && now <= campaign.endDate;
}

/* =========================================================================
   VALIDATION
========================================================================= */
function validatePayload(body, { partial } = { partial: false }) {
  const errors = [];
  const required = ['name', 'advertiser', 'startDate', 'startTime', 'endDate', 'endTime'];

  if (!partial) {
    for (const field of required) {
      if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
        errors.push(`${field} is required`);
      }
    }
  }

  if (body.advertiser !== undefined && body.advertiser !== '' && !mongoose.Types.ObjectId.isValid(body.advertiser)) {
    errors.push('advertiser is not a valid id');
  }

  if (body.budget !== undefined && body.budget !== '' && (isNaN(Number(body.budget)) || Number(body.budget) < 0)) {
    errors.push('budget must be a non-negative number');
  }

  if (body.pricingModel !== undefined && body.pricingModel !== '' && !PRICING_MODELS.includes(body.pricingModel)) {
    errors.push('pricingModel is not a recognized value');
  }

  if (body.targetImpressions !== undefined && body.targetImpressions !== '' &&
      (isNaN(Number(body.targetImpressions)) || Number(body.targetImpressions) < 0)) {
    errors.push('targetImpressions must be a non-negative number');
  }

  if (body.targetClicks !== undefined && body.targetClicks !== '' &&
      (isNaN(Number(body.targetClicks)) || Number(body.targetClicks) < 0)) {
    errors.push('targetClicks must be a non-negative number');
  }

  if (body.timezone !== undefined && body.timezone !== '' && !isValidTimezone(body.timezone)) {
    errors.push('timezone is not a recognized value');
  }

  if (body.status !== undefined && body.status !== '' && !ALL_STATUSES.includes(body.status)) {
    errors.push('status is not a recognized value');
  }

  // Only attempt to validate the actual date/time combination once the
  // basic per-field required checks above have already passed, so we
  // don't throw a confusing "Invalid start date/time" on top of an
  // already-reported "startDate is required".
  const hasAllScheduleFields = ['startDate', 'startTime', 'endDate', 'endTime'].every(
    (f) => body[f] !== undefined && String(body[f] || '').trim() !== ''
  );
  if (hasAllScheduleFields) {
    const tz = body.timezone || 'Asia/Kolkata';
    if (isValidTimezone(tz)) {
      const start = combineToUtc(body.startDate, body.startTime, tz);
      const end = combineToUtc(body.endDate, body.endTime, tz);
      if (!start || !end) {
        errors.push('start/end date or time is not a valid date/time');
      } else if (end <= start) {
        errors.push('End date/time must be after start date/time');
      }
    }
  }

  return errors;
}

// Turns validated payload fields into a plain object of schema-ready
// values. Only includes keys that were actually present in `body` so it
// can be used for both create (spread over defaults) and update (spread
// over the existing document).
function buildFields(body) {
  const fields = {};
  if (body.name !== undefined) fields.name = String(body.name).trim();
  if (body.advertiser !== undefined) fields.advertiser = body.advertiser;
  if (body.description !== undefined) fields.description = String(body.description).trim();
  if (body.pricingModel !== undefined) fields.pricingModel = body.pricingModel;
  if (body.pricingRate !== undefined) fields.pricingRate = Number(body.pricingRate) || 0;
  if (body.targetImpressions !== undefined) fields.targetImpressions = Math.max(0, Math.floor(Number(body.targetImpressions) || 0));
  if (body.targetClicks !== undefined) fields.targetClicks = Math.max(0, Math.floor(Number(body.targetClicks) || 0));
  if (body.internalNotes !== undefined) fields.internalNotes = String(body.internalNotes).trim();
  if (body.status !== undefined) fields.status = body.status;

  if (body.budget !== undefined) {
    fields.budget = { total: Number(body.budget) || 0, currency: (body.currency || 'USD').trim() || 'USD' };
  }

  const tz = body.timezone || 'Asia/Kolkata';
  if (body.timezone !== undefined) fields.timezone = tz;

  if (body.startDate !== undefined && body.startTime !== undefined) {
    fields.startDate = combineToUtc(body.startDate, body.startTime, tz);
  }
  if (body.endDate !== undefined && body.endTime !== undefined) {
    fields.endDate = combineToUtc(body.endDate, body.endTime, tz);
  }

  return fields;
}

// Shapes a Campaign document for API responses: adds the local
// date/time components (so the edit form can redisplay them in the
// campaign's own timezone rather than the browser's), and an
// isEligibleNow flag for future ad-delivery use.
function serialize(campaignDoc, statsMap) {
  const c = campaignDoc.toObject ? campaignDoc.toObject() : campaignDoc;
  const startLocal = splitFromUtc(c.startDate, c.timezone);
  const endLocal = splitFromUtc(c.endDate, c.timezone);
  const stats = (statsMap && statsMap.get(String(c._id))) || { impressions: 0, clicks: 0 };
  const ctr = stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0;
  // PART 10B: Estimated Revenue rides along with every campaign read
  // (list/getOne already compute `stats` here, so this is free) — Actual
  // Revenue always reports "no billing/payment data connected" (see
  // adRevenueService.getActualRevenue), never a number derived from
  // impressions/clicks.
  const estimatedRevenue = computeEstimatedRevenue(c, stats);
  const actualRevenue = getActualRevenue();
  return {
    ...c,
    startDateLocal: startLocal.date,
    startTimeLocal: startLocal.time,
    endDateLocal: endLocal.date,
    endTimeLocal: endLocal.time,
    isEligibleNow: isEligibleNow(c),
    impressions: stats.impressions,
    clicks: stats.clicks,
    ctr: Math.round(ctr * 100) / 100,
    revenue: { estimated: estimatedRevenue, actual: actualRevenue }
  };
}

async function statsMapFor(campaignIds) {
  if (!campaignIds.length) return new Map();
  const [impr, clicks] = await Promise.all([
    AdImpression.aggregate([{ $match: { campaign: { $in: campaignIds } } }, { $group: { _id: '$campaign', count: { $sum: 1 } } }]),
    AdClick.aggregate([{ $match: { campaign: { $in: campaignIds } } }, { $group: { _id: '$campaign', count: { $sum: 1 } } }])
  ]);
  const map = new Map();
  campaignIds.forEach((id) => map.set(String(id), { impressions: 0, clicks: 0 }));
  impr.forEach((r) => { map.get(String(r._id)).impressions = r.count; });
  clicks.forEach((r) => { map.get(String(r._id)).clicks = r.count; });
  return map;
}

async function uniqueCampaignCode() {
  // Small collection — a loop is fine and keeps this readable, same
  // reasoning as Advertiser's uniqueSlug().
  const count = await Campaign.countDocuments();
  let n = count + 1;
  let code = `CMP-${String(n).padStart(4, '0')}`;
  // eslint-disable-next-line no-await-in-loop
  while (await Campaign.exists({ campaignCode: code })) {
    n += 1;
    code = `CMP-${String(n).padStart(4, '0')}`;
  }
  return code;
}

/* =========================================================================
   ROUTES
========================================================================= */

// GET /api/campaigns?search=&status=&advertiser=
exports.list = async (req, res) => {
  try {
    await syncCampaignSchedules();

    const { search, status, advertiser } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (advertiser && mongoose.Types.ObjectId.isValid(advertiser)) filter.advertiser = advertiser;

    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { campaignCode: re }, { description: re }];
    }

    const campaigns = await Campaign.find(filter)
      .populate('advertiser', 'companyName status')
      .sort({ createdAt: -1 });

    const stats = await statsMapFor(campaigns.map((c) => c._id));
    res.json(campaigns.map((c) => serialize(c, stats)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/campaigns/:id
exports.getOne = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    await syncCampaignSchedules({ _id: req.params.id });

    const campaign = await Campaign.findById(req.params.id).populate('advertiser', 'companyName status');
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const stats = await statsMapFor([campaign._id]);
    res.json(serialize(campaign, stats));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/campaigns
exports.create = async (req, res) => {
  try {
    const errors = validatePayload(req.body);
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const advertiser = await Advertiser.findById(req.body.advertiser);
    if (!advertiser) return res.status(400).json({ message: 'Advertiser not found' });

    const campaignCode = await uniqueCampaignCode();
    const fields = buildFields(req.body);

    const campaign = await Campaign.create({
      ...fields,
      campaignCode,
      status: fields.status || 'draft'
    });

    await writeAudit({
      entityId: campaign._id,
      action: 'create',
      performedBy: req.user._id,
      changes: { name: campaign.name, campaignCode: campaign.campaignCode, advertiser: campaign.advertiser, status: campaign.status },
      notes: 'Campaign created'
    });

    // If it was created directly into a managed status whose window is
    // already open/closed (e.g. "Approved" with a start date in the
    // past), reflect that immediately rather than waiting for the next
    // list/getOne call to self-heal it.
    await syncCampaignSchedules({ _id: campaign._id });

    const populated = await Campaign.findById(campaign._id).populate('advertiser', 'companyName status');
    res.status(201).json(serialize(populated, new Map()));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A campaign with this code already exists — please retry' });
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/campaigns/:id
exports.update = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const errors = validatePayload(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    if (req.body.advertiser !== undefined) {
      const advertiser = await Advertiser.findById(req.body.advertiser);
      if (!advertiser) return res.status(400).json({ message: 'Advertiser not found' });
    }

    // The date/time combine needs both the date and time half of each
    // side; if only one of the pair was sent, fall back to the existing
    // stored local components for the other half so a partial edit still
    // produces a valid combined instant.
    const merged = { ...req.body };
    const tz = merged.timezone || campaign.timezone;
    if ((merged.startDate !== undefined) !== (merged.startTime !== undefined)) {
      const existingStart = splitFromUtc(campaign.startDate, tz);
      if (merged.startDate === undefined) merged.startDate = existingStart.date;
      if (merged.startTime === undefined) merged.startTime = existingStart.time;
    }
    if ((merged.endDate !== undefined) !== (merged.endTime !== undefined)) {
      const existingEnd = splitFromUtc(campaign.endDate, tz);
      if (merged.endDate === undefined) merged.endDate = existingEnd.date;
      if (merged.endTime === undefined) merged.endTime = existingEnd.time;
    }

    const fields = buildFields(merged);
    Object.assign(campaign, fields);

    await campaign.save();

    // Same reasoning as create(): an edit that changes status or dates
    // may immediately put the campaign inside/outside its eligibility
    // window, so resync before responding rather than showing a status
    // that's stale until the next read.
    await syncCampaignSchedules({ _id: campaign._id });

    const populated = await Campaign.findById(campaign._id).populate('advertiser', 'companyName status');
    const stats = await statsMapFor([campaign._id]);
    res.json(serialize(populated, stats));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/campaigns/:id/status  { status }
// Dedicated endpoint for list-row quick actions (Pause / Resume / Cancel).
exports.updateStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    if (!ALL_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ message: 'status is not a recognized value' });
    }
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true })
      .populate('advertiser', 'companyName status');
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    // Re-run the schedule engine immediately so, e.g., resuming a paused
    // campaign whose window already passed comes back as "expired"
    // rather than briefly showing a stale "approved"/"scheduled" state.
    await syncCampaignSchedules({ _id: campaign._id });
    const fresh = await Campaign.findById(campaign._id).populate('advertiser', 'companyName status');
    const stats = await statsMapFor([campaign._id]);
    res.json(serialize(fresh, stats));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/campaigns/:id
exports.remove = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    const adCount = await Advertisement.countDocuments({ campaign: req.params.id });
    if (adCount > 0) {
      return res.status(409).json({
        message: `Cannot delete: ${adCount} advertisement(s) reference this campaign. Cancel it instead to preserve history.`
      });
    }
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/campaigns/meta/options
// Lets the console populate the Timezone / Status / Pricing Model
// selects from the same lists the backend validates against.
exports.options = (req, res) => {
  res.json({
    timezones: TIMEZONES,
    statuses: ALL_STATUSES,
    pricingModels: PRICING_MODELS,
    // PART 10B: Advertising Pricing config vocabulary — kept alongside
    // (not merged into) the legacy `pricingModels` above, since that key
    // already means something else to existing callers.
    adPricingModels: AD_PRICING_MODELS,
    currencies: CURRENCIES,
    billingPeriods: BILLING_PERIODS,
    modelBillingPeriods: MODEL_BILLING_PERIODS
  });
};

/* =========================================================================
   PART 10B: PRICING MANAGEMENT
   Pricing is a nested config on the Campaign document (see
   models/Campaign.js `pricing`), not a separate collection — there's
   exactly one pricing config per campaign, so a child document with its
   own _id/collection would be pure overhead here. View/Add/Edit all
   share one PUT endpoint (upsert-in-place); Remove clears the config
   back to "not configured" rather than deleting the campaign field.
========================================================================= */

// GET /api/campaigns/:id/pricing
exports.getPricing = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    const campaign = await Campaign.findById(req.params.id).select('pricing name campaignCode');
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const configured = !!(campaign.pricing && campaign.pricing.model);
    res.json({
      configured,
      pricing: configured ? campaign.pricing : null,
      message: configured ? undefined : 'Pricing not configured'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/campaigns/:id/pricing
// Body: { model, rate, currency, billingPeriod, includedImpressions, includedClicks, notes }
// Acts as both "Add" and "Edit" — a campaign has exactly one pricing
// config, so setting it when none exists IS adding it.
exports.updatePricing = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const errors = validatePricingPayload(req.body);
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const before = campaign.pricing ? JSON.parse(JSON.stringify(campaign.pricing)) : null;

    campaign.pricing = {
      model: req.body.model,
      rate: Number(req.body.rate),
      currency: req.body.currency,
      billingPeriod: req.body.billingPeriod,
      includedImpressions: req.body.includedImpressions !== undefined && req.body.includedImpressions !== ''
        ? Math.max(0, Math.floor(Number(req.body.includedImpressions) || 0)) : 0,
      includedClicks: req.body.includedClicks !== undefined && req.body.includedClicks !== ''
        ? Math.max(0, Math.floor(Number(req.body.includedClicks) || 0)) : 0,
      notes: req.body.notes !== undefined ? String(req.body.notes).trim() : (before ? before.notes : ''),
      configuredBy: req.user && req.user._id,
      configuredAt: new Date()
    };

    await campaign.save();

    await writeAudit({
      entityId: campaign._id,
      action: before ? 'update' : 'create',
      performedBy: req.user && req.user._id,
      changes: { before, after: JSON.parse(JSON.stringify(campaign.pricing)) },
      notes: 'Advertising pricing ' + (before ? 'updated' : 'created')
    });

    res.json({ configured: true, pricing: campaign.pricing });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/campaigns/:id/pricing
// Only clears the pricing config back to "not configured" — never
// deletes the campaign, its analytics, or its audit history. Always
// permitted for an authorized console user: removing a pricing
// configuration doesn't orphan any other record (advertisements,
// impressions and clicks all keep working; they simply stop having an
// Estimated Revenue figure, same as a campaign that never had pricing
// configured in the first place).
exports.removePricing = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    if (!campaign.pricing || !campaign.pricing.model) {
      return res.status(404).json({ message: 'Pricing not configured' });
    }

    const before = JSON.parse(JSON.stringify(campaign.pricing));
    campaign.pricing = {
      model: null, rate: null, currency: null, billingPeriod: null,
      includedImpressions: 0, includedClicks: 0, notes: '',
      configuredBy: null, configuredAt: null
    };
    await campaign.save();

    await writeAudit({
      entityId: campaign._id,
      action: 'delete',
      performedBy: req.user && req.user._id,
      changes: { before, after: null },
      notes: 'Advertising pricing removed'
    });

    res.json({ message: 'Pricing removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================================
   PART 10B: REVENUE
   Read-only. Estimated Revenue = real pricing config + real analytics
   (see services/adRevenueService.js). Actual Revenue always reports
   "unavailable" in this codebase — there is no billing/payment/invoice
   data source to read it from, and this endpoint will never derive one
   from impressions/clicks.
========================================================================= */

// GET /api/campaigns/:id/revenue
exports.getRevenue = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid campaign id' });
    }
    const campaign = await Campaign.findById(req.params.id).select('pricing startDate endDate name campaignCode');
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const stats = await statsMapFor([campaign._id]);
    const campaignStats = stats.get(String(campaign._id)) || { impressions: 0, clicks: 0 };

    const estimated = computeEstimatedRevenue(campaign, campaignStats);
    const actual = getActualRevenue();

    res.json({
      campaign: { _id: campaign._id, name: campaign.name, campaignCode: campaign.campaignCode },
      pricing: campaign.pricing && campaign.pricing.model ? campaign.pricing : null,
      impressionsUsed: campaignStats.impressions,
      clicksUsed: campaignStats.clicks,
      estimatedRevenue: estimated,
      actualRevenue: actual
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PART 10B: exported so the Advertising Analytics dashboard's "Active
// Campaigns" card can self-heal schedules the exact same way this
// controller's own read paths already do, instead of inventing a second
// definition of "active" or trusting a possibly-stale `status` field.
exports.syncCampaignSchedules = syncCampaignSchedules;

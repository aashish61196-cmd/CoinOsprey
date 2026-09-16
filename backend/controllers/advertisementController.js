const mongoose = require('mongoose');
const Advertisement = require('../models/Advertisement');
const Advertiser = require('../models/Advertiser');
const Campaign = require('../models/Campaign');
const AdPlacement = require('../models/AdPlacement');
const AdCreative = require('../models/AdCreative');
const AdImpression = require('../models/AdImpression');
const AdClick = require('../models/AdClick');
const AdAuditLog = require('../models/AdAuditLog');
const AdSetting = require('../models/AdSetting');
const { TIMEZONES, isValidTimezone } = require('../utils/timezone');
const { validateDestinationUrl } = require('../utils/urlValidation');
const {
  ADVERTISEMENT_TYPES,
  ADVERTISEMENT_STATUSES,
  PAGE_TARGETING_KEYS,
  DEVICE_TARGETING_VALUES,
  LANGUAGE_TARGETING_VALUES,
  canTransitionStatus,
  validateAdvertiserForActivation,
  validateCampaignForAdvertisement,
  validateScheduleWithinCampaign,
  checkCreativePlacementCompatibility,
  validatePriority,
  validateTargeting,
  computeCtr
} = require('../utils/advertisementLogic');
const { getAdvertisement } = require('../services/advertisementDeliveryService');
const {
  trackAdvertisementImpression,
  trackAdvertisementClick,
  resolveClickDestination,
  appendAdvertisingUtm
} = require('../services/advertisementAnalyticsService');
// PART 10B: no circular dependency — campaignController never requires
// this file back. Reused so "Active Campaigns" self-heals its schedule
// the exact same way the Campaigns list page already does, rather than
// this file inventing a second copy of that engine.
const { syncCampaignSchedules } = require('./campaignController');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Fields a currently-Active ad can never have changed without going back
// through review first (PART 7A-2 spec item 7).
const DELIVERY_CRITICAL_FIELDS = ['placements', 'creatives', 'targeting', 'schedule', 'destinationUrl', 'advertiser', 'campaign'];

// Statuses a Campaign must already be in for an Advertisement under it to
// go live — mirrors NON_ACTIVATABLE_CAMPAIGN_STATUSES from the logic layer
// but also excludes campaigns that haven't cleared review yet.
const CAMPAIGN_ACTIVATION_STATUSES = ['approved', 'scheduled', 'active', 'paused'];

/* =========================================================================
   SELF-HEALING SCHEDULE ENGINE
   Same "recompute + persist on every read" approach campaignController
   already uses (this project has no cron/queue) — an Advertisement moves
   scheduled -> active the instant its startDate is read past, and
   (scheduled|active|paused) -> expired the instant its endDate is read
   past, without a background job. This is what satisfies spec item 11
   (EXPIRE HANDLING) and half of item 10 (SCHEDULE ACTION).
   Not audited: this is a system-computed reflection of the clock, not an
   admin action — same reasoning campaignController's engine already uses.
========================================================================= */
const MANAGED_STATUSES = ['scheduled', 'active', 'paused'];

function computeManagedStatus(ad, now) {
  if (!MANAGED_STATUSES.includes(ad.status)) return ad.status;
  if (now > ad.schedule.endDate) return 'expired';
  if (ad.status === 'scheduled' && now >= ad.schedule.startDate) return 'active';
  return ad.status;
}

async function syncAdvertisementSchedules(extraFilter = {}) {
  const now = new Date();
  const candidates = await Advertisement.find({ status: { $in: MANAGED_STATUSES }, ...extraFilter }).select('status schedule');
  const ops = [];
  candidates.forEach((ad) => {
    const next = computeManagedStatus(ad, now);
    if (next !== ad.status) ops.push({ updateOne: { filter: { _id: ad._id }, update: { status: next } } });
  });
  if (ops.length) await Advertisement.bulkWrite(ops);
}

// Exported so other read paths that need Advertisement's status to be
// clock-accurate before querying can reuse this exact self-heal step
// instead of re-deriving it — same precedent campaignController already
// sets for syncCampaignSchedules (see campaignController.js). PART 12A's
// inventory service/controller is the first consumer of this.
exports.syncAdvertisementSchedules = syncAdvertisementSchedules;

/* =========================================================================
   AUDIT LOGGING
   One shared writer so every action logs the same shape (spec item 18).
   Never allowed to block the primary action — a failed audit write is
   logged server-side and swallowed, same as any other "best effort"
   secondary write in this project.
========================================================================= */
async function writeAudit({ entityId, action, performedBy, changes = {}, notes = '' }) {
  try {
    await AdAuditLog.create({ entityType: 'Advertisement', entityId, action, performedBy, changes, notes });
  } catch (err) {
    console.error('AdAuditLog write failed:', err.message);
  }
}

// Shallow before/after diff for the fields actually being changed. Kept
// shallow on purpose — this is an internal admin trail (AdAuditLog.changes
// is Mixed), not a full document snapshot system.
function diffChanges(beforeDoc, fields) {
  const changes = {};
  Object.keys(fields).forEach((key) => {
    changes[key] = { from: beforeDoc[key], to: fields[key] };
  });
  return changes;
}

/* =========================================================================
   CENTRALIZED STATUS-TRANSITION SERVICE (spec item 16)
   Every action below (activate/pause/schedule/archive) calls into this
   instead of setting `ad.status` directly, so the allow-list in
   advertisementLogic.STATUS_TRANSITIONS is enforced in exactly one place.
========================================================================= */
async function transitionAdvertisementStatus(ad, targetStatus, actor, { auditAction, notes = '' } = {}) {
  if (!canTransitionStatus(ad.status, targetStatus)) {
    const err = new Error(`Cannot transition advertisement from "${ad.status}" to "${targetStatus}"`);
    err.statusCode = 409;
    throw err;
  }
  const from = ad.status;
  ad.status = targetStatus;
  ad.updatedBy = actor._id;
  await ad.save();
  await writeAudit({
    entityId: ad._id,
    action: auditAction || 'update',
    performedBy: actor._id,
    changes: { status: { from, to: targetStatus } },
    notes
  });
  return ad;
}

/* =========================================================================
   VALIDATION (create + update share this)
   Async because it needs to fetch the referenced Advertiser/Campaign/
   Placement/Creative documents — pure rule-checking itself still lives in
   utils/advertisementLogic.js; this just does the I/O + wires the rules
   together, same division of labor as campaignController.
========================================================================= */
async function validateAndResolve(body, { partial = false, existing = null } = {}) {
  const errors = [];
  const resolved = {};

  if (!partial) {
    ['name', 'advertiser', 'campaign', 'destinationUrl'].forEach((f) => {
      if (body[f] === undefined || body[f] === null || String(body[f]).trim() === '') errors.push(`${f} is required`);
    });
    if (!body.schedule || !body.schedule.startDate || !body.schedule.endDate) {
      errors.push('schedule.startDate and schedule.endDate are required');
    }
  }

  if (body.type !== undefined && body.type !== '' && !ADVERTISEMENT_TYPES.includes(body.type)) {
    errors.push('type is not a recognized value');
  }

  // --- advertiser ---
  if (body.advertiser !== undefined) {
    if (!isValidId(body.advertiser)) {
      errors.push('advertiser is not a valid id');
    } else {
      resolved.advertiser = await Advertiser.findById(body.advertiser);
      if (!resolved.advertiser) errors.push('advertiser not found');
    }
  } else if (existing) {
    resolved.advertiser = await Advertiser.findById(existing.advertiser);
  }

  // --- campaign ---
  if (body.campaign !== undefined) {
    if (!isValidId(body.campaign)) {
      errors.push('campaign is not a valid id');
    } else {
      resolved.campaign = await Campaign.findById(body.campaign);
      if (!resolved.campaign) errors.push('campaign not found');
    }
  } else if (existing) {
    resolved.campaign = await Campaign.findById(existing.campaign);
  }

  if (resolved.advertiser && resolved.campaign) {
    errors.push(...validateCampaignForAdvertisement(resolved.campaign, resolved.advertiser._id));
  }

  // --- placements ---
  if (body.placements !== undefined) {
    if (!Array.isArray(body.placements)) {
      errors.push('placements must be an array');
    } else if (body.placements.some((id) => !isValidId(id))) {
      errors.push('placements contains an invalid id');
    } else {
      resolved.placements = await AdPlacement.find({ _id: { $in: body.placements } });
      if (resolved.placements.length !== new Set(body.placements.map(String)).size) {
        errors.push('one or more placements not found');
      }
    }
  } else if (existing) {
    resolved.placements = await AdPlacement.find({ _id: { $in: existing.placements } });
  }

  // --- creatives ---
  if (body.creatives !== undefined) {
    if (!Array.isArray(body.creatives)) {
      errors.push('creatives must be an array');
    } else if (body.creatives.some((id) => !isValidId(id))) {
      errors.push('creatives contains an invalid id');
    } else {
      resolved.creatives = await AdCreative.find({ _id: { $in: body.creatives } });
      if (resolved.creatives.length !== new Set(body.creatives.map(String)).size) {
        errors.push('one or more creatives not found');
      }
    }
  } else if (existing) {
    resolved.creatives = await AdCreative.find({ _id: { $in: existing.creatives } });
  }

  // Compatibility is only meaningful once both sides exist. A Draft is
  // allowed to have placements assigned before any creative is uploaded
  // (or vice versa) — full compatibility is enforced as a hard gate at
  // Activate/Schedule time instead (see runActivationChecks).
  if (resolved.placements && resolved.placements.length && resolved.creatives && resolved.creatives.length) {
    resolved.placements.forEach((pl) => {
      resolved.creatives.forEach((cr) => {
        checkCreativePlacementCompatibility(cr, pl).forEach((e) => errors.push(`[${pl.name} / ${cr.name}] ${e}`));
      });
    });
  }

  // --- destination URL ---
  if (body.destinationUrl !== undefined) {
    const r = validateDestinationUrl(body.destinationUrl);
    if (!r.ok) errors.push(r.error); else resolved.destinationUrl = r.url;
  }

  // --- scheduling / timezone ---
  if (body.schedule && body.schedule.timezone !== undefined && body.schedule.timezone !== '' && !isValidTimezone(body.schedule.timezone)) {
    errors.push('schedule.timezone is not a recognized value');
  }
  if (body.schedule && (body.schedule.startDate !== undefined || body.schedule.endDate !== undefined || body.schedule.timezone !== undefined)) {
    let configuredTimezone = 'Asia/Kolkata';
    if (!existing && !body.schedule.timezone) {
      const adSettings = await AdSetting.findOne({ key: 'global' }).select('defaultTimezone');
      if (adSettings && adSettings.defaultTimezone) configuredTimezone = adSettings.defaultTimezone;
    }
    const tz = body.schedule.timezone || (existing && existing.schedule.timezone) || configuredTimezone;
    const startDate = body.schedule.startDate !== undefined ? new Date(body.schedule.startDate) : existing && existing.schedule.startDate;
    const endDate = body.schedule.endDate !== undefined ? new Date(body.schedule.endDate) : existing && existing.schedule.endDate;

    if (!startDate || Number.isNaN(startDate.getTime())) errors.push('schedule.startDate is not a valid date');
    if (!endDate || Number.isNaN(endDate.getTime())) errors.push('schedule.endDate is not a valid date');

    if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      if (endDate <= startDate) errors.push('schedule.endDate must be after schedule.startDate');
      if (resolved.campaign) errors.push(...validateScheduleWithinCampaign(startDate, endDate, resolved.campaign));
      resolved.schedule = { startDate, endDate, timezone: tz };
    }
  }

  // --- priority ---
  if (body.priority !== undefined) errors.push(...validatePriority(body.priority));

  // --- targeting ---
  if (body.targeting !== undefined) errors.push(...validateTargeting(body.targeting, isValidId));

  return { errors, resolved };
}

// Explicit field whitelist — status/approval/createdBy/updatedBy/analytics
// are NEVER accepted from the client (spec item 23: mass-assignment
// protection). Status changes only ever happen via the dedicated action
// endpoints below, each gated by transitionAdvertisementStatus().
function buildFields(body, resolved) {
  const fields = {};
  if (body.name !== undefined) fields.name = String(body.name).trim();
  if (body.advertiser !== undefined) fields.advertiser = body.advertiser;
  if (body.campaign !== undefined) fields.campaign = body.campaign;
  if (body.type !== undefined) fields.type = body.type;
  if (body.placements !== undefined) fields.placements = body.placements;
  if (body.creatives !== undefined) fields.creatives = body.creatives;
  if (resolved.destinationUrl !== undefined) fields.destinationUrl = resolved.destinationUrl;
  if (body.openInNewTab !== undefined) fields.openInNewTab = !!body.openInNewTab;
  if (resolved.schedule !== undefined) fields.schedule = resolved.schedule;
  if (body.priority !== undefined) fields.priority = Number(body.priority);
  if (body.rotationWeight !== undefined) fields.rotationWeight = Math.max(0, Number(body.rotationWeight) || 0);
  if (body.frequencyCap !== undefined) {
    fields.frequencyCap = {
      maxImpressions: Math.max(0, Math.floor(Number(body.frequencyCap.maxImpressions) || 0)),
      per: ['session', 'day', 'week'].includes(body.frequencyCap.per) ? body.frequencyCap.per : 'day'
    };
  }
  if (body.targeting !== undefined) fields.targeting = body.targeting;
  if (body.internalNotes !== undefined) fields.internalNotes = String(body.internalNotes).trim();
  return fields;
}

/* =========================================================================
   ACTIVATION ELIGIBILITY (spec item 8) — shared by Activate/Resume and
   Schedule, since both need the same "is this actually servable" bar.
========================================================================= */
async function runActivationChecks(ad) {
  const errors = [];

  const advertiser = await Advertiser.findById(ad.advertiser);
  errors.push(...validateAdvertiserForActivation(advertiser));

  if (ad.campaign) {
    const campaign = await Campaign.findById(ad.campaign);
    errors.push(...validateCampaignForAdvertisement(campaign, ad.advertiser));
    if (campaign && !CAMPAIGN_ACTIVATION_STATUSES.includes(campaign.status)) {
      errors.push(`campaign status "${campaign.status}" is not eligible for activation`);
    }
  }

  if (!ad.placements || !ad.placements.length) errors.push('advertisement has no placement assigned');
  if (!ad.creatives || !ad.creatives.length) errors.push('advertisement has no creative assigned');

  const placements = await AdPlacement.find({ _id: { $in: ad.placements } });
  const creatives = await AdCreative.find({ _id: { $in: ad.creatives } });
  if (placements.length !== ad.placements.length) errors.push('one or more assigned placements no longer exist');
  if (creatives.length !== ad.creatives.length) errors.push('one or more assigned creatives no longer exist');

  placements.forEach((pl) => {
    if (pl.active === false) errors.push(`placement "${pl.name}" is not active`);
    creatives.forEach((cr) => {
      checkCreativePlacementCompatibility(cr, pl).forEach((e) => errors.push(`[${pl.name}] ${e}`));
    });
  });

  const urlCheck = validateDestinationUrl(ad.destinationUrl);
  if (!urlCheck.ok) errors.push(urlCheck.error);

  const now = new Date();
  if (!ad.schedule || !ad.schedule.startDate || !ad.schedule.endDate) {
    errors.push('advertisement schedule is incomplete');
  } else if (ad.schedule.endDate <= ad.schedule.startDate) {
    errors.push('advertisement schedule end date must be after start date');
  } else if (now > ad.schedule.endDate) {
    errors.push('advertisement schedule has already ended');
  }

  errors.push(...validateTargeting(ad.targeting, isValidId));

  if (!ad.approval || ad.approval.status !== 'approved') {
    errors.push('advertisement does not have required approval');
  }

  return errors;
}

/* =========================================================================
   PART 12A — APPROVAL ELIGIBILITY (spec item 4)
   Deliberately separate from runActivationChecks above: that function's
   whole point is "has this already been signed off AND is it still safe
   to go live", so it hard-requires approval.status === 'approved' — which
   would make it circular if reused for the approve action itself (the ad
   is not approved yet; that's what this endpoint is deciding). This
   function answers "is there enough here for a reviewer to approve",
   reusing the exact same underlying rule functions
   (validateCampaignForAdvertisement / validateAdvertiserForActivation /
   checkCreativePlacementCompatibility / validateDestinationUrl /
   validateTargeting) so the two checks can never quietly disagree about
   what "valid" means — only what's mandatory at each stage differs.
   Errors are split into `missing` (an attached record doesn't exist at
   all) vs. `detail` (it exists but fails a rule) so the response can
   match the spec's example shape ("Cannot approve advertisement.
   Missing: - Creative - Placement").
========================================================================= */
async function runApprovalChecks(ad) {
  const missing = [];
  const detail = [];

  // --- advertiser ---
  const advertiser = ad.advertiser ? await Advertiser.findById(ad.advertiser) : null;
  if (!advertiser) missing.push('Advertiser');
  else detail.push(...validateAdvertiserForActivation(advertiser));

  // --- campaign ---
  const campaign = ad.campaign ? await Campaign.findById(ad.campaign) : null;
  if (!campaign) {
    missing.push('Campaign');
  } else {
    detail.push(...validateCampaignForAdvertisement(campaign, ad.advertiser));
    if (!campaign.startDate || !campaign.endDate || !(new Date(campaign.startDate) < new Date(campaign.endDate))) {
      detail.push('campaign dates are invalid: startDate must be before endDate');
    }
    if (ad.schedule && ad.schedule.startDate && ad.schedule.endDate) {
      detail.push(...validateScheduleWithinCampaign(ad.schedule.startDate, ad.schedule.endDate, campaign));
    }
  }

  // --- placements ---
  let placements = [];
  if (!ad.placements || !ad.placements.length) {
    missing.push('Placement');
  } else {
    placements = await AdPlacement.find({ _id: { $in: ad.placements } });
    if (placements.length !== ad.placements.length) missing.push('Placement');
    placements.forEach((pl) => { if (pl.active === false) detail.push(`placement "${pl.name}" is not enabled`); });
  }

  // --- creatives ---
  let creatives = [];
  if (!ad.creatives || !ad.creatives.length) {
    missing.push('Creative');
  } else {
    creatives = await AdCreative.find({ _id: { $in: ad.creatives } });
    if (creatives.length !== ad.creatives.length) missing.push('Creative');
  }

  // --- placement/creative compatibility (only meaningful once both exist) ---
  if (placements.length && creatives.length) {
    placements.forEach((pl) => {
      creatives.forEach((cr) => {
        checkCreativePlacementCompatibility(cr, pl).forEach((e) => detail.push(`[${pl.name} / ${cr.name}] ${e}`));
      });
    });
  }

  // --- destination URL (spec item 12: URL security policy) ---
  const urlCheck = validateDestinationUrl(ad.destinationUrl);
  if (!urlCheck.ok) detail.push(urlCheck.error);

  // --- schedule ---
  if (!ad.schedule || !ad.schedule.startDate || !ad.schedule.endDate) {
    missing.push('Schedule');
  } else if (!(new Date(ad.schedule.endDate) > new Date(ad.schedule.startDate))) {
    detail.push('schedule end date must be after start date');
  }

  // --- targeting ---
  detail.push(...validateTargeting(ad.targeting, isValidId));

  return { missing, detail };
}

/* =========================================================================
   ANALYTICS (spec item 19) — read-only aggregation against the existing
   AdImpression/AdClick collections. Nothing here ever writes an
   impression/click; admin console reads (list/getOne) never count as one.
========================================================================= */
async function statsMapFor(adIds) {
  const map = new Map();
  adIds.forEach((id) => map.set(String(id), { impressions: 0, clicks: 0 }));
  if (!adIds.length) return map;

  const [impr, clicks] = await Promise.all([
    AdImpression.aggregate([{ $match: { advertisement: { $in: adIds } } }, { $group: { _id: '$advertisement', count: { $sum: 1 } } }]),
    AdClick.aggregate([{ $match: { advertisement: { $in: adIds } } }, { $group: { _id: '$advertisement', count: { $sum: 1 } } }])
  ]);
  impr.forEach((r) => { map.get(String(r._id)).impressions = r.count; });
  clicks.forEach((r) => { map.get(String(r._id)).clicks = r.count; });
  return map;
}

/* =========================================================================
   SERIALIZATION
========================================================================= */
function serializeListItem(adDoc, statsMap) {
  const a = adDoc.toObject ? adDoc.toObject() : adDoc;
  const stat = statsMap.get(String(a._id)) || { impressions: 0, clicks: 0 };
  return {
    _id: a._id,
    name: a.name,
    advertiser: a.advertiser,
    campaign: a.campaign,
    placements: a.placements,
    type: a.type,
    status: a.status,
    // PART 12A: the list/action-menu UI needs approval.status/rejectionReason
    // to show a "Rejected" tag and Resubmit hint for a draft that was
    // specifically rejected, as opposed to one that's simply new.
    approval: a.approval ? { status: a.approval.status, rejectionReason: a.approval.rejectionReason, notes: a.approval.notes, reviewedAt: a.approval.reviewedAt } : null,
    startDate: a.schedule.startDate,
    endDate: a.schedule.endDate,
    priority: a.priority,
    impressions: stat.impressions,
    clicks: stat.clicks,
    ctr: computeCtr(stat.impressions, stat.clicks)
  };
}

function serializeDetail(adDoc, statsMap = new Map(), auditLogs = []) {
  const a = adDoc.toObject ? adDoc.toObject() : adDoc;
  const stat = statsMap.get(String(a._id)) || { impressions: 0, clicks: 0 };
  return {
    ...a,
    impressions: stat.impressions,
    clicks: stat.clicks,
    ctr: computeCtr(stat.impressions, stat.clicks),
    auditLog: auditLogs.map((l) => ({
      action: l.action,
      performedBy: l.performedBy ? { name: l.performedBy.name, email: l.performedBy.email } : null,
      changes: l.changes,
      notes: l.notes,
      at: l.createdAt
    }))
  };
}

const DETAIL_POPULATE = [
  { path: 'advertiser', select: 'companyName status industry' }, // no email/phone/billing here — item 4
  { path: 'campaign', select: 'name campaignCode status startDate endDate' },
  { path: 'placements', select: 'name key device active recommendedDimensions' },
  { path: 'creatives', select: 'name status desktop mobile' },
  // PART 12A-2: surfaces who reviewed an advertisement (spec items 9/19 —
  // "Reviewed by" / "Reviewed at"). reviewedBy/reviewedAt were already
  // written by approve/reject in Part 12A-1; this just makes the existing
  // field readable as a name instead of a bare ObjectId. No new field,
  // no new audit system — reuses the same approval sub-document.
  { path: 'approval.reviewedBy', select: 'name email' }
];

/* =========================================================================
   ROUTES
========================================================================= */

// GET /api/advertisements?search=&status=&advertiser=&campaign=&placement=
//   &type=&device=&language=&startDate=&endDate=&page=&limit=&sortBy=&sortDir=
exports.list = async (req, res) => {
  try {
    await syncAdvertisementSchedules();

    const {
      search, status, advertiser, campaign, placement, type, device, language,
      startDate, endDate, page = 1, limit = 25, sortBy = 'createdAt', sortDir = 'desc'
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (advertiser && isValidId(advertiser)) filter.advertiser = advertiser;
    if (campaign && isValidId(campaign)) filter.campaign = campaign;
    if (placement && isValidId(placement)) filter.placements = placement;
    if (type) filter.type = type;

    const andClauses = [];
    if (device) andClauses.push({ $or: [{ 'targeting.devices': { $size: 0 } }, { 'targeting.devices': device }] });
    if (language) andClauses.push({ $or: [{ 'targeting.languages': { $size: 0 } }, { 'targeting.languages': language }] });
    if (andClauses.length) filter.$and = andClauses;

    if (startDate || endDate) {
      const range = {};
      if (startDate) range.$gte = new Date(startDate);
      if (endDate) range.$lte = new Date(endDate);
      filter['schedule.startDate'] = range;
    }

    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const [advIds, campIds] = await Promise.all([
        Advertiser.find({ companyName: re }).select('_id'),
        Campaign.find({ name: re }).select('_id')
      ]);
      filter.$or = [
        { name: re },
        { destinationUrl: re },
        { advertiser: { $in: advIds.map((a) => a._id) } },
        { campaign: { $in: campIds.map((c) => c._id) } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    // NOTE: impressions/clicks/ctr are computed from a separate collection
    // (not stored on Advertisement), so sorting by them would require a
    // full aggregation pipeline rather than a plain query sort. Only
    // schema fields are sortable server-side for now — a documented
    // limitation, see the completion report.
    const sortableFields = ['createdAt', 'name', 'status', 'priority', 'schedule.startDate', 'schedule.endDate'];
    const sortField = sortableFields.includes(sortBy) ? sortBy : 'createdAt';
    const sort = { [sortField]: sortDir === 'asc' ? 1 : -1 };

    const [total, ads] = await Promise.all([
      Advertisement.countDocuments(filter),
      Advertisement.find(filter)
        .select('name status type advertiser campaign placements schedule priority destinationUrl approval')
        .populate('advertiser', 'companyName')
        .populate('campaign', 'name campaignCode')
        .populate('placements', 'name key')
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
    ]);

    const stats = await statsMapFor(ads.map((a) => a._id));

    res.json({
      data: ads.map((a) => serializeListItem(a, stats)),
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.max(1, Math.ceil(total / limitNum)) }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/advertisements/:id
exports.getOne = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    await syncAdvertisementSchedules({ _id: req.params.id });

    const ad = await Advertisement.findById(req.params.id).populate(DETAIL_POPULATE);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    const stats = await statsMapFor([ad._id]);
    const auditLogs = await AdAuditLog.find({ entityType: 'Advertisement', entityId: ad._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('performedBy', 'name email');

    res.json(serializeDetail(ad, stats, auditLogs));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/advertisements
exports.create = async (req, res) => {
  try {
    const { errors, resolved } = await validateAndResolve(req.body, { partial: false });
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const fields = buildFields(req.body, resolved);
    const adSettings = await AdSetting.findOne({ key: 'global' }).select('defaultAdvertisementStatus requireApprovalBeforeLive');
    const configuredDefault = adSettings && AdSetting.DEFAULT_AD_STATUS_VALUES.includes(adSettings.defaultAdvertisementStatus)
      ? adSettings.defaultAdvertisementStatus : 'draft';

    const ad = await Advertisement.create({
      ...fields,
      status: configuredDefault, // configurable safe default; never active
      approval: { status: 'pending' },
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await writeAudit({
      entityId: ad._id,
      action: 'create',
      performedBy: req.user._id,
      changes: { name: ad.name, advertiser: ad.advertiser, campaign: ad.campaign, status: ad.status }
    });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    res.status(201).json(serializeDetail(populated));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/advertisements/:id
exports.update = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    const { errors, resolved } = await validateAndResolve(req.body, { partial: true, existing: ad });
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const fields = buildFields(req.body, resolved);
    const before = ad.toObject();
    const wasActive = before.status === 'active';
    const criticalChanged = DELIVERY_CRITICAL_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(fields, f));

    Object.assign(ad, fields);
    ad.updatedBy = req.user._id;

    // Spec item 7 — a delivery-critical edit to a live ad must go back
    // through approval rather than silently keep serving mid-edit.
    let reReviewed = false;
    if (wasActive && criticalChanged) {
      ad.status = 'pending_review';
      ad.approval = { status: 'pending' };
      reReviewed = true;
    }

    await ad.save();
    await syncAdvertisementSchedules({ _id: ad._id });

    await writeAudit({
      entityId: ad._id,
      action: 'update',
      performedBy: req.user._id,
      changes: diffChanges(before, fields),
      notes: reReviewed ? 'Delivery-critical field(s) changed on an Active advertisement — moved back to Pending Review.' : ''
    });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/activate  (also used for /:id/resume — see routes)
// Handles both "scheduled -> active" (first go-live) and "paused -> active"
// (resume), since both require the exact same eligibility bar.
exports.activate = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    if (!canTransitionStatus(ad.status, 'active')) {
      return res.status(409).json({ message: `Cannot activate advertisement: current status is "${ad.status}" (must be "scheduled" or "paused").` });
    }

    const errors = await runActivationChecks(ad);
    if (errors.length) return res.status(400).json({ message: `Cannot activate advertisement: ${errors.join('; ')}` });

    const auditAction = ad.status === 'paused' ? 'resume' : 'publish';
    await transitionAdvertisementStatus(ad, 'active', req.user, { auditAction });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// Shared by submitForReview and resubmit below (spec section 1: both
// "submitAdvertisementForReview(id)" and "resubmitAdvertisement(id)" are
// the exact same draft -> pending_review transition — a resubmission is
// just a submission that happens to follow a rejection). Resets the
// approval sub-document for the new review cycle so a prior REJECTED
// (or, defensively, a stale prior APPROVED) sign-off never carries over
// onto a submission the reviewer hasn't looked at yet.
async function submitAdvertisementForReview(ad, actor, auditAction) {
  if (!canTransitionStatus(ad.status, 'pending_review')) {
    const err = new Error(`Cannot submit for review: current status is "${ad.status}" (must be "draft").`);
    err.statusCode = 409;
    throw err;
  }
  ad.approval = { status: 'pending', reviewedBy: undefined, reviewedAt: undefined, rejectionReason: '', notes: '' };
  return transitionAdvertisementStatus(ad, 'pending_review', actor, { auditAction });
}

// PATCH /api/advertisements/:id/submit-for-review
// PART 7B-1 COMPATIBILITY ADDITION: the console's Create/Edit form needs a
// "Submit for Review" action (draft -> pending_review), and
// STATUS_TRANSITIONS already allows it, but no endpoint exposed it yet.
// Implemented the same way every other transition here is: through the
// single transitionAdvertisementStatus() service, so the allow-list in
// advertisementLogic.js remains the one place that decides validity.
exports.submitForReview = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    await submitAdvertisementForReview(ad, req.user, 'submit_for_review');

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/resubmit  (PART 12A, spec section 1/4)
// A REJECTED advertisement is DRAFT + approval.status === 'rejected' (see
// exports.reject below for why there's no separate top-level "rejected"
// status). Once the owner/editor has corrected it, this puts it back into
// review — functionally identical to submit-for-review, exposed under its
// own name/audit action per the spec's resubmitAdvertisement(id).
exports.resubmit = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    await submitAdvertisementForReview(ad, req.user, 'resubmit');

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/approve  (PART 12A, spec section 4)
// Route-level requirePermission('advertising.publish') is the
// authorization gate (spec item 9) — this handler assumes it already ran
// and focuses purely on "is this a valid transition, and is the record
// actually ready". Never trusts the client for anything beyond an
// optional adminNote.
exports.approve = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    if (!canTransitionStatus(ad.status, 'approved')) {
      return res.status(409).json({ message: `Cannot approve advertisement: current status is "${ad.status}" (must be "pending_review").` });
    }

    const { missing, detail } = await runApprovalChecks(ad);
    if (missing.length || detail.length) {
      const lines = [];
      if (missing.length) lines.push('Missing:', ...missing.map((m) => `- ${m}`));
      if (detail.length) lines.push('Issues:', ...detail.map((d) => `- ${d}`));
      return res.status(400).json({ message: `Cannot approve advertisement.\n${lines.join('\n')}` });
    }

    ad.approval = {
      status: 'approved',
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      rejectionReason: '',
      notes: req.body && req.body.adminNote !== undefined ? String(req.body.adminNote).trim() : (ad.approval && ad.approval.notes) || ''
    };
    await transitionAdvertisementStatus(ad, 'approved', req.user, { auditAction: 'approve' });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/reject  (PART 12A, spec sections 4/5)
// Requires rejectionReason (spec item 5's hard requirement — "Do not
// allow: rejected without a reason"); adminNote is optional. Rejection is
// modeled by moving `status` back to "draft" (already an allowed
// transition from "pending_review", see STATUS_TRANSITIONS) while
// approval.status/rejectionReason record the fact that this particular
// draft was specifically rejected, not just newly created — no duplicate
// top-level "rejected" status was introduced (spec item 2: "Do NOT create
// duplicate status fields").
exports.reject = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    const rejectionReason = req.body && req.body.rejectionReason ? String(req.body.rejectionReason).trim() : '';
    if (!rejectionReason) {
      return res.status(400).json({ message: 'rejectionReason is required to reject an advertisement.' });
    }

    if (!canTransitionStatus(ad.status, 'draft')) {
      return res.status(409).json({ message: `Cannot reject advertisement: current status is "${ad.status}" (must be "pending_review").` });
    }

    const adminNote = req.body && req.body.adminNote !== undefined ? String(req.body.adminNote).trim() : '';
    ad.approval = {
      status: 'rejected',
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      rejectionReason,
      notes: adminNote
    };
    await transitionAdvertisementStatus(ad, 'draft', req.user, {
      auditAction: 'reject',
      notes: adminNote ? `${rejectionReason} — ${adminNote}` : rejectionReason
    });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/pause
exports.pause = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    if (!canTransitionStatus(ad.status, 'paused')) {
      return res.status(409).json({ message: `Cannot pause advertisement: current status is "${ad.status}" (must be "active").` });
    }

    await transitionAdvertisementStatus(ad, 'paused', req.user, { auditAction: 'pause' });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/schedule
exports.schedule = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    if (!canTransitionStatus(ad.status, 'scheduled')) {
      return res.status(409).json({ message: `Cannot schedule advertisement: current status is "${ad.status}" (must be "approved").` });
    }

    const errors = await runActivationChecks(ad);
    if (errors.length) return res.status(400).json({ message: `Cannot schedule advertisement: ${errors.join('; ')}` });

    await transitionAdvertisementStatus(ad, 'scheduled', req.user, { auditAction: 'schedule' });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PATCH /api/advertisements/:id/archive
exports.archive = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    if (!canTransitionStatus(ad.status, 'archived')) {
      return res.status(409).json({
        message: `Cannot archive advertisement: current status is "${ad.status}". If it is currently Active or Paused, pause it and let it reach "expired" first, or wait for its schedule to end.`
      });
    }

    await transitionAdvertisementStatus(ad, 'archived', req.user, { auditAction: 'archive' });

    const populated = await Advertisement.findById(ad._id).populate(DETAIL_POPULATE);
    const stats = await statsMapFor([ad._id]);
    res.json(serializeDetail(populated, stats));
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// DELETE /api/advertisements/:id
// Safe-delete: only a still-Draft advertisement with zero recorded
// impressions/clicks can be hard-deleted. Anything else must be archived
// instead, to preserve analytics + audit history (spec item 13).
exports.remove = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    const [imprCount, clickCount] = await Promise.all([
      AdImpression.countDocuments({ advertisement: ad._id }),
      AdClick.countDocuments({ advertisement: ad._id })
    ]);

    if (ad.status !== 'draft' || imprCount > 0 || clickCount > 0) {
      return res.status(409).json({
        message: 'This advertisement has left Draft status or has recorded activity — archive it instead of deleting, to preserve analytics and audit history.'
      });
    }

    await writeAudit({ entityId: ad._id, action: 'delete', performedBy: req.user._id, changes: { name: ad.name, status: ad.status } });
    await Advertisement.findByIdAndDelete(ad._id);
    res.json({ message: 'Advertisement deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/advertisements/:id/duplicate
exports.duplicate = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });
    const original = await Advertisement.findById(req.params.id);
    if (!original) return res.status(404).json({ message: 'Advertisement not found' });

    const advertiser = await Advertiser.findById(original.advertiser);
    if (!advertiser) return res.status(400).json({ message: 'Cannot duplicate: the original advertiser no longer exists' });

    const campaign = await Campaign.findById(original.campaign);
    if (!campaign) return res.status(400).json({ message: 'Cannot duplicate: the original campaign no longer exists' });
    const campaignErrors = validateCampaignForAdvertisement(campaign, advertiser._id);
    if (campaignErrors.length) return res.status(400).json({ message: `Cannot duplicate: ${campaignErrors.join('; ')}` });

    // Silently drop any placement/creative refs that no longer exist,
    // rather than failing the whole duplicate — these are optional
    // relationships on the model (spec item 15).
    const [validPlacements, validCreatives] = await Promise.all([
      AdPlacement.find({ _id: { $in: original.placements } }).select('_id'),
      AdCreative.find({ _id: { $in: original.creatives } }).select('_id')
    ]);

    const originalPlain = original.toObject();
    const duplicateAd = await Advertisement.create({
      name: `${original.name} (Copy)`,
      advertiser: original.advertiser,
      campaign: original.campaign,
      type: original.type,
      placements: validPlacements.map((p) => p._id),
      creatives: validCreatives.map((c) => c._id),
      destinationUrl: original.destinationUrl,
      openInNewTab: original.openInNewTab,
      schedule: { ...originalPlain.schedule },
      priority: original.priority,
      rotationWeight: original.rotationWeight,
      frequencyCap: { ...originalPlain.frequencyCap },
      targeting: { ...originalPlain.targeting },
      internalNotes: original.internalNotes,
      status: 'draft', // never copies active/published state — spec item 14
      approval: { status: 'pending' },
      createdBy: req.user._id,
      updatedBy: req.user._id
    });
    // impressions/clicks/CTR/audit history are intentionally never copied —
    // they aren't stored on the document (computed from AdImpression/
    // AdClick), and AdAuditLog starts fresh for the new _id automatically.

    await writeAudit({
      entityId: duplicateAd._id,
      action: 'duplicate',
      performedBy: req.user._id,
      changes: { duplicatedFrom: original._id }
    });

    const populated = await Advertisement.findById(duplicateAd._id).populate(DETAIL_POPULATE);
    res.status(201).json(serializeDetail(populated));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// GET /api/advertisements/audit-log
// Read-only audit feed for the Advertising console. Supports entity/action/user
// filters and pagination without exposing arbitrary Mongo query operators.
exports.auditLog = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const filter = {};

    const allowedEntityTypes = ['Advertiser', 'Campaign', 'Advertisement', 'AdCreative', 'AdPlacement', 'AdSetting'];
    const allowedActions = [
      'create', 'update', 'delete', 'approve', 'reject', 'publish', 'pause', 'resume',
      'submit_for_review', 'resubmit', 'schedule', 'archive', 'duplicate',
      'activated', 'creative_upload', 'creative_replace', 'settings_changed'
    ];

    if (req.query.entityType) {
      if (!allowedEntityTypes.includes(req.query.entityType)) return res.status(400).json({ message: 'Invalid entityType' });
      filter.entityType = req.query.entityType;
    }
    if (req.query.action) {
      if (!allowedActions.includes(req.query.action)) return res.status(400).json({ message: 'Invalid action' });
      filter.action = req.query.action;
    }
    if (req.query.entityId) {
      if (!isValidId(req.query.entityId)) return res.status(400).json({ message: 'Invalid entityId' });
      filter.entityId = req.query.entityId;
    }
    if (req.query.performedBy) {
      if (!isValidId(req.query.performedBy)) return res.status(400).json({ message: 'Invalid performedBy' });
      filter.performedBy = req.query.performedBy;
    }

    const [items, total] = await Promise.all([
      AdAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('performedBy', 'name email role'),
      AdAuditLog.countDocuments(filter)
    ]);

    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/advertisements/:id/analytics  (spec item 11/19/22)
// Read-only breakdown for ONE advertisement — never loads the whole
// campaign/collection of AdImpression/AdClick documents, only the rows
// belonging to this ad._id (item 22). Overall impressions/clicks/CTR
// already exist via statsMapFor; this adds the placement/device/language
// splits the console's Analytics view needs, from the same two
// collections, with no separate "analytics" store and nothing faked
// (item 11: "Never generate fake values").
exports.analytics = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid advertisement id' });

    const ad = await Advertisement.findById(req.params.id).populate('placements', 'name key');
    if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

    const [
      overallImpr, overallClicks,
      byPlacementImpr, byPlacementClicks,
      byDeviceImpr, byDeviceClicks,
      byLangImpr, byLangClicks
    ] = await Promise.all([
      AdImpression.countDocuments({ advertisement: ad._id }),
      AdClick.countDocuments({ advertisement: ad._id }),
      AdImpression.aggregate([{ $match: { advertisement: ad._id } }, { $group: { _id: '$placement', count: { $sum: 1 } } }]),
      AdClick.aggregate([{ $match: { advertisement: ad._id } }, { $group: { _id: '$placement', count: { $sum: 1 } } }]),
      AdImpression.aggregate([{ $match: { advertisement: ad._id } }, { $group: { _id: '$device', count: { $sum: 1 } } }]),
      AdClick.aggregate([{ $match: { advertisement: ad._id } }, { $group: { _id: '$device', count: { $sum: 1 } } }]),
      AdImpression.aggregate([{ $match: { advertisement: ad._id } }, { $group: { _id: '$language', count: { $sum: 1 } } }]),
      AdClick.aggregate([{ $match: { advertisement: ad._id } }, { $group: { _id: '$language', count: { $sum: 1 } } }])
    ]);

    const placementNameById = new Map((ad.placements || []).map((p) => [String(p._id), p.name]));

    // Merges the impression-grouping and click-grouping for one dimension
    // into a single row set, keyed on the raw group value (placement id /
    // device string / language string) so a value with clicks but (in
    // theory) zero impressions still shows up.
    function mergeBreakdown(imprRows, clickRows, labelFor) {
      const map = new Map();
      imprRows.forEach((r) => {
        const key = String(r._id);
        map.set(key, { key, label: labelFor(r._id), impressions: r.count, clicks: 0 });
      });
      clickRows.forEach((r) => {
        const key = String(r._id);
        if (!map.has(key)) map.set(key, { key, label: labelFor(r._id), impressions: 0, clicks: 0 });
        map.get(key).clicks = r.count;
      });
      return Array.from(map.values())
        .map((row) => ({ label: row.label, impressions: row.impressions, clicks: row.clicks, ctr: computeCtr(row.impressions, row.clicks) }))
        .sort((a, b) => b.impressions - a.impressions);
    }

    res.json({
      _id: ad._id,
      name: ad.name,
      status: ad.status,
      startDate: ad.schedule.startDate,
      endDate: ad.schedule.endDate,
      impressions: overallImpr,
      clicks: overallClicks,
      ctr: computeCtr(overallImpr, overallClicks),
      byPlacement: mergeBreakdown(byPlacementImpr, byPlacementClicks, (id) => placementNameById.get(String(id)) || 'Unknown placement'),
      byDevice: mergeBreakdown(byDeviceImpr, byDeviceClicks, (id) => id || 'unknown'),
      byLanguage: mergeBreakdown(byLangImpr, byLangClicks, (id) => (id && String(id).trim()) || 'unspecified')
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/advertisements/deliver
// PART 8B: the single, minimal public integration point for the delivery
// engine (spec item 10 — no per-page ad-selection logic anywhere else,
// and no broad public-page rollout in this task). Public/unauthenticated
// on purpose: this is what a visitor's browser calls, not an admin
// action, so it deliberately sits outside this file's other routes'
// protect/adminOnly gate (see routes/advertisements.js).
exports.deliver = async (req, res) => {
  try {
    const { placement, page, url, categoryId, articleId, language, device } = req.query;
    const result = await getAdvertisement({ placement, page, url, categoryId, articleId, language, device });
    res.json(result);
  } catch (err) {
    // Mirrors getAdvertisement()'s own "never crash the public site"
    // guarantee at the HTTP layer too — a visitor's page render should
    // degrade to no ad, not a 500 with an internal stack trace.
    // eslint-disable-next-line no-console
    console.error('[advertisementController.deliver]', err.message);
    res.json({ status: 'empty', source: null, advertisement: null, placement: null, rotationMode: null, reason: 'internal_error' });
  }
};

/* =========================================================================
   PART 10A — ADVERTISING ANALYTICS TRACKING ENGINE
   Public, unauthenticated (visitors' own browsers call these — same
   reasoning as `deliver` above), and every write goes through
   advertisementAnalyticsService so the actual validation/dedup logic
   lives in exactly one place. These handlers only do HTTP plumbing:
   pull params out of the request, call the service, respond. They never
   report *why* an event wasn't counted beyond a generic ok — a visitor's
   browser has no legitimate use for "advertisement_not_live" vs
   "duplicate" vs "placement_mismatch", and exposing that distinction
   would just hand a would-be forger a debugging oracle (spec item 17).
========================================================================= */

// POST /api/advertisements/impression
// Body: { advertisementId, placementId, page?, language?, device?, eventId?, preview? }
exports.trackImpression = async (req, res) => {
  try {
    const { advertisementId, placementId, page, language, device, eventId, preview } = req.body || {};
    await trackAdvertisementImpression({ advertisementId, placementId, page, language, device, eventId, preview });
    // Always 204: whether or not it was actually counted (invalid ad,
    // duplicate, preview) is an internal decision, not an error the
    // caller needs to react to (spec item 18 — never break the page).
    res.status(204).end();
  } catch (err) {
    // Should be unreachable (trackAdvertisementImpression never throws),
    // but the HTTP layer still must not leak a 500 for a tracking pixel.
    res.status(204).end();
  }
};

// POST /api/advertisements/click
// Body: same shape as /impression. Used when the frontend fires a
// tracking beacon itself (e.g. navigator.sendBeacon) rather than going
// through the GET /click/:id redirect below — see ad-slot.js for which
// path is used when.
exports.trackClick = async (req, res) => {
  try {
    const { advertisementId, placementId, page, language, device, eventId, preview } = req.body || {};
    await trackAdvertisementClick({ advertisementId, placementId, page, language, device, eventId, preview });
    res.status(204).end();
  } catch (err) {
    res.status(204).end();
  }
};

// GET /api/advertisements/click/:id
// The project's tracking-redirect click path (spec item 5): validates +
// records the click, then 302s to the advertiser's destination. This is
// what an AdSlot link's href points at directly, so a click is recorded
// even if the visitor's browser has no JS running (or sendBeacon isn't
// available) by the time they click — the browser navigating to this URL
// is itself what records the click.
//
// destinationUrl is ALWAYS read from the Advertisement document — never
// from a query param — so this can never be used as an open redirector
// (spec item 17).
exports.clickRedirect = async (req, res) => {
  try {
    const { id } = req.params;
    const { placementId, page, language, device, eventId, preview } = req.query;

    const { destinationUrl } = await resolveClickDestination(id);
    if (!destinationUrl) {
      // Unknown/deleted advertisement — nothing safe to redirect to.
      return res.status(404).json({ message: 'Advertisement not found' });
    }

    // Best-effort: a tracking failure must never strand the visitor on
    // an error page instead of reaching the advertiser (spec item 18).
    try {
      await trackAdvertisementClick({ advertisementId: id, placementId, page, language, device, eventId, preview: preview === 'true' || preview === '1' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[advertisementController.clickRedirect] tracking failed:', err.message);
    }

    const settings = await AdSetting.findOne({ key: 'global' }).select('tracking.utmGeneration');
    const finalDestination = settings && settings.tracking && settings.tracking.utmGeneration === false
      ? destinationUrl : appendAdvertisingUtm(destinationUrl, id);
    return res.redirect(302, finalDestination);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[advertisementController.clickRedirect]', err.message);
    return res.status(500).json({ message: 'Unable to process click' });
  }
};

// GET /api/advertisements/meta/options
// Lets the (not-yet-built) console populate its selects from the exact
// same vocabularies the backend validates against.
exports.options = (req, res) => {
  res.json({
    types: ADVERTISEMENT_TYPES,
    statuses: ADVERTISEMENT_STATUSES,
    pageTargetingKeys: PAGE_TARGETING_KEYS,
    deviceTargetingValues: DEVICE_TARGETING_VALUES,
    languageTargetingValues: LANGUAGE_TARGETING_VALUES,
    timezones: TIMEZONES
  });
};

/* =========================================================================
   PART 10B — ADVERTISING ANALYTICS DASHBOARD
   Read-only aggregation for the Content Console's Advertising > Analytics
   page. Same collections as `analytics` above (AdImpression/AdClick) and
   the same statsMapFor/computeCtr helpers — this never re-implements CTR
   math or writes a tracking event, and it never loads raw event documents
   into Node: every number here comes from a MongoDB $group/$count stage,
   so the response size is bounded by the number of distinct
   advertisements/placements involved, not the number of impressions/clicks
   (spec item 10/18).
========================================================================= */

// Builds the shared Mongo match filter for AdImpression/AdClick from the
// dashboard's query params. advertiserId is the only dimension not
// denormalized onto the event documents, so it's resolved to a set of
// Advertisement ids first — every other filter matches a field the event
// already carries directly.
async function buildAnalyticsDashboardMatch(query) {
  const { startDate, endDate, advertiserId, campaignId, advertisementId, placementId, device, language, page } = query;
  const match = {};

  if (startDate || endDate) {
    match.occurredAt = {};
    if (startDate && !isNaN(Date.parse(startDate))) match.occurredAt.$gte = new Date(startDate);
    if (endDate && !isNaN(Date.parse(endDate))) match.occurredAt.$lte = new Date(endDate);
    if (!Object.keys(match.occurredAt).length) delete match.occurredAt;
  }

  if (advertisementId && isValidId(advertisementId)) match.advertisement = new mongoose.Types.ObjectId(advertisementId);
  if (placementId && isValidId(placementId)) match.placement = new mongoose.Types.ObjectId(placementId);
  if (campaignId && isValidId(campaignId)) match.campaign = new mongoose.Types.ObjectId(campaignId);
  if (device) match.device = device;
  if (language) match.language = String(language).trim().toLowerCase();
  if (page) match.page = String(page).trim().toLowerCase();

  if (advertiserId && isValidId(advertiserId)) {
    const advertiserAdIds = await Advertisement.find({ advertiser: advertiserId }).select('_id');
    const ids = advertiserAdIds.map((a) => a._id);
    // No ads at all for this advertiser: force a match that returns
    // nothing, rather than silently ignoring the filter.
    if (match.advertisement) {
      // advertisementId filter already narrowed it to one id — only keep
      // it if that ad actually belongs to the selected advertiser.
      const stillValid = ids.some((id) => String(id) === String(match.advertisement));
      if (!stillValid) match.advertisement = new mongoose.Types.ObjectId('000000000000000000000000');
    } else {
      match.advertisement = { $in: ids.length ? ids : [new mongoose.Types.ObjectId('000000000000000000000000')] };
    }
  }

  return match;
}

// Groups impressions+clicks by one field (advertisement, placement, or the
// compound [advertisement,placement] pair used by the main table) and
// merges the two aggregations into one row set — same merge approach as
// `analytics` above's mergeBreakdown, generalized to a compound key.
async function aggregateImpressionsAndClicks(match, groupFields) {
  const groupId = groupFields.length === 1
    ? `$${groupFields[0]}`
    : groupFields.reduce((acc, f) => { acc[f] = `$${f}`; return acc; }, {});

  const [imprRows, clickRows] = await Promise.all([
    AdImpression.aggregate([{ $match: match }, { $group: { _id: groupId, count: { $sum: 1 } } }]),
    AdClick.aggregate([{ $match: match }, { $group: { _id: groupId, count: { $sum: 1 } } }])
  ]);

  const keyOf = (id) => (groupFields.length === 1 ? String(id) : groupFields.map((f) => String(id[f])).join('|'));

  const map = new Map();
  imprRows.forEach((r) => { map.set(keyOf(r._id), { id: r._id, impressions: r.count, clicks: 0 }); });
  clickRows.forEach((r) => {
    const key = keyOf(r._id);
    if (!map.has(key)) map.set(key, { id: r._id, impressions: 0, clicks: 0 });
    map.get(key).clicks = r.count;
  });
  return Array.from(map.values());
}

const ANALYTICS_SORTABLE_FIELDS = ['impressions', 'clicks', 'ctr', 'advertisementName', 'placementName', 'status'];

function sortAnalyticsRows(rows, sortBy, sortDir) {
  const field = ANALYTICS_SORTABLE_FIELDS.includes(sortBy) ? sortBy : 'impressions';
  const dir = sortDir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av || '').localeCompare(String(bv || '')) * dir;
    }
    return ((av || 0) - (bv || 0)) * dir;
  });
}

// Exported for tests only — pure/DB-free, same convention
// advertisementAnalyticsService.js already uses for its own helpers.
exports._sortAnalyticsRows = sortAnalyticsRows;

// GET /api/advertisements/analytics/dashboard
//   ?startDate=&endDate=&advertiserId=&campaignId=&advertisementId=&placementId=
//   &device=&language=&page=&pageNum=&limit=&sortBy=&sortDir=
// NOTE: `page` here is the site-page targeting dimension (homepage/news/…,
// same vocabulary as PAGE_TARGETING_KEYS) — deliberately NOT the
// pagination cursor, which is `pageNum` instead, so the two never collide
// on the same query string (both are named "page" in the spec's own
// vocabulary: item 5's "Page" filter and item 10's table pagination).

/* Consolidated Advertising Console dashboard summary. Uses only persisted
   ad/campaign/event data; revenue is returned only when every contributing
   campaign has a valid configured pricing model and real analytics. */
exports.dashboardSummary = async (req, res) => {
  try {
    await Promise.all([syncAdvertisementSchedules(), syncCampaignSchedules()]);
    const statuses = ['active','scheduled','draft','pending_review','paused','expired'];
    const grouped = await Advertisement.aggregate([{ $group:{ _id:'$status', count:{ $sum:1 } } }]);
    const statusCounts = Object.fromEntries(statuses.map(s=>[s,0]));
    grouped.forEach(r=>{ if(statusCounts[r._id] !== undefined) statusCounts[r._id]=r.count; });

    const [impressions, clicks, activeCampaigns, recent] = await Promise.all([
      AdImpression.countDocuments({}),
      AdClick.countDocuments({}),
      Campaign.countDocuments({status:'active'}),
      Advertisement.find({}).sort({createdAt:-1}).limit(8)
        .populate('advertiser','companyName').populate('campaign','name')
        .select('name status schedule advertiser campaign').lean()
    ]);
    const ctr = impressions ? (clicks / impressions) * 100 : 0;

    // Revenue is intentionally conservative: only campaigns with configured
    // pricing contribute, and CPM/CPC require their real campaign event totals.
    const { computeEstimatedRevenue } = require('../services/adRevenueService');
    const campaigns = await Campaign.find({}).lean();
    const campaignIds = campaigns.map(c=>c._id);
    const [impByCamp, clickByCamp] = await Promise.all([
      AdImpression.aggregate([{ $match:{campaign:{$in:campaignIds}}},{ $group:{_id:'$campaign',n:{$sum:1}}}]),
      AdClick.aggregate([{ $match:{campaign:{$in:campaignIds}}},{ $group:{_id:'$campaign',n:{$sum:1}}}])
    ]);
    const im = new Map(impByCamp.map(x=>[String(x._id),x.n]));
    const cl = new Map(clickByCamp.map(x=>[String(x._id),x.n]));
    let currency=null, amount=0, valid=false, mixed=false;
    campaigns.forEach(c=>{
      const r=computeEstimatedRevenue(c,{impressions:im.get(String(c._id))||0,clicks:cl.get(String(c._id))||0});
      if(r.status==='ok' && r.amount!=null){
        if(!currency) currency=r.currency;
        if(currency===r.currency){ amount += Number(r.amount); valid=true; } else mixed=true;
      }
    });
    const revenue = valid && !mixed ? {status:'ok',message:'Estimated',amount:Number(amount.toFixed(2)),currency} :
      {status:'unavailable',message:mixed?'Multiple currencies':'No valid configured pricing',amount:null,currency:null};

    res.json({
      statusCounts,
      summary:{impressions,clicks,ctr,activeCampaigns},
      revenue,
      recent:recent.map(a=>({name:a.name,status:a.status,startDate:a.schedule&&a.schedule.startDate,endDate:a.schedule&&a.schedule.endDate,
        advertiser:a.advertiser&&a.advertiser.companyName,campaign:a.campaign&&a.campaign.name}))
    });
  } catch(err){ res.status(500).json({message:err.message}); }
};

exports.analyticsDashboard = async (req, res) => {
  try {
    // Self-heal both schedules first, same as the Advertisements and
    // Campaigns list pages already do on every read — the dashboard must
    // never show a stale "scheduled"/"paused" status that a plain page
    // load elsewhere would already have corrected (spec item 13).
    await Promise.all([syncAdvertisementSchedules(), syncCampaignSchedules()]);

    const {
      pageNum: pageNumRaw, limit: limitRaw, sortBy = 'impressions', sortDir = 'desc',
      advertiserId, campaignId
    } = req.query;
    const pageNum = Math.max(1, parseInt(pageNumRaw, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limitRaw, 10) || 25));

    const match = await buildAnalyticsDashboardMatch(req.query);

    const [overallImpressions, overallClicks, byAdRows, byPlacementRows, byPairRows] = await Promise.all([
      AdImpression.countDocuments(match),
      AdClick.countDocuments(match),
      aggregateImpressionsAndClicks(match, ['advertisement']),
      aggregateImpressionsAndClicks(match, ['placement']),
      aggregateImpressionsAndClicks(match, ['advertisement', 'placement'])
    ]);

    // Active Campaigns (spec item 13): count campaigns actually live right
    // now, using the same status the delivery engine trusts
    // (isCampaignLiveForDelivery == status === 'active'), narrowed by
    // whichever advertiser/campaign filter is currently selected.
    const campaignFilter = { status: 'active' };
    if (campaignId && isValidId(campaignId)) campaignFilter._id = campaignId;
    if (advertiserId && isValidId(advertiserId)) campaignFilter.advertiser = advertiserId;
    const activeCampaigns = await Campaign.countDocuments(campaignFilter);

    // Resolve the advertisement/placement ids referenced by any row so
    // names + current status can be attached in one shot each, instead of
    // a query per row.
    const adIds = Array.from(new Set(byAdRows.map((r) => String(r.id)).concat(byPairRows.map((r) => String(r.id.advertisement)))));
    const placementIds = Array.from(new Set(byPlacementRows.map((r) => String(r.id)).concat(byPairRows.map((r) => String(r.id.placement)))));

    const [adDocs, placementDocs] = await Promise.all([
      adIds.length ? Advertisement.find({ _id: { $in: adIds } }).select('name status') : [],
      placementIds.length ? AdPlacement.find({ _id: { $in: placementIds } }).select('name') : []
    ]);
    const adById = new Map(adDocs.map((a) => [String(a._id), a]));
    const placementById = new Map(placementDocs.map((p) => [String(p._id), p]));

    const topAdvertisements = sortAnalyticsRows(
      byAdRows.map((r) => ({
        _id: r.id,
        name: (adById.get(String(r.id)) || {}).name || 'Unknown advertisement',
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: computeCtr(r.impressions, r.clicks)
      })),
      'impressions', 'desc'
    ).slice(0, 10);

    const topPlacements = sortAnalyticsRows(
      byPlacementRows.map((r) => ({
        _id: r.id,
        name: (placementById.get(String(r.id)) || {}).name || 'Unknown placement',
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: computeCtr(r.impressions, r.clicks)
      })),
      'impressions', 'desc'
    ).slice(0, 10);

    const tableRowsAll = byPairRows.map((r) => {
      const ad = adById.get(String(r.id.advertisement));
      const placement = placementById.get(String(r.id.placement));
      return {
        advertisementId: r.id.advertisement,
        advertisementName: (ad && ad.name) || 'Unknown advertisement',
        placementId: r.id.placement,
        placementName: (placement && placement.name) || 'Unknown placement',
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: computeCtr(r.impressions, r.clicks),
        status: (ad && ad.status) || 'unknown'
      };
    });

    const sortedRows = sortAnalyticsRows(tableRowsAll, sortBy, sortDir);
    const total = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(total / limitNum));
    const pageClamped = Math.min(pageNum, totalPages);
    const pageRows = sortedRows.slice((pageClamped - 1) * limitNum, pageClamped * limitNum);

    res.json({
      summary: {
        impressions: overallImpressions,
        clicks: overallClicks,
        ctr: computeCtr(overallImpressions, overallClicks),
        activeCampaigns
      },
      topAdvertisements,
      topPlacements,
      table: {
        data: pageRows,
        page: pageClamped,
        limit: limitNum,
        total,
        totalPages
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/advertisements/analytics/dashboard/export
// Same filters + same authorization as analyticsDashboard above, returned
// as CSV instead of JSON. Never paginated by request (the export must
// reflect the full filtered result, per spec item 15) — but this is still
// only the grouped [advertisement,placement] rows aggregated in Mongo, the
// same bounded-size dataset the main table's unpaginated sort works from,
// never raw impression/click events (spec item 18).
exports.analyticsDashboardExport = async (req, res) => {
  try {
    await Promise.all([syncAdvertisementSchedules(), syncCampaignSchedules()]);

    const { sortBy = 'impressions', sortDir = 'desc' } = req.query;
    const match = await buildAnalyticsDashboardMatch(req.query);
    const byPairRows = await aggregateImpressionsAndClicks(match, ['advertisement', 'placement']);

    const adIds = Array.from(new Set(byPairRows.map((r) => String(r.id.advertisement))));
    const placementIds = Array.from(new Set(byPairRows.map((r) => String(r.id.placement))));
    const [adDocs, placementDocs] = await Promise.all([
      adIds.length ? Advertisement.find({ _id: { $in: adIds } }).select('name status') : [],
      placementIds.length ? AdPlacement.find({ _id: { $in: placementIds } }).select('name') : []
    ]);
    const adById = new Map(adDocs.map((a) => [String(a._id), a]));
    const placementById = new Map(placementDocs.map((p) => [String(p._id), p]));

    const rows = byPairRows.map((r) => {
      const ad = adById.get(String(r.id.advertisement));
      const placement = placementById.get(String(r.id.placement));
      return {
        advertisementName: (ad && ad.name) || 'Unknown advertisement',
        placementName: (placement && placement.name) || 'Unknown placement',
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: computeCtr(r.impressions, r.clicks),
        status: (ad && ad.status) || 'unknown'
      };
    });
    const sortedRows = sortAnalyticsRows(rows, sortBy, sortDir);

    const escapeCsv = (val) => {
      const s = String(val === undefined || val === null ? '' : val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Advertisement', 'Placement', 'Impressions', 'Clicks', 'CTR', 'Status'];
    const lines = [header.join(',')].concat(
      sortedRows.map((r) => [
        escapeCsv(r.advertisementName), escapeCsv(r.placementName), r.impressions, r.clicks,
        r.ctr.toFixed(2) + '%', escapeCsv(r.status)
      ].join(','))
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="advertising-analytics-${Date.now()}.csv"`);
    res.status(200).send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// backend/services/advertisementAnalyticsService.js
//
// PART 10A — Advertising Analytics Tracking Engine.
//
// Owns the WRITE side of advertising analytics (impressions + clicks).
// The READ side (per-advertisement breakdown) already exists in
// advertisementController.analytics / statsMapFor and is left untouched
// — this file does not re-implement it, and the dashboard aggregation
// promised for Part 10B will be built on top of the same AdImpression /
// AdClick collections this file writes to, not a new one.
//
// Division of labor, mirroring advertisementDeliveryService.js exactly:
//   - This file owns the DB round trip: revalidate the (advertisement,
//     placement) pair server-side, dedupe, then insert.
//   - utils/advertisementLogic.js's isAdvertisementLiveForDelivery /
//     isCampaignLiveForDelivery / isAdvertiserLiveForDelivery /
//     isWithinSchedule / selectDeliveryCreative are REUSED as-is (the
//     exact same "is this ad allowed to be shown right now" rules
//     getEligibleAdvertisements() already uses) — analytics never
//     invents a second definition of "valid ad".
//
// SECURITY (spec item 17): campaignId/advertiserId/placementId written
// to the analytics collections are NEVER taken from the caller. Only
// `advertisementId` and `placementId` are accepted as identifying input;
// campaign/advertiser are always re-derived from the Advertisement
// document itself, and the placement is confirmed to actually belong to
// that advertisement before anything is recorded. A caller cannot
// manufacture an impression/click for an advertisement it doesn't
// control just by posting arbitrary ids.

const mongoose = require('mongoose');
const Advertisement = require('../models/Advertisement');
const AdPlacement = require('../models/AdPlacement');
const AdImpression = require('../models/AdImpression');
const AdClick = require('../models/AdClick');
const AdTrackingDedup = require('../models/AdTrackingDedup');
const AdSetting = require('../models/AdSetting');
const {
  PAGE_TARGETING_KEYS,
  isAdvertisementLiveForDelivery,
  isCampaignLiveForDelivery,
  isAdvertiserLiveForDelivery,
  isWithinSchedule,
  selectDeliveryCreative
} = require('../utils/advertisementLogic');

const isValidId = (id) => !!id && mongoose.Types.ObjectId.isValid(id);

const DEVICE_VALUES = ['desktop', 'mobile', 'tablet']; // 'unknown' is the schema default, never accepted as input
// Fallback dedup bucket width when the caller doesn't supply its own
// per-render/per-click event id (spec item 7: "obvious duplicates" like
// a rapid double request) — wide enough to catch a same-instant repeat,
// narrow enough to never merge two genuinely separate visits.
const DEDUP_BUCKET_MS = 2500;

function logError(context, err) {
  // eslint-disable-next-line no-console
  console.error(`[advertisementAnalyticsService] ${context}:`, (err && err.message) || err);
}

function normalizeDevice(device) {
  const d = String(device || '').trim().toLowerCase();
  return DEVICE_VALUES.includes(d) ? d : 'unknown';
}

function normalizePage(page) {
  const p = String(page || '').trim().toLowerCase();
  return PAGE_TARGETING_KEYS.includes(p) ? p : '';
}

function normalizeLanguage(language) {
  return String(language || '').trim().toLowerCase().slice(0, 8); // defensive length cap only, no vocabulary lock-in here
}

/**
 * Server-side revalidation: is (advertisementId, placementId) still a
 * legitimate, currently-servable pairing? Deliberately narrower than
 * full delivery eligibility (getEligibleAdvertisements) — targeting
 * (page/device/language/url) was already resolved once when the ad was
 * actually served; this only re-checks the things that can change
 * between render and click/impression-report time (an admin pausing the
 * ad, its schedule lapsing, the campaign/advertiser being disabled, the
 * placement being turned off) plus the integrity check that the
 * advertisement actually runs in the claimed placement at all.
 *
 * @returns {Promise<{valid:true, ad:object, placementDoc:object} | {valid:false, reason:string}>}
 */
async function validateForTracking({ advertisementId, placementId }) {
  if (!isValidId(advertisementId)) return { valid: false, reason: 'invalid_advertisement_id' };
  if (!isValidId(placementId)) return { valid: false, reason: 'invalid_placement_id' };

  let ad;
  try {
    ad = await Advertisement.findById(advertisementId)
      .select('status approval schedule campaign advertiser placements creatives')
      .populate('campaign', 'status')
      .populate('advertiser', 'status')
      .populate('creatives', 'status desktop mobile');
  } catch (err) {
    logError('Advertisement lookup failed', err);
    return { valid: false, reason: 'lookup_failed' };
  }
  if (!ad) return { valid: false, reason: 'advertisement_not_found' };

  if (!isAdvertisementLiveForDelivery(ad)) return { valid: false, reason: 'advertisement_not_live' };
  if (!isWithinSchedule(ad.schedule)) return { valid: false, reason: 'out_of_schedule' };
  if (!isCampaignLiveForDelivery(ad.campaign)) return { valid: false, reason: 'campaign_not_live' };
  if (!isAdvertiserLiveForDelivery(ad.advertiser)) return { valid: false, reason: 'advertiser_not_live' };

  // Integrity check (spec item 17): the placement being reported must be
  // one this advertisement is actually configured to run in — never
  // trust the caller's placementId on its own.
  const belongsToPlacement = (ad.placements || []).some((p) => String(p) === String(placementId));
  if (!belongsToPlacement) return { valid: false, reason: 'placement_mismatch' };

  let placementDoc;
  try {
    placementDoc = await AdPlacement.findById(placementId);
  } catch (err) {
    logError('AdPlacement lookup failed', err);
    return { valid: false, reason: 'lookup_failed' };
  }
  if (!placementDoc || !placementDoc.active) return { valid: false, reason: 'placement_invalid' };

  if (!selectDeliveryCreative(ad.creatives, placementDoc)) return { valid: false, reason: 'creative_invalid' };

  return { valid: true, ad, placementDoc };
}

// Same key derivation for impressions and clicks, namespaced by
// eventType so an impression and a click for the same ad in the same
// instant never collide with each other.
function buildDedupKey({ eventType, eventId, advertisementId, placementId, device }) {
  if (eventId && String(eventId).trim()) {
    return `${eventType}:id:${String(eventId).trim().slice(0, 128)}`;
  }
  const bucket = Math.floor(Date.now() / DEDUP_BUCKET_MS);
  return `${eventType}:bucket:${advertisementId}:${placementId}:${device}:${bucket}`;
}

// Returns true if this event should proceed (first time seen), false if
// it's a duplicate that must be silently dropped. Relies on
// AdTrackingDedup's unique index for atomicity across concurrent
// requests/serverless instances — see that model's comment.
async function claimDedupKey(key) {
  try {
    await AdTrackingDedup.create({ key });
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false; // duplicate key = already claimed = drop
    // Any other dedup-store failure must never block real analytics
    // (spec item 18) — fail open (treat as not-a-duplicate) rather than
    // silently losing a legitimate impression/click.
    logError('dedup claim failed, failing open', err);
    return true;
  }
}

/**
 * Record one impression, IF the advertisement is currently valid and
 * this isn't an obvious duplicate. Never throws — analytics failures
 * must never break the public page (spec item 18).
 * @param {object} params
 * @param {string} params.advertisementId
 * @param {string} params.placementId
 * @param {string} [params.page]
 * @param {string} [params.language]
 * @param {string} [params.device]
 * @param {string} [params.eventId] - opaque, one-shot, per-render id (never a persistent visitor id)
 * @returns {Promise<{counted:boolean, reason:string}>}
 */
async function trackAdvertisementImpression(params = {}) {
  try {
    const { advertisementId, placementId, page, language, device, eventId, preview } = params;

    // Admin/preview rendering must NEVER count as public analytics
    // (spec item 8) — enforced here too, not just in the frontend, since
    // a client cannot be trusted to honor its own preview flag.
    if (preview) return { counted: false, reason: 'preview' };
    const settings = await AdSetting.findOne({ key: 'global' }).select('tracking.impressionTracking');
    if (settings && settings.tracking && settings.tracking.impressionTracking === false) return { counted: false, reason: 'tracking_disabled' };

    const check = await validateForTracking({ advertisementId, placementId });
    if (!check.valid) return { counted: false, reason: check.reason };

    const normalizedDevice = normalizeDevice(device);
    const dedupKey = buildDedupKey({ eventType: 'impression', eventId, advertisementId, placementId, device: normalizedDevice });
    if (!(await claimDedupKey(dedupKey))) return { counted: false, reason: 'duplicate' };

    await AdImpression.create({
      advertisement: check.ad._id,
      campaign: check.ad.campaign._id,
      placement: check.placementDoc._id,
      device: normalizedDevice,
      language: normalizeLanguage(language),
      page: normalizePage(page)
    });

    return { counted: true, reason: 'ok' };
  } catch (err) {
    logError('trackAdvertisementImpression failed', err);
    return { counted: false, reason: 'internal_error' };
  }
}

/**
 * Record one click, IF the advertisement is currently valid and this
 * isn't an obvious duplicate. Same never-throws guarantee as
 * trackAdvertisementImpression.
 * @param {object} params - same shape as trackAdvertisementImpression
 * @returns {Promise<{counted:boolean, reason:string}>}
 */
async function trackAdvertisementClick(params = {}) {
  try {
    const { advertisementId, placementId, page, language, device, eventId, preview } = params;

    if (preview) return { counted: false, reason: 'preview' };
    const settings = await AdSetting.findOne({ key: 'global' }).select('tracking.clickTracking');
    if (settings && settings.tracking && settings.tracking.clickTracking === false) return { counted: false, reason: 'tracking_disabled' };

    const check = await validateForTracking({ advertisementId, placementId });
    if (!check.valid) return { counted: false, reason: check.reason };

    const normalizedDevice = normalizeDevice(device);
    const dedupKey = buildDedupKey({ eventType: 'click', eventId, advertisementId, placementId, device: normalizedDevice });
    if (!(await claimDedupKey(dedupKey))) return { counted: false, reason: 'duplicate' };

    await AdClick.create({
      advertisement: check.ad._id,
      campaign: check.ad.campaign._id,
      placement: check.placementDoc._id,
      device: normalizedDevice,
      language: normalizeLanguage(language),
      page: normalizePage(page)
    });

    return { counted: true, reason: 'ok' };
  } catch (err) {
    logError('trackAdvertisementClick failed', err);
    return { counted: false, reason: 'internal_error' };
  }
}

/**
 * Resolve the destination URL for the click-redirect endpoint (spec item
 * 5). Deliberately the ONLY place that decides where /click/:id sends a
 * visitor — the destination always comes from the Advertisement document
 * itself, never from a query param, so a caller cannot use this endpoint
 * as an open redirector.
 * @returns {Promise<{ad:object|null, destinationUrl:string|null}>}
 */
async function resolveClickDestination(advertisementId) {
  if (!isValidId(advertisementId)) return { ad: null, destinationUrl: null };
  try {
    const ad = await Advertisement.findById(advertisementId).select('destinationUrl');
    if (!ad || !ad.destinationUrl) return { ad: null, destinationUrl: null };
    return { ad, destinationUrl: ad.destinationUrl };
  } catch (err) {
    logError('resolveClickDestination failed', err);
    return { ad: null, destinationUrl: null };
  }
}

function appendAdvertisingUtm(url, advertisementId) {
  try {
    const u = new URL(String(url));
    u.searchParams.set('utm_source', 'coinosprey');
    u.searchParams.set('utm_medium', 'advertising');
    u.searchParams.set('utm_campaign', String(advertisementId));
    return u.toString();
  } catch (_) { return url; }
}

module.exports = {
  trackAdvertisementImpression,
  trackAdvertisementClick,
  resolveClickDestination,
  appendAdvertisingUtm,
  // Exported for tests only — pure/DB-free helpers, same convention as
  // advertisementLogic.js exposing its own pure functions individually.
  validateForTracking,
  normalizeDevice,
  normalizePage,
  normalizeLanguage,
  buildDedupKey,
  DEDUP_BUCKET_MS
};

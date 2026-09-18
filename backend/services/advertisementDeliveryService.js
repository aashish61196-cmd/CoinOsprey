// backend/services/advertisementDeliveryService.js
//
// PART 8A — Advertisement Delivery Service.
//
// This is the SINGLE SOURCE OF TRUTH for "which advertisements are
// eligible for a given placement right now". Public pages/components
// must call getEligibleAdvertisements() rather than querying
// Advertisement / Campaign / Advertiser / AdPlacement themselves — no
// page should ever re-implement its own ad-filtering logic (see PART 8A
// spec item 11).
//
// Division of labor:
//   - This file owns the DB round trip only: resolve the placement,
//     pre-filter Advertisement candidates at the query level (status,
//     approval, schedule, placement, and the simple language/device
//     checks), and populate the refs eligibility needs.
//   - utils/advertisementLogic.js owns the actual eligibility decision
//     (page/category/article/URL targeting, campaign/advertiser
//     liveness, creative validity, priority ranking) as pure, DB-free
//     functions — see filterAndRankEligibleAdvertisements() there.
//
// PART 8B (priority/even/random rotation, fallback + house-ad handling)
// plugs in right after this: it consumes the `ads` array this function
// returns and performs the final single-ad selection. This file
// deliberately does NOT reduce the result to one ad.

const mongoose = require('mongoose');
const Advertisement = require('../models/Advertisement');
const AdPlacement = require('../models/AdPlacement');
const AdSetting = require('../models/AdSetting');
const {
  PAGE_TARGETING_KEYS,
  DEVICE_TARGETING_VALUES,
  LANGUAGE_TARGETING_VALUES,
  buildEligibilityFilter,
  filterAndRankEligibleAdvertisements,
  checkCreativePlacementCompatibility,
  serializeCreativeForDelivery
} = require('../utils/advertisementLogic');
const {
  resolveRotationMode,
  resolveFallbackBehavior,
  selectPaidAdvertisement,
  buildDeliveryResult
} = require('../utils/advertisementRotationLogic');
// Reuses campaignController's schedule self-heal (scheduled->active->expired
// on read) so the public delivery path sees clock-accurate campaign status
// even if no admin has opened the Campaigns console recently. Without this,
// a campaign can sit at "scheduled"/"approved" in the DB past its startDate
// and get silently filtered out below, while the console shows "Active" the
// moment someone views it (because that view triggers the same self-heal).
const { syncCampaignSchedules } = require('../controllers/campaignController');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Only what a delivery-layer caller/renderer needs — never the full
// AdPlacement document.
function serializePlacement(placement) {
  if (!placement) return null;
  return {
    id: placement._id,
    key: placement.key,
    name: placement.name,
    device: placement.device,
    active: placement.active,
    rotationMode: placement.rotationMode,
    fallbackBehavior: placement.fallbackBehavior
  };
}

function emptyResult(overrides = {}) {
  return { placement: null, ads: [], rotationMeta: {}, ...overrides };
}

// Never surface raw DB/internal errors to public callers (spec item 12)
// — log server-side only, the same "best-effort, never blocks the
// primary action" convention writeAudit() already uses in
// advertisementController.
function logDeliveryError(context, err) {
  // eslint-disable-next-line no-console
  console.error(`[advertisementDeliveryService] ${context}:`, (err && err.message) || err);
}

async function resolvePlacement(placement) {
  if (!placement) return null;
  if (isValidId(placement)) return AdPlacement.findById(placement);
  return AdPlacement.findOne({ key: String(placement).trim().toLowerCase() });
}

// AdSetting.adsEnabled is the existing site-wide kill switch (see model
// comment) — reused here rather than inventing a second one. A missing
// settings document (first boot, before an admin has ever saved
// settings) is treated as enabled, matching the schema's own default.
async function isAdvertisingEnabledGlobally() {
  try {
    const settings = await AdSetting.findOne({ key: 'global' }).select('adsEnabled');
    return !settings || settings.adsEnabled !== false;
  } catch (err) {
    // If we can't even confirm ads are enabled, fail toward "no ads"
    // rather than risk serving ads an admin just disabled.
    logDeliveryError('AdSetting lookup failed', err);
    return false;
  }
}

/**
 * THE single reusable entry point for advertisement eligibility.
 * Public pages call this — and only this — to find out what may be
 * shown in a given slot.
 *
 * @param {object} params
 * @param {string} params.placement - AdPlacement key (e.g. "sidebar") or its ObjectId.
 * @param {string} [params.page] - one of PAGE_TARGETING_KEYS (e.g. "news", "homepage", "category", "article").
 * @param {string} [params.url] - the current page's path/URL, for urlPattern + exact-article matching.
 * @param {string} [params.categoryId] - Category id, relevant when page === "category".
 * @param {string} [params.articleId] - Article id, relevant when page === "article".
 * @param {string} [params.language] - "en" | "hi".
 * @param {string} [params.device] - "desktop" | "mobile" | "tablet".
 * @param {Date|string} [params.date] - override "now" (testing/backfill only; defaults to the current time).
 * @returns {Promise<{ placement: object|null, ads: object[], rotationMeta: object }>}
 *   `ads` is every eligible candidate (not yet reduced to one) with the
 *   metadata Part 8B's rotation engine needs: priority, rotationWeight,
 *   the placement's rotationMode/fallbackBehavior, targeting specificity,
 *   a delivery-safe creative, and the destination URL. `rotationMeta` is
 *   keyed by ad id (`{ [id]: { lastServedAt, deliveryCount } }`) — the
 *   persistent state getAdvertisement()'s rotation step needs, kept out
 *   of the `ads` objects themselves so this function's public result
 *   shape (each ad's own fields) stays exactly what PART 8A already
 *   shipped and tested.
 */
async function resolveEligibility(params = {}) {
  try {
    const { placement, page, url, categoryId, articleId, date } = params;

    // ---- input validation — fail safe, never throw to the caller ----
    if (page !== undefined && page !== null && !PAGE_TARGETING_KEYS.includes(page)) {
      logDeliveryError('rejected request', `invalid page "${page}"`);
      return { placementDoc: null, ...emptyResult() };
    }

    let language;
    if (params.language !== undefined && params.language !== null) {
      language = String(params.language).trim().toLowerCase();
      if (!LANGUAGE_TARGETING_VALUES.includes(language)) {
        logDeliveryError('rejected request', `invalid language "${params.language}"`);
        return { placementDoc: null, ...emptyResult() };
      }
    }

    let device;
    if (params.device !== undefined && params.device !== null) {
      device = String(params.device).trim().toLowerCase();
      if (!DEVICE_TARGETING_VALUES.includes(device)) {
        logDeliveryError('rejected request', `invalid device "${params.device}"`);
        return { placementDoc: null, ...emptyResult() };
      }
    }

    const now = date ? new Date(date) : new Date();
    if (Number.isNaN(now.getTime())) {
      logDeliveryError('rejected request', `invalid date "${date}"`);
      return { placementDoc: null, ...emptyResult() };
    }

    // ---- placement resolution + enablement (spec item 7) ----
    let placementDoc;
    try {
      placementDoc = await resolvePlacement(placement);
    } catch (err) {
      logDeliveryError('placement lookup failed', err);
      return { placementDoc: null, ...emptyResult() };
    }
    if (!placementDoc) return { placementDoc: null, ...emptyResult() };

    const serializedPlacement = serializePlacement(placementDoc);
    if (!placementDoc.active) return { placementDoc, ...emptyResult({ placement: serializedPlacement }) };

    // ---- site-wide kill switch ----
    if (!(await isAdvertisingEnabledGlobally())) {
      return { placementDoc, ...emptyResult({ placement: serializedPlacement }) };
    }

// ---- campaign schedule self-heal ----
    // Must run before the query below: it's the only thing that keeps a
    // Campaign's managed status (scheduled/active/expired) in sync with
    // the clock on this read path. Best-effort — a sync failure must not
    // block delivery, it just means eligibility checks below fall back to
    // whatever status is currently persisted.
    try {
      await syncCampaignSchedules();
    } catch (err) {
      logDeliveryError('campaign schedule sync failed', err);
    }

    // ---- DB-level pre-filter ----
    // Pushes status/approval/schedule/placement match, plus the simple
    // language/device "field equals or is unset" checks, into the query
    // itself (spec item 13 — avoid loading every advertisement and
    // filtering everything in JS). Page/category/article/urlPattern
    // targeting is intentionally NOT pushed into this filter: it needs
    // priority/specificity resolution that isn't a plain field match, so
    // it's resolved once in JS below via filterAndRankEligibleAdvertisements.
    const dbFilter = buildEligibilityFilter({ placement: placementDoc._id, language, device, date: now });

    let candidates;
    try {
      candidates = await Advertisement.find(dbFilter)
        .select('name advertiser campaign type destinationUrl openInNewTab schedule priority rotationWeight targeting creatives status approval lastServedAt deliveryCount')
        .populate('advertiser', 'status')
        .populate('campaign', 'status advertiser')
        .populate('creatives', 'name altText status desktop mobile');
      // .populate() batches one query per ref field (not one per
      // advertisement), so this is a fixed 4-query request regardless of
      // how many candidates match — no N+1.
    } catch (err) {
      logDeliveryError('Advertisement query failed', err);
      return { placementDoc, ...emptyResult({ placement: serializedPlacement }) };
    }

    let ads;
    try {
      ads = filterAndRankEligibleAdvertisements({
        ads: candidates,
        placement: placementDoc,
        page,
        url,
        categoryId,
        articleId,
        language,
        device,
        date: now
      });
    } catch (err) {
      // A single malformed advertisement/targeting rule must not take
      // down the whole placement (spec item 12).
      logDeliveryError('eligibility evaluation failed', err);
      return { placementDoc, ...emptyResult({ placement: serializedPlacement }) };
    }

    // Rotation metadata, keyed by id, pulled from the same fetch — no
    // second query. Candidates missing from `ads` (ineligible ones)
    // simply have no rotation decision to make, so they're not included.
    const eligibleIds = new Set(ads.map((ad) => String(ad.id)));
    const rotationMeta = {};
    candidates.forEach((c) => {
      const cid = String(c._id);
      if (!eligibleIds.has(cid)) return;
      rotationMeta[cid] = { lastServedAt: c.lastServedAt || null, deliveryCount: c.deliveryCount || 0 };
    });

    return { placementDoc, placement: serializedPlacement, ads, rotationMeta };
  } catch (err) {
    // Last-resort safety net: this service must never crash the public
    // website, regardless of what upstream mistake caused the failure.
    logDeliveryError('unexpected error', err);
    return { placementDoc: null, ...emptyResult() };
  }
}

/**
 * THE single reusable entry point for advertisement eligibility.
 * Public pages call this — and only this — to find out what may be
 * shown in a given slot. Thin wrapper over resolveEligibility() that
 * drops the raw Mongoose placement document (internal use only, needed
 * by getAdvertisement()/getHouseAdvertisement() below for creative
 * compatibility checks) before returning.
 * @param {object} params - see resolveEligibility's own params.
 * @returns {Promise<{ placement: object|null, ads: object[], rotationMeta: object }>}
 */
async function getEligibleAdvertisements(params = {}) {
  const { placement, ads, rotationMeta } = await resolveEligibility(params);
  return { placement, ads, rotationMeta };
}

// Best-effort, atomic, and never blocks/fails the primary delivery
// response (same convention writeAudit() uses in advertisementController)
// — a failed rotation-state write should never turn a successfully
// selected ad into a delivery error for the visitor.
async function recordDelivery(adId) {
  if (!adId) return;
  try {
    await Advertisement.findByIdAndUpdate(
      adId,
      { $set: { lastServedAt: new Date() }, $inc: { deliveryCount: 1 } },
      { new: false }
    );
  } catch (err) {
    logDeliveryError('recordDelivery failed', err);
  }
}

/**
 * Resolve the HOUSE_AD fallback (spec items 6-8): AdSetting.houseAdCreative
 * is the single source of truth this project already reserved for it
 * (see AdSetting model comment) — no second/parallel house-ad concept is
 * introduced. Reuses checkCreativePlacementCompatibility so "is this
 * creative actually deliverable in this placement" stays defined in
 * exactly one place, same as ordinary paid ads.
 * @returns {Promise<object|null>} a delivery-safe ad-shaped object, or
 *   null if no valid house advertisement is currently configured.
 */
async function getHouseAdvertisement(placementDoc) {
  if (!placementDoc) return null;
  try {
    const settings = await AdSetting.findOne({ key: 'global' })
      .select('houseAdsEnabled houseAds houseAdCreative houseAdDestinationUrl houseAdOpenInNewTab')
      .populate('houseAds.creative', 'name altText status desktop mobile')
      .populate('houseAdCreative', 'name altText status desktop mobile');

    if (!settings || settings.houseAdsEnabled === false) return null;

    // Prefer the new multi-house-ad inventory. It lets CoinOsprey rotate
    // its own News, Price Predictions, Academy and Rankings promotions.
    const configured = Array.isArray(settings.houseAds)
      ? settings.houseAds.filter(h => h && h.active !== false && h.creative && h.destinationUrl)
      : [];

    if (configured.length) {
      const valid = [];
      for (const h of configured) {
        if (h.creative.status !== 'active') continue;
        if (!isSafeHouseUrl(h.destinationUrl)) continue;
        const errors = checkCreativePlacementCompatibility(h.creative, placementDoc);
        if (errors.length === 0) valid.push(h);
      }
      if (valid.length) {
        valid.sort((a,b) => (a.priority || 5) - (b.priority || 5) || String(a._id).localeCompare(String(b._id)));
        const h = valid[0];
        return {
          id: null, campaignId: null, advertiserId: null, placementId: placementDoc._id,
          type: 'house', houseAdId: h._id, houseAdCategory: h.category || 'custom',
          priority: h.priority || null, rotationWeight: null, rotationMode: null,
          targetingSpecificity: null, creative: serializeCreativeForDelivery(h.creative),
          destinationUrl: h.destinationUrl, openInNewTab: h.openInNewTab !== false
        };
      }
    }

    // Backward-compatible single house-ad configuration from earlier parts.
    if (!settings.houseAdCreative || !settings.houseAdDestinationUrl) return null;
    if (!isSafeHouseUrl(settings.houseAdDestinationUrl)) return null;
    const creative = settings.houseAdCreative;
    if (creative.status !== 'active') return null;
    const errors = checkCreativePlacementCompatibility(creative, placementDoc);
    if (errors.length > 0) return null;
    return {
      id: null, campaignId: null, advertiserId: null, placementId: placementDoc._id,
      type: 'house', houseAdCategory: 'custom', priority: null, rotationWeight: null,
      rotationMode: null, targetingSpecificity: null, creative: serializeCreativeForDelivery(creative),
      destinationUrl: settings.houseAdDestinationUrl,
      openInNewTab: settings.houseAdOpenInNewTab !== false
    };
  } catch (err) {
    logDeliveryError('house advertisement lookup failed', err);
    return null;
  }
}

function isSafeHouseUrl(value) {
  try {
    const u = new URL(String(value));
    return ['http:', 'https:'].includes(u.protocol);
  } catch (_) { return false; }
}

/**
 * THE final reusable delivery function (spec item 1) — the only function
 * public pages should ever call. Internally: eligibility -> rotation ->
 * fallback -> house ad, reduced to exactly one advertisement (or none)
 * for this request. See utils/advertisementRotationLogic.js for the
 * pure rotation-mode dispatch and the response shape.
 *
 * @param {object} params - same shape as getEligibleAdvertisements
 *   (placement, page, url, categoryId, articleId, language, device,
 *   date), plus an optional `rng` (RANDOM-mode testing hook only).
 * @returns {Promise<{status:string, source:string|null, advertisement:object|null, placement:object|null, rotationMode:string|null, reason:string}>}
 */
async function getAdvertisement(params = {}) {
  try {
    const { placementDoc, placement: serializedPlacement, ads, rotationMeta } = await resolveEligibility(params);

    if (!serializedPlacement) {
      return buildDeliveryResult({ status: 'empty', reason: 'placement_not_found' });
    }

    // Spec item 6, IMPORTANT: a disabled placement must remain disabled —
    // never fall through to fallbackBehavior/house_ad just because it's
    // configured that way. This mirrors resolveEligibility's own
    // active-placement short-circuit, so `ads` is guaranteed empty here
    // anyway; this branch exists to give disabled placements their own
    // explicit reason rather than silently reusing the "no ads" path.
    if (!serializedPlacement.active) {
      return buildDeliveryResult({
        status: 'empty',
        placement: serializedPlacement,
        rotationMode: resolveRotationMode(serializedPlacement.rotationMode),
        reason: 'placement_disabled'
      });
    }

    const rotationMode = resolveRotationMode(serializedPlacement.rotationMode);

    if (ads.length > 0) {
      let selected = null;
      try {
        selected = selectPaidAdvertisement({ ads, rotationMode, rotationMeta, rng: params.rng });
      } catch (err) {
        // A rotation-selection bug must degrade to "no ad", never crash
        // the request (spec item 12).
        logDeliveryError('rotation selection failed', err);
        selected = null;
      }

      if (selected) {
        // Best-effort (recordDelivery swallows its own errors) but still
        // awaited — same convention writeAudit() uses elsewhere in this
        // codebase — so the write has actually been issued before a
        // serverless invocation's response finishes and the process may
        // be frozen/recycled.
        await recordDelivery(selected.id);
        return buildDeliveryResult({
          status: 'served',
          source: 'paid',
          advertisement: selected,
          placement: serializedPlacement,
          rotationMode,
          reason: 'paid_ad_selected'
        });
      }
    }

    // ---- no eligible paid advertisement: fallback engine (spec items 6-8) ----
    const fallbackBehavior = resolveFallbackBehavior(serializedPlacement.fallbackBehavior);

    if (fallbackBehavior === 'hide') {
      return buildDeliveryResult({ status: 'empty', placement: serializedPlacement, rotationMode, reason: 'no_eligible_ads_hide' });
    }

    if (fallbackBehavior === 'collapse') {
      return buildDeliveryResult({ status: 'collapsed', placement: serializedPlacement, rotationMode, reason: 'no_eligible_ads_collapse' });
    }

    // fallbackBehavior === 'house_ad'
    let houseAd = null;
    try {
      houseAd = await getHouseAdvertisement(placementDoc);
    } catch (err) {
      logDeliveryError('house advertisement resolution failed', err);
      houseAd = null;
    }

    if (houseAd) {
      return buildDeliveryResult({
        status: 'served',
        source: 'house',
        advertisement: houseAd,
        placement: serializedPlacement,
        rotationMode,
        reason: 'house_ad_selected'
      });
    }

    // House ad configured but unavailable/invalid (spec item 8): default
    // to COLLAPSE rather than HIDE — AdPlacement has only one
    // fallbackBehavior field, so there is no separate "if house_ad also
    // fails" setting to read; collapsing (closing the slot's layout
    // space) is the safer default of the two remaining options, since it
    // never risks a broken/empty box being visible to a visitor.
    return buildDeliveryResult({ status: 'collapsed', placement: serializedPlacement, rotationMode, reason: 'house_ad_unavailable_collapse' });
  } catch (err) {
    // Absolute last-resort safety net (spec item 12): the public site
    // must never crash because advertisement delivery fails.
    logDeliveryError('getAdvertisement unexpected error', err);
    return buildDeliveryResult({ status: 'empty', reason: 'internal_error' });
  }
}

module.exports = {
  getEligibleAdvertisements,
  getAdvertisement
};

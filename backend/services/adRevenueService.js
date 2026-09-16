// backend/services/adRevenueService.js
//
// PART 10B — Advertising Pricing & Revenue Management.
//
// Owns revenue calculation only. Never writes anything — reads a
// Campaign's `pricing` config (utils/adPricingLogic.js) plus real
// analytics totals (AdImpression/AdClick, via the same statsMapFor-style
// aggregation campaignController already uses) and turns them into an
// Estimated Revenue figure, or an explicit reason why one isn't
// available yet. Mirrors advertisementAnalyticsService.js's discipline
// of never inventing data and never throwing into the caller.
//
// HARD RULES (do not relax these):
//   - A missing/incomplete pricing config -> "Pricing not configured".
//   - Missing/not-yet-available analytics for the chosen model -> an
//     "insufficient_*" status, never a fabricated $0/₹0.
//   - CUSTOM pricing NEVER computes a number — always "unavailable".
//   - Actual revenue only ever comes from real billing/payment data.
//     This codebase has no billing/payment/invoice model at all, so
//     getActualRevenue() always reports "unavailable" rather than
//     deriving a number from impressions/clicks.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// How many whole/partial billing units (days/weeks/months) of the
// campaign's real schedule have actually elapsed as of `now`, capped to
// the campaign's own end date so a still-running campaign is never
// over-billed for time that hasn't happened yet. Returns 0 (not billable
// yet) if the campaign hasn't started.
function elapsedBillingUnits(campaign, unit, now) {
  if (!campaign.startDate) return null; // schedule genuinely unavailable
  const start = new Date(campaign.startDate).getTime();
  const cappedEnd = campaign.endDate ? Math.min(now.getTime(), new Date(campaign.endDate).getTime()) : now.getTime();
  if (isNaN(start) || isNaN(cappedEnd)) return null;
  if (cappedEnd <= start) return 0; // not started yet, or clock is exactly at the boundary

  const elapsedMs = cappedEnd - start;
  const elapsedDays = elapsedMs / MS_PER_DAY;

  if (unit === 'daily') return Math.ceil(elapsedDays);
  if (unit === 'weekly') return Math.ceil(elapsedDays / 7);
  if (unit === 'monthly') return Math.ceil(elapsedDays / 30); // no calendar-month lib in this project — same "no DST/calendar library" tradeoff timezone.js already accepts
  return null;
}

/**
 * @param {object} campaign - Campaign document (or plain object) with
 *   `pricing` and `startDate`/`endDate`.
 * @param {{impressions:number, clicks:number}} stats - real aggregated
 *   totals for this campaign (from AdImpression/AdClick), never
 *   estimated or backfilled.
 * @param {Date} [now]
 * @returns {{
 *   status: 'not_configured'|'insufficient_analytics'|'insufficient_pricing'|'unavailable'|'ok',
 *   message: string,
 *   amount: number|null,
 *   currency: string|null,
 *   pricing: object|null
 * }}
 */
function computeEstimatedRevenue(campaign, stats, now = new Date()) {
  const pricing = campaign && campaign.pricing;

  if (!pricing || !pricing.model) {
    return { status: 'not_configured', message: 'Pricing not configured', amount: null, currency: null, pricing: null };
  }

  const { model, rate, currency, billingPeriod } = pricing;

  if (rate === undefined || rate === null || isNaN(Number(rate)) || Number(rate) < 0 || !currency) {
    return { status: 'insufficient_pricing', message: 'Insufficient pricing data', amount: null, currency: currency || null, pricing };
  }

  const safeStats = stats || null;

  switch (model) {
    case 'CPM': {
      if (!safeStats || safeStats.impressions === undefined || safeStats.impressions === null) {
        return { status: 'insufficient_analytics', message: 'Insufficient analytics data', amount: null, currency, pricing };
      }
      const amount = round2((Number(safeStats.impressions) / 1000) * Number(rate));
      return { status: 'ok', message: 'Estimated', amount, currency, pricing };
    }

    case 'CPC': {
      if (!safeStats || safeStats.clicks === undefined || safeStats.clicks === null) {
        return { status: 'insufficient_analytics', message: 'Insufficient analytics data', amount: null, currency, pricing };
      }
      const amount = round2(Number(safeStats.clicks) * Number(rate));
      return { status: 'ok', message: 'Estimated', amount, currency, pricing };
    }

    case 'FLAT': {
      const amount = round2(Number(rate));
      return { status: 'ok', message: 'Estimated', amount, currency, pricing };
    }

    case 'SPONSORED_ARTICLE': {
      const amount = round2(Number(rate));
      return { status: 'ok', message: 'Estimated', amount, currency, pricing };
    }

    case 'DAILY':
    case 'WEEKLY':
    case 'MONTHLY': {
      const unit = model.toLowerCase();
      const units = elapsedBillingUnits(campaign, unit, now);
      if (units === null) {
        return { status: 'insufficient_analytics', message: 'Insufficient analytics data', amount: null, currency, pricing };
      }
      if (units <= 0) {
        // Campaign hasn't started yet (or hasn't completed a single
        // billing unit) — there is no billable duration to report on,
        // so this is "not enough data yet", never a fabricated $0.
        return { status: 'insufficient_analytics', message: 'Insufficient analytics data', amount: null, currency, pricing };
      }
      const amount = round2(units * Number(rate));
      return { status: 'ok', message: 'Estimated', amount, currency, pricing, billingUnits: units };
    }

    case 'CUSTOM':
    default: {
      // Never fabricate a formula for a custom arrangement — the notes
      // field is free text for admins/finance, not something this
      // service parses into a calculation.
      return { status: 'unavailable', message: 'Revenue calculation unavailable', amount: null, currency, pricing };
    }
  }
}

/**
 * Actual revenue must only ever come from real billing/payment/invoice
 * data. No such data source exists anywhere in this project (no
 * Invoice/Payment/Billing model, no payment-gateway integration), so
 * this always reports "unavailable" rather than deriving a number from
 * impressions/clicks or treating estimated revenue as actual revenue.
 * Kept as its own function (rather than inlined in the controller) so
 * that IF a real billing integration is added later, this is the one
 * place that needs to change.
 */
function getActualRevenue() {
  return {
    status: 'unavailable',
    message: 'Actual revenue unavailable — no billing/payment data connected.',
    amount: null,
    currency: null
  };
}

module.exports = {
  computeEstimatedRevenue,
  getActualRevenue,
  elapsedBillingUnits
};

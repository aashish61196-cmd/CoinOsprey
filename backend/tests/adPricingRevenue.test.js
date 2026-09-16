// Plain-Node test script for the PART 10B Advertising Pricing & Revenue
// Management feature — same "no jest/mocha, no DB-test harness"
// convention as the rest of backend/tests (see advertisementAnalytics.test.js).
// Covers only the pure/DB-free logic: utils/adPricingLogic.js validation
// and services/adRevenueService.js revenue math. The controller layer
// (campaignController.getPricing/updatePricing/removePricing/getRevenue)
// is a thin DB-orchestration wrapper around these and around Campaign,
// same reasoning advertisementAnalytics.test.js gives for not re-testing
// validateForTracking against a live Mongo connection here.
//
// Run with:
//   node backend/tests/adPricingRevenue.test.js

const assert = require('assert');

const {
  PRICING_MODELS,
  CURRENCIES,
  billingPeriodsFor,
  validatePricingPayload
} = require('../utils/adPricingLogic');

const { computeEstimatedRevenue, getActualRevenue } = require('../services/adRevenueService');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

/* ===================== validatePricingPayload ===================== */

test('empty payload is rejected with a model error', () => {
  const errors = validatePricingPayload({});
  assert.ok(errors.length >= 1);
  assert.ok(errors[0].includes('pricing model'));
});

test('unknown model is rejected', () => {
  const errors = validatePricingPayload({ model: 'NOT_A_MODEL' });
  assert.ok(errors.some((e) => e.includes('pricing model')));
});

test('CPM with mismatched billing period is rejected', () => {
  const errors = validatePricingPayload({ model: 'CPM', rate: 5, currency: 'USD', billingPeriod: 'per_click' });
  assert.ok(errors.some((e) => e.includes('billing period')));
});

test('CPM with matching billing period, rate and currency is valid', () => {
  const errors = validatePricingPayload({ model: 'CPM', rate: 5, currency: 'USD', billingPeriod: 'per_1000_impressions' });
  assert.deepStrictEqual(errors, []);
});

test('negative rate is rejected', () => {
  const errors = validatePricingPayload({ model: 'FLAT', rate: -10, currency: 'USD', billingPeriod: 'one_time' });
  assert.ok(errors.some((e) => e.includes('rate')));
});

test('currency outside USD/INR is rejected', () => {
  const errors = validatePricingPayload({ model: 'FLAT', rate: 10, currency: 'EUR', billingPeriod: 'one_time' });
  assert.ok(errors.some((e) => e.includes('currency')));
});

test('negative includedImpressions is rejected', () => {
  const errors = validatePricingPayload({
    model: 'CPM', rate: 5, currency: 'USD', billingPeriod: 'per_1000_impressions', includedImpressions: -5
  });
  assert.ok(errors.some((e) => e.includes('included impressions')));
});

test('CUSTOM model accepts any billing period', () => {
  const errors = validatePricingPayload({ model: 'CUSTOM', rate: 1, currency: 'INR', billingPeriod: 'monthly' });
  assert.deepStrictEqual(errors, []);
});

test('billingPeriodsFor returns the exact allow-list per model', () => {
  assert.deepStrictEqual(billingPeriodsFor('CPC'), ['per_click']);
  assert.deepStrictEqual(billingPeriodsFor('DAILY'), ['daily']);
  assert.strictEqual(billingPeriodsFor('NOPE').length, 0);
});

test('exactly 8 pricing models and exactly 2 currencies are exposed', () => {
  assert.strictEqual(PRICING_MODELS.length, 8);
  assert.deepStrictEqual(CURRENCIES.slice().sort(), ['INR', 'USD']);
});

/* ===================== computeEstimatedRevenue ===================== */

test('no pricing configured -> not_configured, no amount', () => {
  const result = computeEstimatedRevenue({ pricing: null }, { impressions: 100, clicks: 10 });
  assert.strictEqual(result.status, 'not_configured');
  assert.strictEqual(result.amount, null);
});

test('CPM computes impressions/1000 * rate', () => {
  const result = computeEstimatedRevenue(
    { pricing: { model: 'CPM', rate: 10, currency: 'USD' } },
    { impressions: 12345, clicks: 0 }
  );
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.amount, 123.45);
  assert.strictEqual(result.currency, 'USD');
});

test('CPM with missing impressions stat -> insufficient_analytics, never $0', () => {
  const result = computeEstimatedRevenue(
    { pricing: { model: 'CPM', rate: 10, currency: 'USD' } },
    { impressions: undefined, clicks: 0 }
  );
  assert.strictEqual(result.status, 'insufficient_analytics');
  assert.strictEqual(result.amount, null);
});

test('CPC computes clicks * rate', () => {
  const result = computeEstimatedRevenue(
    { pricing: { model: 'CPC', rate: 2.5, currency: 'INR' } },
    { impressions: 0, clicks: 40 }
  );
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.amount, 100);
  assert.strictEqual(result.currency, 'INR');
});

test('FLAT and SPONSORED_ARTICLE return the configured rate as-is', () => {
  const flat = computeEstimatedRevenue({ pricing: { model: 'FLAT', rate: 750, currency: 'USD' } }, { impressions: 0, clicks: 0 });
  const spon = computeEstimatedRevenue({ pricing: { model: 'SPONSORED_ARTICLE', rate: 300, currency: 'USD' } }, { impressions: 0, clicks: 0 });
  assert.strictEqual(flat.amount, 750);
  assert.strictEqual(spon.amount, 300);
});

test('DAILY before campaign start -> insufficient_analytics, never $0', () => {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 10 * 24 * 60 * 60 * 1000);
  const result = computeEstimatedRevenue(
    { pricing: { model: 'DAILY', rate: 50, currency: 'USD' }, startDate: start, endDate: end },
    { impressions: 0, clicks: 0 }
  );
  assert.strictEqual(result.status, 'insufficient_analytics');
  assert.strictEqual(result.amount, null);
});

test('DAILY mid-flight bills elapsed whole days, capped at endDate', () => {
  const start = new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const result = computeEstimatedRevenue(
    { pricing: { model: 'DAILY', rate: 50, currency: 'USD' }, startDate: start, endDate: end },
    { impressions: 0, clicks: 0 }
  );
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.billingUnits, 4); // ceil(3.5)
  assert.strictEqual(result.amount, 200);
});

test('DAILY caps billed days at the campaign endDate even if now is later', () => {
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // campaign ended 20 days ago
  const result = computeEstimatedRevenue(
    { pricing: { model: 'DAILY', rate: 10, currency: 'USD' }, startDate: start, endDate: end },
    { impressions: 0, clicks: 0 }
  );
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.billingUnits, 10); // only the 10 days the campaign actually ran
});

test('CUSTOM never computes a number, regardless of rate/notes', () => {
  const result = computeEstimatedRevenue(
    { pricing: { model: 'CUSTOM', rate: 999, currency: 'USD', notes: 'special deal, billed quarterly' } },
    { impressions: 999999, clicks: 999 }
  );
  assert.strictEqual(result.status, 'unavailable');
  assert.strictEqual(result.amount, null);
  assert.strictEqual(result.message, 'Revenue calculation unavailable');
});

test('missing rate/currency on an otherwise-present pricing object -> insufficient_pricing', () => {
  const result = computeEstimatedRevenue(
    { pricing: { model: 'CPM', rate: null, currency: null } },
    { impressions: 1000, clicks: 0 }
  );
  assert.strictEqual(result.status, 'insufficient_pricing');
  assert.strictEqual(result.amount, null);
});

/* ===================== getActualRevenue ===================== */

test('getActualRevenue always reports unavailable — no fabricated payment data', () => {
  const result = getActualRevenue();
  assert.strictEqual(result.status, 'unavailable');
  assert.strictEqual(result.amount, null);
  assert.ok(result.message.includes('no billing/payment data connected'));
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
} else {
  console.log('All tests passed.');
}

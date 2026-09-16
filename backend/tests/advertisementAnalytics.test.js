// Plain-Node test script for the PART 10A analytics tracking engine —
// same "no jest/mocha, no DB-test harness" constraint documented in
// advertisementDelivery.test.js applies here too. This covers every
// pure/DB-free piece of advertisementAnalyticsService.js (normalization,
// dedup-key derivation, CTR is already covered in advertisement.logic.test.js
// and intentionally not duplicated here). validateForTracking /
// trackAdvertisementImpression / trackAdvertisementClick themselves are
// thin DB-orchestration wrappers around the same isAdvertisementLiveForDelivery
// / isCampaignLiveForDelivery / isAdvertiserLiveForDelivery / isWithinSchedule
// / selectDeliveryCreative functions advertisementDelivery.test.js already
// exercises directly against fixtures — not re-tested against a live Mongo
// connection here for the same reason that file isn't either.
//
// Run with:
//   node backend/tests/advertisementAnalytics.test.js

const assert = require('assert');

const {
  normalizeDevice,
  normalizePage,
  normalizeLanguage,
  buildDedupKey,
  DEDUP_BUCKET_MS
} = require('../services/advertisementAnalyticsService');

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

/* ===================== normalizeDevice ===================== */

test('normalizeDevice accepts desktop/mobile/tablet as-is', () => {
  assert.strictEqual(normalizeDevice('desktop'), 'desktop');
  assert.strictEqual(normalizeDevice('mobile'), 'mobile');
  assert.strictEqual(normalizeDevice('tablet'), 'tablet');
});

test('normalizeDevice is case-insensitive and trims', () => {
  assert.strictEqual(normalizeDevice(' Desktop '), 'desktop');
  assert.strictEqual(normalizeDevice('MOBILE'), 'mobile');
});

test('normalizeDevice falls back to "unknown" for anything else', () => {
  assert.strictEqual(normalizeDevice('smart-fridge'), 'unknown');
  assert.strictEqual(normalizeDevice(undefined), 'unknown');
  assert.strictEqual(normalizeDevice(null), 'unknown');
  assert.strictEqual(normalizeDevice(''), 'unknown');
  assert.strictEqual(normalizeDevice('unknown'), 'unknown'); // never itself a valid *input* value, still resolves safely
});

/* ===================== normalizePage ===================== */

test('normalizePage accepts a known PAGE_TARGETING_KEYS value', () => {
  assert.strictEqual(normalizePage('homepage'), 'homepage');
  assert.strictEqual(normalizePage('news'), 'news');
  assert.strictEqual(normalizePage('price-prediction'), 'price-prediction');
});

test('normalizePage lowercases/trims a known value', () => {
  assert.strictEqual(normalizePage('  Homepage '), 'homepage');
});

test('normalizePage rejects an unrecognized/arbitrary value rather than storing it verbatim', () => {
  // Spec item 17: a caller must not be able to inject arbitrary
  // dimension values into the analytics store.
  assert.strictEqual(normalizePage('<script>evil()</script>'), '');
  assert.strictEqual(normalizePage('some-made-up-page'), '');
  assert.strictEqual(normalizePage(undefined), '');
});

/* ===================== normalizeLanguage ===================== */

test('normalizeLanguage lowercases/trims', () => {
  assert.strictEqual(normalizeLanguage(' EN '), 'en');
  assert.strictEqual(normalizeLanguage('Hi'), 'hi');
});

test('normalizeLanguage caps length defensively rather than storing unbounded input', () => {
  const huge = 'x'.repeat(500);
  assert.ok(normalizeLanguage(huge).length <= 8);
});

test('normalizeLanguage defaults to empty string', () => {
  assert.strictEqual(normalizeLanguage(undefined), '');
  assert.strictEqual(normalizeLanguage(null), '');
});

/* ===================== buildDedupKey ===================== */

test('buildDedupKey uses the caller-supplied eventId when present', () => {
  const key = buildDedupKey({ eventType: 'impression', eventId: 'abc123', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
  assert.strictEqual(key, 'impression:id:abc123');
});

test('buildDedupKey namespaces by eventType so an impression and a click never collide', () => {
  const impressionKey = buildDedupKey({ eventType: 'impression', eventId: 'same-id', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
  const clickKey = buildDedupKey({ eventType: 'click', eventId: 'same-id', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
  assert.notStrictEqual(impressionKey, clickKey);
});

test('buildDedupKey falls back to a time-bucketed key when no eventId is supplied', () => {
  const key = buildDedupKey({ eventType: 'click', advertisementId: 'ad1', placementId: 'p1', device: 'mobile' });
  assert.ok(key.startsWith('click:bucket:ad1:p1:mobile:'));
});

test('buildDedupKey fallback keys for the same ad/placement/device in the same instant collide (this IS the point — catches obvious duplicates)', () => {
  const now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const key1 = buildDedupKey({ eventType: 'impression', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
    const key2 = buildDedupKey({ eventType: 'impression', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
    assert.strictEqual(key1, key2);
  } finally {
    Date.now = originalNow;
  }
});

test('buildDedupKey fallback keys for different advertisements never collide', () => {
  const now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const key1 = buildDedupKey({ eventType: 'impression', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
    const key2 = buildDedupKey({ eventType: 'impression', advertisementId: 'ad2', placementId: 'p1', device: 'desktop' });
    assert.notStrictEqual(key1, key2);
  } finally {
    Date.now = originalNow;
  }
});

test('buildDedupKey fallback keys separated by more than one bucket width never collide', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1000000;
    const key1 = buildDedupKey({ eventType: 'impression', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
    Date.now = () => 1000000 + DEDUP_BUCKET_MS * 3;
    const key2 = buildDedupKey({ eventType: 'impression', advertisementId: 'ad1', placementId: 'p1', device: 'desktop' });
    assert.notStrictEqual(key1, key2);
  } finally {
    Date.now = originalNow;
  }
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
} else {
  console.log('All tests passed.');
}

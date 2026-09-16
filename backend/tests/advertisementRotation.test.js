// Plain-Node test script for the PART 8B rotation/fallback engine (same
// no-jest/no-mocha constraint every other backend test file in this
// project operates under). Run with:
//   node backend/tests/advertisementRotation.test.js
//
// Covers the pure, DB-free selection logic in
// utils/advertisementRotationLogic.js. services/advertisementDeliveryService's
// getAdvertisement()/getHouseAdvertisement()/recordDelivery() are thin DB
// orchestration around this logic (resolve eligibility, dispatch to the
// pure selector, persist the outcome) — consistent with this project's
// existing convention (see advertisementDelivery.test.js's own note), they
// are not covered by a live-Mongo test here since this codebase has no
// DB-test harness for any part.

const assert = require('assert');
const mongoose = require('mongoose');

const {
  ROTATION_MODES,
  FALLBACK_BEHAVIORS,
  resolveRotationMode,
  resolveFallbackBehavior,
  pickTopSpecificityTier,
  selectPriorityWinner,
  selectEvenWinner,
  selectRandomWinner,
  selectPaidAdvertisement,
  buildDeliveryResult
} = require('../utils/advertisementRotationLogic');

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

const id = () => new mongoose.Types.ObjectId();

// Shape matches filterAndRankEligibleAdvertisements()'s actual output
// (see advertisementDelivery.test.js's "result shape" test) — the
// rotation engine consumes exactly that, nothing more.
function eligibleAd(overrides = {}) {
  return {
    id: id(),
    campaignId: id(),
    advertiserId: id(),
    placementId: id(),
    type: 'display_banner',
    priority: 5,
    rotationWeight: 1,
    rotationMode: 'priority',
    targetingSpecificity: 5, // TARGETING_SPECIFICITY.ALL
    creative: { id: id(), name: 'Creative', altText: '', desktop: { fileUrl: 'https://cdn.example.com/a.png' }, mobile: null },
    destinationUrl: 'https://advertiser.example.com',
    openInNewTab: true,
    ...overrides
  };
}

console.log('1-3: resolveRotationMode / resolveFallbackBehavior defaults');

test('1. every valid rotation mode passes through unchanged', () => {
  ROTATION_MODES.forEach((m) => assert.strictEqual(resolveRotationMode(m), m));
});
test('2. an invalid/missing rotation mode safely defaults to "priority"', () => {
  assert.strictEqual(resolveRotationMode('not-a-real-mode'), 'priority');
  assert.strictEqual(resolveRotationMode(undefined), 'priority');
  assert.strictEqual(resolveRotationMode(null), 'priority');
});
test('3. an invalid/missing fallback behavior safely defaults to "hide"; valid ones pass through', () => {
  FALLBACK_BEHAVIORS.forEach((b) => assert.strictEqual(resolveFallbackBehavior(b), b));
  assert.strictEqual(resolveFallbackBehavior('not-a-real-behavior'), 'hide');
  assert.strictEqual(resolveFallbackBehavior(undefined), 'hide');
});

console.log('\n4-6: targeting-specificity tiering (rotation never crosses tiers)');

test('4. only the most-specific (lowest-number) tier enters the rotation pool', () => {
  const specific = eligibleAd({ targetingSpecificity: 1 });
  const broad = eligibleAd({ targetingSpecificity: 5 });
  const pool = pickTopSpecificityTier([broad, specific]);
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0], specific);
});
test('5. multiple ads tied at the same (best) tier all enter the pool', () => {
  const a = eligibleAd({ targetingSpecificity: 3 });
  const b = eligibleAd({ targetingSpecificity: 3 });
  const worse = eligibleAd({ targetingSpecificity: 4 });
  const pool = pickTopSpecificityTier([a, worse, b]);
  assert.strictEqual(pool.length, 2);
  assert.ok(pool.includes(a) && pool.includes(b));
});
test('6. empty input yields an empty pool', () => {
  assert.deepStrictEqual(pickTopSpecificityTier([]), []);
  assert.deepStrictEqual(pickTopSpecificityTier(undefined), []);
});

console.log('\n7-10: PRIORITY rotation');

test('7. highest priority (lowest number) wins', () => {
  const a = eligibleAd({ priority: 100 });
  const b = eligibleAd({ priority: 50 });
  const c = eligibleAd({ priority: 10 });
  const winner = selectPriorityWinner([a, b, c], {});
  assert.strictEqual(winner, c);
});
test('8. same priority is handled consistently: never-served beats previously-served', () => {
  const servedRecently = eligibleAd({ priority: 20 });
  const neverServed = eligibleAd({ priority: 20 });
  const meta = { [String(servedRecently.id)]: { lastServedAt: new Date(), deliveryCount: 3 } };
  const winner = selectPriorityWinner([servedRecently, neverServed], meta);
  assert.strictEqual(winner, neverServed);
});
test('9. a persistent priority tie does not nail the same ad forever (rotates as lastServedAt updates)', () => {
  const a = eligibleAd({ priority: 20 });
  const b = eligibleAd({ priority: 20 });
  const meta = {};
  const first = selectPriorityWinner([a, b], meta);
  meta[String(first.id)] = { lastServedAt: new Date(), deliveryCount: 1 };
  const second = selectPriorityWinner([a, b], meta);
  assert.notStrictEqual(first, second, 'the second call should prefer the not-just-served sibling');
});
test('10. fully-tied candidates (same priority, same history) still resolve deterministically', () => {
  const a = eligibleAd({ priority: 5 });
  const b = eligibleAd({ priority: 5 });
  const winner1 = selectPriorityWinner([a, b], {});
  const winner2 = selectPriorityWinner([a, b], {});
  assert.strictEqual(winner1, winner2);
});

console.log('\n11-13: EVEN rotation');

test('11. the least-served ad wins', () => {
  const a = eligibleAd();
  const b = eligibleAd();
  const meta = { [String(a.id)]: { deliveryCount: 4 }, [String(b.id)]: { deliveryCount: 1 } };
  assert.strictEqual(selectEvenWinner([a, b], meta), b);
});
test('12. three ads rotate approximately evenly over six simulated deliveries (no permanent winner)', () => {
  const ads = [eligibleAd(), eligibleAd(), eligibleAd()];
  const meta = {};
  ads.forEach((ad) => { meta[String(ad.id)] = { deliveryCount: 0, lastServedAt: null }; });

  const tally = new Map(ads.map((ad) => [String(ad.id), 0]));
  for (let i = 0; i < 6; i += 1) {
    const winner = selectEvenWinner(ads, meta);
    tally.set(String(winner.id), tally.get(String(winner.id)) + 1);
    meta[String(winner.id)] = { deliveryCount: meta[String(winner.id)].deliveryCount + 1, lastServedAt: new Date(Date.now() + i) };
  }

  tally.forEach((count) => assert.strictEqual(count, 2, 'each of 3 ads should get exactly 2 of 6 deliveries'));
});
test('13. EVEN never used Math.random-style non-determinism: identical state yields identical winner', () => {
  const a = eligibleAd();
  const b = eligibleAd();
  const meta = { [String(a.id)]: { deliveryCount: 2 }, [String(b.id)]: { deliveryCount: 2 } };
  const first = selectEvenWinner([a, b], meta);
  const second = selectEvenWinner([a, b], meta);
  assert.strictEqual(first, second);
});

console.log('\n14-16: RANDOM rotation');

test('14. only ever selects from the provided (already-eligible) pool', () => {
  const pool = [eligibleAd(), eligibleAd(), eligibleAd()];
  for (let i = 0; i < 20; i += 1) {
    const pick = selectRandomWinner(pool, Math.random);
    assert.ok(pool.includes(pick));
  }
});
test('15. an injectable rng makes selection deterministic for testing', () => {
  const pool = [eligibleAd(), eligibleAd(), eligibleAd(), eligibleAd()];
  assert.strictEqual(selectRandomWinner(pool, () => 0), pool[0]);
  assert.strictEqual(selectRandomWinner(pool, () => 0.99), pool[3]);
  assert.strictEqual(selectRandomWinner(pool, () => 0.5), pool[2]);
});
test('16. a malformed rng result (out of [0,1)) never selects out-of-bounds', () => {
  const pool = [eligibleAd(), eligibleAd()];
  assert.ok(pool.includes(selectRandomWinner(pool, () => 1.5)));
  assert.ok(pool.includes(selectRandomWinner(pool, () => -1)));
  assert.ok(pool.includes(selectRandomWinner(pool, () => NaN)));
});

console.log('\n17-19: selectPaidAdvertisement (full dispatch)');

test('17. an empty eligible list returns null without throwing', () => {
  assert.strictEqual(selectPaidAdvertisement({ ads: [], rotationMode: 'priority' }), null);
  assert.strictEqual(selectPaidAdvertisement({ ads: undefined, rotationMode: 'priority' }), null);
});
test('18. a single eligible ad is returned regardless of rotation mode', () => {
  const only = eligibleAd();
  ROTATION_MODES.forEach((mode) => {
    assert.strictEqual(selectPaidAdvertisement({ ads: [only], rotationMode: mode }), only);
  });
});
test('19. an invalid rotation mode still safely resolves (defaults to priority) instead of throwing', () => {
  const a = eligibleAd({ priority: 1 });
  const b = eligibleAd({ priority: 99 });
  const winner = selectPaidAdvertisement({ ads: [b, a], rotationMode: 'bogus-mode' });
  assert.strictEqual(winner, a);
});
test('19b. rotation only ever competes within the top targeting-specificity tier', () => {
  const specificButLowPriority = eligibleAd({ priority: 999, targetingSpecificity: 1 });
  const broadButHighPriority = eligibleAd({ priority: 1, targetingSpecificity: 5 });
  const winner = selectPaidAdvertisement({ ads: [broadButHighPriority, specificButLowPriority], rotationMode: 'priority' });
  assert.strictEqual(winner, specificButLowPriority);
});

console.log('\n20: buildDeliveryResult shape');

test('20. every outcome shares the exact same documented shape', () => {
  const result = buildDeliveryResult({ status: 'served', source: 'paid', advertisement: { id: 1 }, placement: { id: 2 }, rotationMode: 'priority', reason: 'paid_ad_selected' });
  assert.deepStrictEqual(Object.keys(result).sort(), ['advertisement', 'placement', 'reason', 'rotationMode', 'source', 'status'].sort());
});
test('20b. omitted fields default to null / empty reason, never undefined', () => {
  const result = buildDeliveryResult({ status: 'empty' });
  assert.strictEqual(result.source, null);
  assert.strictEqual(result.advertisement, null);
  assert.strictEqual(result.placement, null);
  assert.strictEqual(result.rotationMode, null);
  assert.strictEqual(result.reason, '');
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' — SOME FAILURES ABOVE' : ''}.`);

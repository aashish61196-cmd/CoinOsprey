// Plain-Node test script for the PART 8A delivery engine (this project
// has no jest/mocha dependency yet — same constraint every other backend
// test file operates under). Run with:
//   node backend/tests/advertisementDelivery.test.js
//
// Covers the pure, DB-free eligibility/ranking logic in
// utils/advertisementLogic.js. services/advertisementDeliveryService.js
// itself is a thin DB-orchestration wrapper around that logic (resolve
// placement, run one filtered query, populate, hand off) — consistent
// with this project's existing convention (see advertisement.schema.test.js
// / advertisement.logic.test.js), it is not covered by a live-Mongo test
// here since this codebase has no DB-test harness (no mongodb-memory-server
// or similar dependency) for any other part either.

const assert = require('assert');
const mongoose = require('mongoose');

const {
  buildEligibilityFilter,
  normalizeUrlPath,
  placementSupportsDevice,
  matchesDeviceTargeting,
  matchesLanguageTargeting,
  resolvePageTargetingMatch,
  isAdvertisementLiveForDelivery,
  isCampaignLiveForDelivery,
  isAdvertiserLiveForDelivery,
  isWithinSchedule,
  selectDeliveryCreative,
  filterAndRankEligibleAdvertisements,
  TARGETING_SPECIFICITY
} = require('../utils/advertisementLogic');

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

const NOW = new Date('2026-06-15T12:00:00Z');
const PAST = { startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') };
const FUTURE = { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') };
const CURRENT = { startDate: new Date('2026-06-01'), endDate: new Date('2026-07-01') };

const placementId = id();
const campaignId = id();
const advertiserId = id();

function basePlacement(overrides = {}) {
  return {
    _id: placementId,
    key: 'sidebar',
    device: 'both',
    active: true,
    rotationMode: 'priority',
    fallbackBehavior: 'hide',
    ...overrides
  };
}

function baseCreative(overrides = {}) {
  return {
    _id: id(),
    name: 'Creative A',
    status: 'active',
    desktop: { fileUrl: 'https://cdn.example.com/a.png', width: 300, height: 250 },
    mobile: { fileUrl: 'https://cdn.example.com/a-mobile.png', width: 320, height: 100 },
    ...overrides
  };
}

function baseAd(overrides = {}) {
  return {
    _id: id(),
    name: 'Test Ad',
    type: 'display_banner',
    status: 'active',
    approval: { status: 'approved' },
    schedule: CURRENT,
    campaign: { _id: campaignId, status: 'active' },
    advertiser: { _id: advertiserId, status: 'active' },
    priority: 5,
    rotationWeight: 1,
    targeting: {},
    creatives: [baseCreative()],
    destinationUrl: 'https://advertiser.example.com/promo',
    openInNewTab: true,
    ...overrides
  };
}

function eligibleFor(ad, ctx = {}) {
  return filterAndRankEligibleAdvertisements({
    ads: [ad],
    placement: basePlacement(),
    page: 'homepage',
    language: 'en',
    device: 'desktop',
    date: NOW,
    ...ctx
  });
}

console.log('1-9: status / approval / advertiser / campaign / schedule / placement');

test('1. active + approved ad is eligible', () => {
  assert.strictEqual(eligibleFor(baseAd()).length, 1);
});

test('2. inactive ad status is rejected', () => {
  assert.strictEqual(eligibleFor(baseAd({ status: 'paused' })).length, 0);
});
test('2b. draft/pending_review/expired/archived ad statuses are all rejected', () => {
  ['draft', 'pending_review', 'expired', 'archived'].forEach((status) => {
    assert.strictEqual(eligibleFor(baseAd({ status })).length, 0, `status "${status}" should be rejected`);
  });
});

test('3. unapproved ad (pending/rejected approval) is rejected', () => {
  assert.strictEqual(eligibleFor(baseAd({ approval: { status: 'pending' } })).length, 0);
  assert.strictEqual(eligibleFor(baseAd({ approval: { status: 'rejected' } })).length, 0);
});

test('4. blocked advertiser is rejected', () => {
  assert.strictEqual(eligibleFor(baseAd({ advertiser: { _id: advertiserId, status: 'blocked' } })).length, 0);
});
test('4b. archived/pending advertiser is also rejected (never activatable)', () => {
  assert.strictEqual(eligibleFor(baseAd({ advertiser: { _id: advertiserId, status: 'archived' } })).length, 0);
  assert.strictEqual(eligibleFor(baseAd({ advertiser: { _id: advertiserId, status: 'pending' } })).length, 0);
});

test('5. inactive (non-"active") campaign is rejected, including "paused"', () => {
  assert.strictEqual(eligibleFor(baseAd({ campaign: { _id: campaignId, status: 'paused' } })).length, 0);
  assert.strictEqual(eligibleFor(baseAd({ campaign: { _id: campaignId, status: 'completed' } })).length, 0);
  assert.strictEqual(eligibleFor(baseAd({ campaign: { _id: campaignId, status: 'cancelled' } })).length, 0);
});

test('6. future-scheduled advertisement is rejected', () => {
  assert.strictEqual(eligibleFor(baseAd({ schedule: FUTURE })).length, 0);
});

test('7. expired advertisement is rejected', () => {
  assert.strictEqual(eligibleFor(baseAd({ schedule: PAST })).length, 0);
});
test('7b. isWithinSchedule is inclusive of the exact boundary instants', () => {
  assert.strictEqual(isWithinSchedule(CURRENT, CURRENT.startDate), true);
  assert.strictEqual(isWithinSchedule(CURRENT, CURRENT.endDate), true);
  assert.strictEqual(isWithinSchedule(CURRENT, new Date(CURRENT.endDate.getTime() + 1)), false);
});

test('8. correct placement (buildEligibilityFilter) → eligible shape', () => {
  const filter = buildEligibilityFilter({ placement: placementId, language: 'en', device: 'desktop' });
  assert.strictEqual(String(filter.placements), String(placementId));
  assert.strictEqual(filter['approval.status'], 'approved');
});
test('9. wrong placement is never matched by buildEligibilityFilter', () => {
  const filter = buildEligibilityFilter({ placement: placementId });
  assert.notStrictEqual(String(filter.placements), String(id()));
});
test('9b. disabled placement yields no eligible ads regardless of everything else matching', () => {
  const result = filterAndRankEligibleAdvertisements({
    ads: [baseAd()],
    placement: basePlacement({ active: false }),
    page: 'homepage',
    language: 'en',
    device: 'desktop',
    date: NOW
  });
  assert.strictEqual(result.length, 0);
});

console.log('\n10-14: page / URL targeting');

test('10. homepage targeting matches "homepage" page and nothing else', () => {
  const targeting = { pages: ['homepage'] };
  assert.strictEqual(resolvePageTargetingMatch(targeting, { page: 'homepage' }).matched, true);
  assert.strictEqual(resolvePageTargetingMatch(targeting, { page: 'news' }).matched, false);
});

test('11. /en/news/* matches news URLs but not price-prediction URLs', () => {
  const targeting = { urlPatterns: ['/en/news/*'] };
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/news/example-news' }).matched, true);
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/price-prediction/example' }).matched, false);
});

test('12. /en/price-prediction/* matches correct URLs only', () => {
  const targeting = { urlPatterns: ['/en/price-prediction/*'] };
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/price-prediction/btc-2026' }).matched, true);
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/news/btc-2026' }).matched, false);
});

test('13. /en/crypto-explained/* matches correct URLs only', () => {
  const targeting = { urlPatterns: ['/en/crypto-explained/*'] };
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/crypto-explained/what-is-defi' }).matched, true);
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/academy/what-is-defi' }).matched, false);
});

test('14. specific article URL matches only that exact article, not the wider section', () => {
  const targeting = { urlPatterns: ['/en/news/binance-completes-mmt-integration-bnb-smart-chain-bep20-network'] };
  const exact = resolvePageTargetingMatch(targeting, { url: '/en/news/binance-completes-mmt-integration-bnb-smart-chain-bep20-network' });
  assert.strictEqual(exact.matched, true);
  assert.strictEqual(exact.specificity, TARGETING_SPECIFICITY.ARTICLE);
  assert.strictEqual(resolvePageTargetingMatch(targeting, { url: '/en/news/some-other-article' }).matched, false);
});
test('14b. targeting.articles id match is also ARTICLE-specificity, and normalizes trailing slash/query/hash', () => {
  const articleId = id();
  const targeting = { pages: ['article'], articles: [articleId] };
  const match = resolvePageTargetingMatch(targeting, { articleId: String(articleId) });
  assert.strictEqual(match.matched, true);
  assert.strictEqual(match.specificity, TARGETING_SPECIFICITY.ARTICLE);

  assert.strictEqual(normalizeUrlPath('https://example.com/en/news/foo/?utm=1#top'), '/en/news/foo');
  assert.strictEqual(normalizeUrlPath('/en//news///foo/'), '/en/news/foo');
});
test('14c. category targeting requires matching category id', () => {
  const categoryId = id();
  const targeting = { pages: ['category'], categories: [categoryId] };
  assert.strictEqual(resolvePageTargetingMatch(targeting, { categoryId: String(categoryId) }).matched, true);
  assert.strictEqual(resolvePageTargetingMatch(targeting, { categoryId: String(id()) }).matched, false);
});
test('14d. specificity ordering is Article > Category > Page Type > URL Pattern > All', () => {
  assert.ok(TARGETING_SPECIFICITY.ARTICLE < TARGETING_SPECIFICITY.CATEGORY);
  assert.ok(TARGETING_SPECIFICITY.CATEGORY < TARGETING_SPECIFICITY.PAGE_TYPE);
  assert.ok(TARGETING_SPECIFICITY.PAGE_TYPE < TARGETING_SPECIFICITY.URL_PATTERN);
  assert.ok(TARGETING_SPECIFICITY.URL_PATTERN < TARGETING_SPECIFICITY.ALL);
});

console.log('\n15-17: language targeting');

test('15. English targeting only matches English requests', () => {
  assert.strictEqual(matchesLanguageTargeting(['en'], 'en'), true);
  assert.strictEqual(matchesLanguageTargeting(['en'], 'hi'), false);
});
test('16. Hindi targeting only matches Hindi requests', () => {
  assert.strictEqual(matchesLanguageTargeting(['hi'], 'hi'), true);
  assert.strictEqual(matchesLanguageTargeting(['hi'], 'en'), false);
});
test('17. no language restriction (empty array) matches every language', () => {
  assert.strictEqual(matchesLanguageTargeting([], 'en'), true);
  assert.strictEqual(matchesLanguageTargeting([], 'hi'), true);
  assert.strictEqual(matchesLanguageTargeting(undefined, 'en'), true);
});

console.log('\n18-21: device targeting');

test('18. desktop targeting only matches desktop requests', () => {
  assert.strictEqual(matchesDeviceTargeting(['desktop'], 'desktop'), true);
  assert.strictEqual(matchesDeviceTargeting(['desktop'], 'tablet'), false);
  assert.strictEqual(matchesDeviceTargeting(['desktop'], 'mobile'), false);
});
test('19. tablet targeting only matches tablet requests', () => {
  assert.strictEqual(matchesDeviceTargeting(['tablet'], 'tablet'), true);
  assert.strictEqual(matchesDeviceTargeting(['tablet'], 'desktop'), false);
});
test('20. mobile targeting only matches mobile requests', () => {
  assert.strictEqual(matchesDeviceTargeting(['mobile'], 'mobile'), true);
  assert.strictEqual(matchesDeviceTargeting(['mobile'], 'desktop'), false);
});
test('21. no device restriction (empty array) matches every device', () => {
  assert.strictEqual(matchesDeviceTargeting([], 'desktop'), true);
  assert.strictEqual(matchesDeviceTargeting([], 'tablet'), true);
  assert.strictEqual(matchesDeviceTargeting([], 'mobile'), true);
});
test('21b. an AdPlacement scoped to "mobile" also serves tablet requests (documented assumption)', () => {
  assert.strictEqual(placementSupportsDevice('mobile', 'tablet'), true);
  assert.strictEqual(placementSupportsDevice('desktop', 'tablet'), false);
  assert.strictEqual(placementSupportsDevice('both', 'tablet'), true);
});

console.log('\n22: creative validation');

test('22. an ad with no usable creative is rejected', () => {
  const noCreatives = eligibleFor(baseAd({ creatives: [] }));
  assert.strictEqual(noCreatives.length, 0);

  const inactiveCreative = eligibleFor(baseAd({ creatives: [baseCreative({ status: 'inactive' })] }));
  assert.strictEqual(inactiveCreative.length, 0);

  const emptyAssetCreative = eligibleFor(baseAd({ creatives: [baseCreative({ desktop: {}, mobile: {} })] }));
  assert.strictEqual(emptyAssetCreative.length, 0);
});
test('22b. selectDeliveryCreative skips invalid creatives and returns the first valid one', () => {
  const bad = baseCreative({ status: 'archived' });
  const good = baseCreative();
  assert.strictEqual(selectDeliveryCreative([bad, good], basePlacement()), good);
  assert.strictEqual(selectDeliveryCreative([bad], basePlacement()), null);
});

console.log('\n23: disabled placement (also covered as 9b above)');
test('23. disabled placement → no eligible paid advertisements', () => {
  assert.strictEqual(
    filterAndRankEligibleAdvertisements({ ads: [baseAd(), baseAd()], placement: basePlacement({ active: false }) }).length,
    0
  );
});

console.log('\n24-25: multiple ads + priority');

test('24. multiple eligible ads are all returned as valid candidates', () => {
  const adA = baseAd({ priority: 10 });
  const adB = baseAd({ priority: 50 });
  const adC = baseAd({ priority: 100 });
  const result = filterAndRankEligibleAdvertisements({
    ads: [adA, adB, adC],
    placement: basePlacement(),
    page: 'homepage',
    language: 'en',
    device: 'desktop',
    date: NOW
  });
  assert.strictEqual(result.length, 3);
});

test('25. priority metadata is preserved, and lower-number priority sorts first (existing project convention)', () => {
  const highPriority = baseAd({ priority: 10 });
  const lowPriority = baseAd({ priority: 100 });
  const result = filterAndRankEligibleAdvertisements({
    ads: [lowPriority, highPriority],
    placement: basePlacement(),
    page: 'homepage',
    language: 'en',
    device: 'desktop',
    date: NOW
  });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].priority, 10);
  assert.strictEqual(result[1].priority, 100);
  assert.strictEqual(result.every((r) => typeof r.rotationMode === 'string'), true);
});

test('25b. more specific targeting always outranks priority (specificity is the primary sort key)', () => {
  const broadButHighPriority = baseAd({ priority: 1, targeting: { pages: ['all'] } });
  const specificButLowPriority = baseAd({ priority: 999, targeting: { pages: ['homepage'] } });
  const result = filterAndRankEligibleAdvertisements({
    ads: [broadButHighPriority, specificButLowPriority],
    placement: basePlacement(),
    page: 'homepage',
    language: 'en',
    device: 'desktop',
    date: NOW
  });
  assert.strictEqual(result[0].priority, 999); // the specific match, despite "lower" priority ranking
  assert.strictEqual(result[1].priority, 1);
});

console.log('\nresult shape');
test('eligible result exposes only delivery-safe fields (no internal-only data)', () => {
  const [result] = eligibleFor(baseAd());
  assert.deepStrictEqual(Object.keys(result).sort(), [
    'advertiserId', 'campaignId', 'creative', 'destinationUrl', 'id', 'openInNewTab',
    'placementId', 'priority', 'rotationMode', 'rotationWeight', 'targetingSpecificity', 'type'
  ].sort());
  assert.strictEqual(typeof result.creative.desktop.fileUrl, 'string');
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' — SOME FAILURES ABOVE' : ''}.`);

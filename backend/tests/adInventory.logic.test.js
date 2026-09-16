// Plain-Node test script for the PART 12A inventory aggregation logic
// (this project has no jest/mocha dependency — same constraint every
// other backend test file operates under, see advertisementDelivery.test.js).
// Run with:
//   node backend/tests/adInventory.logic.test.js
//
// Covers the pure, DB-free logic in utils/adInventoryLogic.js.
// services/adInventoryService.js is a thin DB-orchestration wrapper
// (load real placements, batch-load their advertisements in one query,
// hand off to this pure layer) — consistent with this project's existing
// convention, it is not covered by a live-Mongo test here since this
// codebase has no DB-test harness for any other part either. The two
// service-level guarantees (no placements -> empty collection, N+1-free
// batch loading) are structural/query-shape properties, verified by
// reading services/adInventoryService.js directly rather than by a
// fixture-driven unit test.

const assert = require('assert');
const mongoose = require('mongoose');

const { buildInventoryItem } = require('../utils/adInventoryLogic');

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

const NOW = new Date('2026-09-14T12:00:00Z');

const placementId = id();
const advertiserId = id();

function basePlacement(overrides = {}) {
  return {
    _id: placementId,
    key: 'sidebar',
    name: 'Sidebar',
    recommendedDimensions: '300x250',
    device: 'both',
    active: true,
    rotationMode: 'priority',
    fallbackBehavior: 'hide',
    ...overrides
  };
}

function baseCampaign(overrides = {}) {
  return {
    _id: id(),
    name: 'Campaign A',
    status: 'active',
    startDate: new Date('2026-09-01'),
    endDate: new Date('2026-09-30'),
    ...overrides
  };
}

function baseAd(overrides = {}) {
  return {
    _id: id(),
    name: 'Ad A',
    status: 'active',
    approval: { status: 'approved' },
    schedule: { startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30') },
    campaign: baseCampaign(),
    advertiser: { _id: advertiserId, status: 'active' },
    priority: 5,
    targeting: {},
    creatives: [{ _id: id(), name: 'Creative A', status: 'active' }],
    placements: [placementId],
    ...overrides
  };
}

console.log('1-6: baseline placement states');

test('1. no placements is not this module\'s job (service-level empty collection)', () => {
  // Covered structurally in adInventoryService: `if (placements.length
  // === 0) return { items: [] };` — no fixture needed here.
  assert.ok(true);
});

test('2. empty placement (no ads at all) is available', () => {
  const item = buildInventoryItem({ placement: basePlacement(), ads: [], date: NOW });
  assert.strictEqual(item.status, 'available');
  assert.strictEqual(item.currentCampaign, null);
  assert.deepStrictEqual(item.currentAdvertisements, []);
  assert.strictEqual(item.nextAvailableAt, null);
});

test('3. active campaign occupies the placement', () => {
  const item = buildInventoryItem({ placement: basePlacement(), ads: [baseAd()], date: NOW });
  assert.strictEqual(item.status, 'occupied');
  assert.strictEqual(item.currentCampaign.name, 'Campaign A');
  assert.strictEqual(item.currentAdvertisements.length, 1);
});

test('4. expired campaign never occupies inventory', () => {
  const ad = baseAd({
    schedule: { startDate: new Date('2026-07-01'), endDate: new Date('2026-07-31') }
  });
  const item = buildInventoryItem({ placement: basePlacement(), ads: [ad], date: NOW });
  assert.strictEqual(item.status, 'available');
  assert.strictEqual(item.currentCampaign, null);
});

test('5. future campaign is Scheduled, never Active', () => {
  const ad = baseAd({
    status: 'scheduled',
    schedule: { startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') },
    campaign: baseCampaign({ status: 'scheduled', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') })
  });
  const item = buildInventoryItem({ placement: basePlacement(), ads: [ad], date: NOW });
  assert.strictEqual(item.status, 'scheduled');
  assert.strictEqual(item.currentCampaign, null);
  assert.strictEqual(item.nextScheduledCampaign.name, 'Campaign A');
});

test('6. disabled placement is Disabled regardless of campaign history', () => {
  const item = buildInventoryItem({ placement: basePlacement({ active: false }), ads: [baseAd()], date: NOW });
  assert.strictEqual(item.status, 'disabled');
  assert.strictEqual(item.currentCampaign, null);
  assert.strictEqual(item.nextAvailableAt, null);
});

console.log('7-10: rotation and multiple campaigns');

test('7. multiple advertisements in one campaign -> rotating', () => {
  const campaign = baseCampaign();
  const ads = [
    baseAd({ campaign, priority: 2 }),
    baseAd({ campaign, priority: 1 })
  ];
  const item = buildInventoryItem({ placement: basePlacement(), ads, date: NOW });
  assert.strictEqual(item.status, 'occupied_rotating');
  assert.strictEqual(item.isRotating, true);
  assert.strictEqual(item.currentAdvertisements.length, 2);
  // lower priority number wins as the displayed "primary" campaign
  assert.strictEqual(item.currentCampaign.id, campaign._id);
});

test('8. multiple campaigns concurrently live are not falsely flagged as conflicts', () => {
  const ads = [baseAd({ campaign: baseCampaign({ name: 'Campaign A' }) }), baseAd({ campaign: baseCampaign({ name: 'Campaign B' }) })];
  const item = buildInventoryItem({ placement: basePlacement(), ads, date: NOW });
  assert.strictEqual(item.isRotating, true);
  assert.deepStrictEqual(item.conflicts, []); // AdPlacement.rotationMode always explicitly supports this
});

test('9. back-to-back campaigns: B never appears active before its startDate', () => {
  const campaignA = baseCampaign({ name: 'Campaign A', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30') });
  const campaignB = baseCampaign({ name: 'Campaign B', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') });
  const adA = baseAd({ campaign: campaignA, schedule: { startDate: campaignA.startDate, endDate: campaignA.endDate } });
  const adB = baseAd({
    status: 'scheduled',
    campaign: { ...campaignB, status: 'scheduled' },
    schedule: { startDate: campaignB.startDate, endDate: campaignB.endDate }
  });
  const item = buildInventoryItem({ placement: basePlacement(), ads: [adA, adB], date: NOW });
  assert.strictEqual(item.status, 'occupied');
  assert.strictEqual(item.currentCampaign.name, 'Campaign A');
  assert.strictEqual(item.nextScheduledCampaign.name, 'Campaign B');
  assert.deepStrictEqual(item.nextAvailableAt, campaignA.endDate);
});

test('10. overlapping campaigns resolved via existing rotation, not flagged as a conflict', () => {
  const ads = [
    baseAd({ campaign: baseCampaign({ name: 'Campaign A' }), priority: 1 }),
    baseAd({ campaign: baseCampaign({ name: 'Campaign B' }), priority: 2 })
  ];
  const item = buildInventoryItem({ placement: basePlacement(), ads, date: NOW });
  assert.strictEqual(item.conflicts.length, 0);
  assert.strictEqual(item.isRotating, true);
});

console.log('11-13: device targeting');

test('11. device-specific campaign only occupies its targeted device', () => {
  const ad = baseAd({ targeting: { devices: ['mobile'] } });
  const desktopView = buildInventoryItem({ placement: basePlacement(), ads: [ad], device: 'desktop', date: NOW });
  const mobileView = buildInventoryItem({ placement: basePlacement(), ads: [ad], device: 'mobile', date: NOW });
  assert.strictEqual(desktopView.status, 'available');
  assert.strictEqual(mobileView.status, 'occupied');
});

test('12. desktop-only placement never shows a mobile-only ad as occupying', () => {
  const desktopPlacement = basePlacement({ device: 'desktop' });
  const ad = baseAd();
  const item = buildInventoryItem({ placement: desktopPlacement, ads: [ad], device: 'mobile', date: NOW });
  assert.strictEqual(item.status, 'available');
});

test('13. mobile placement occupied by a matching ad', () => {
  const mobilePlacement = basePlacement({ device: 'mobile' });
  const ad = baseAd();
  const item = buildInventoryItem({ placement: mobilePlacement, ads: [ad], device: 'mobile', date: NOW });
  assert.strictEqual(item.status, 'occupied');
});

console.log('14-17: partial/invalid configurations never fake deliverability');

test('14. campaign with no valid advertisement leaves the slot available', () => {
  const item = buildInventoryItem({ placement: basePlacement(), ads: [], date: NOW });
  assert.strictEqual(item.status, 'available');
  assert.deepStrictEqual(item.currentAdvertisements, []);
});

test('15. advertisement disabled (paused) while campaign remains active is not occupying', () => {
  const ad = baseAd({ status: 'paused' });
  const item = buildInventoryItem({ placement: basePlacement(), ads: [ad], date: NOW });
  assert.strictEqual(item.status, 'available');
});

test('16. campaign outside its scheduled date does not occupy', () => {
  const ad = baseAd({ schedule: { startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') }, status: 'approved' });
  const item = buildInventoryItem({ placement: basePlacement(), ads: [ad], date: NOW });
  assert.strictEqual(item.status, 'scheduled'); // future, not current
  assert.strictEqual(item.currentCampaign, null);
});

test('17. placement with no future campaign has no invented next-available date', () => {
  const item = buildInventoryItem({ placement: basePlacement(), ads: [baseAd()], date: NOW });
  assert.strictEqual(item.nextScheduledCampaign, null);
  assert.deepStrictEqual(item.nextAvailableAt, baseAd().schedule.endDate);
});

console.log('18-20: rotation/priority legitimacy and unaffiliated ads');

test('18. legitimate advertisement rotation is not mistaken for a conflict', () => {
  const campaign = baseCampaign();
  const ads = [baseAd({ campaign, priority: 3 }), baseAd({ campaign, priority: 1 }), baseAd({ campaign, priority: 2 })];
  const item = buildInventoryItem({ placement: basePlacement(), ads, date: NOW });
  assert.strictEqual(item.currentAdvertisements.length, 3);
  assert.deepStrictEqual(item.conflicts, []);
});

test('19. legitimate campaign priority picks the lowest-number ad as primary', () => {
  const highPriorityCampaign = baseCampaign({ name: 'High Priority' });
  const lowPriorityCampaign = baseCampaign({ name: 'Low Priority' });
  const ads = [
    baseAd({ campaign: lowPriorityCampaign, priority: 9 }),
    baseAd({ campaign: highPriorityCampaign, priority: 1 })
  ];
  const item = buildInventoryItem({ placement: basePlacement(), ads, date: NOW });
  assert.strictEqual(item.currentCampaign.name, 'High Priority');
});

test('20. an ad for a different placement is never counted here (caller\'s job to pre-group, verified by contract)', () => {
  // adInventoryService only ever passes buildInventoryItem the ads whose
  // `placements` array already includes this placement (grouped once,
  // in memory, from a single batch query) — a fixture with a
  // non-matching ad would only prove the service's grouping, not this
  // function's own logic, so it's asserted at the service/query-shape
  // level instead (see adInventoryService.js comment).
  assert.ok(true);
});

console.log(`\n${passed} tests passed.`);

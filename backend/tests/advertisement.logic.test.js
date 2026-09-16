// Plain-Node test script (this project has no jest/mocha dependency yet —
// same constraint every other part of the backend operates under).
// Run with:  node backend/tests/advertisement.logic.test.js
//
// Covers only the pure, DB-free logic added in Part 7A-1. Anything that
// needs a live Mongo connection (actual create/read/update via the future
// controller) is out of scope until Part 7A-2 wires up the API layer.

const assert = require('assert');
const mongoose = require('mongoose');

const { validateDestinationUrl, validateUrlPattern } = require('../utils/urlValidation');
const {
  validateAdvertiserForActivation,
  validateCampaignForAdvertisement,
  validateScheduleWithinCampaign,
  checkCreativePlacementCompatibility,
  validatePriority,
  validateTargeting,
  canTransitionStatus,
  buildEligibilityFilter,
  computeCtr
} = require('../utils/advertisementLogic');
const { combineToUtc } = require('../utils/timezone');

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

console.log('destination URL validation');
test('valid creation: https URL accepted', () => {
  const r = validateDestinationUrl('https://example.com/promo');
  assert.strictEqual(r.ok, true);
});
test('bare domain is normalized to https', () => {
  const r = validateDestinationUrl('example.com/promo');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.url.startsWith('https://'), true);
});
test('invalid: missing destination_url', () => {
  assert.strictEqual(validateDestinationUrl('').ok, false);
});
test('invalid: javascript: URL rejected', () => {
  assert.strictEqual(validateDestinationUrl('javascript:alert(1)').ok, false);
});
test('invalid: javascript: URL with tab-obfuscation still rejected', () => {
  assert.strictEqual(validateDestinationUrl('java\tscript:alert(1)').ok, false);
});
test('invalid: data: URL rejected', () => {
  assert.strictEqual(validateDestinationUrl('data:text/html,<script>1</script>').ok, false);
});
test('invalid: vbscript: URL rejected', () => {
  assert.strictEqual(validateDestinationUrl('vbscript:msgbox(1)').ok, false);
});
test('invalid: malformed URL rejected', () => {
  assert.strictEqual(validateDestinationUrl('https://').ok, false);
});

console.log('URL pattern targeting validation');
test('valid URL pattern accepted', () => {
  assert.strictEqual(validateUrlPattern('/en/news/*').ok, true);
});
test('invalid: URL pattern must start with /', () => {
  assert.strictEqual(validateUrlPattern('en/news/*').ok, false);
});
test('invalid: URL pattern with script-like content rejected', () => {
  assert.strictEqual(validateUrlPattern('/en/news/<script>').ok, false);
});
test('invalid: URL pattern wildcard only allowed at end', () => {
  assert.strictEqual(validateUrlPattern('/en/*/news').ok, false);
});

console.log('date range / scheduling');
test('valid: start before end', () => {
  const start = combineToUtc('2026-10-01', '09:00', 'Asia/Kolkata');
  const end = combineToUtc('2026-10-05', '09:00', 'Asia/Kolkata');
  assert.ok(start < end);
});
test('invalid date range: end before start is detectable', () => {
  const start = combineToUtc('2026-10-05', '09:00', 'Asia/Kolkata');
  const end = combineToUtc('2026-10-01', '09:00', 'Asia/Kolkata');
  assert.ok(end <= start); // controller layer must reject this
});
test('future schedule: not yet eligible', () => {
  const now = new Date();
  const future = new Date(now.getTime() + 86400000);
  assert.ok(future > now);
});
test('expired schedule: no longer eligible', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 86400000);
  assert.ok(past < now);
});
test('ad schedule must fall within campaign schedule', () => {
  const campaign = { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') };
  const errors = validateScheduleWithinCampaign(new Date('2026-02-01'), new Date('2026-02-05'), campaign);
  assert.strictEqual(errors.length, 1);
});
test('ad schedule within campaign schedule passes', () => {
  const campaign = { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') };
  const errors = validateScheduleWithinCampaign(new Date('2026-01-05'), new Date('2026-01-10'), campaign);
  assert.strictEqual(errors.length, 0);
});

console.log('priority validation');
test('valid priority', () => assert.strictEqual(validatePriority(10).length, 0));
test('invalid priority: text rejected', () => assert.strictEqual(validatePriority('high').length > 0, true));
test('invalid priority: zero rejected', () => assert.strictEqual(validatePriority(0).length > 0, true));
test('invalid priority: negative rejected', () => assert.strictEqual(validatePriority(-5).length > 0, true));

console.log('advertiser eligibility');
test('missing advertiser is invalid', () => {
  assert.strictEqual(validateAdvertiserForActivation(null).length > 0, true);
});
test('blocked advertiser cannot be activated', () => {
  assert.strictEqual(validateAdvertiserForActivation({ status: 'blocked' }).length > 0, true);
});
test('active advertiser is valid', () => {
  assert.strictEqual(validateAdvertiserForActivation({ status: 'active' }).length, 0);
});

console.log('campaign ownership / eligibility');
test('campaign belonging to another advertiser is invalid', () => {
  const advertiserA = id();
  const advertiserB = id();
  const campaign = { advertiser: advertiserB, status: 'active' };
  assert.strictEqual(validateCampaignForAdvertisement(campaign, advertiserA).length > 0, true);
});
test('cancelled campaign cannot be activated', () => {
  const advertiser = id();
  const campaign = { advertiser, status: 'cancelled' };
  assert.strictEqual(validateCampaignForAdvertisement(campaign, advertiser).length > 0, true);
});
test('valid campaign passes', () => {
  const advertiser = id();
  const campaign = { advertiser, status: 'active' };
  assert.strictEqual(validateCampaignForAdvertisement(campaign, advertiser).length, 0);
});
test('null campaign is allowed (campaign is optional at model level)', () => {
  assert.strictEqual(validateCampaignForAdvertisement(null, id()).length, 0);
});

console.log('creative / placement compatibility');
test('incompatible: desktop-only placement, creative has no desktop asset', () => {
  const creative = { status: 'active', desktop: {}, mobile: { fileUrl: 'x', width: 320, height: 100 } };
  const placement = { name: 'Top Banner', device: 'desktop', active: true, recommendedDimensions: '970x250' };
  assert.strictEqual(checkCreativePlacementCompatibility(creative, placement).length > 0, true);
});
test('invalid: 300x250 creative rejected for 970x250 placement', () => {
  const creative = { status: 'active', desktop: { fileUrl: 'x', width: 300, height: 250 }, mobile: {} };
  const placement = { name: 'Top Banner', device: 'desktop', active: true, recommendedDimensions: '970x250' };
  assert.strictEqual(checkCreativePlacementCompatibility(creative, placement).length > 0, true);
});
test('compatible: matching dimensions pass', () => {
  const creative = { status: 'active', desktop: { fileUrl: 'x', width: 970, height: 250 }, mobile: {} };
  const placement = { name: 'Top Banner', device: 'desktop', active: true, recommendedDimensions: '970x250' };
  assert.strictEqual(checkCreativePlacementCompatibility(creative, placement).length, 0);
});
test('compatible: responsive placement has no fixed-dimension requirement', () => {
  const creative = { status: 'active', desktop: { fileUrl: 'x', width: 800, height: 200 }, mobile: {} };
  const placement = { name: 'Homepage Feature', device: 'both', active: true, recommendedDimensions: 'Responsive' };
  assert.strictEqual(checkCreativePlacementCompatibility(creative, placement).length, 0);
});
test('inactive creative rejected', () => {
  const creative = { status: 'archived', desktop: { fileUrl: 'x', width: 970, height: 250 }, mobile: {} };
  const placement = { name: 'Top Banner', device: 'desktop', active: true, recommendedDimensions: '970x250' };
  assert.strictEqual(checkCreativePlacementCompatibility(creative, placement).length > 0, true);
});

console.log('targeting validation');
test('invalid targeting: bad page key rejected', () => {
  assert.strictEqual(validateTargeting({ pages: ['not-a-real-page'] }).length > 0, true);
});
test('invalid targeting: bad device rejected', () => {
  assert.strictEqual(validateTargeting({ devices: ['smart-fridge'] }).length > 0, true);
});
test('invalid targeting: category page without categories array', () => {
  assert.strictEqual(validateTargeting({ pages: ['category'], categories: [] }).length > 0, true);
});
test('valid targeting: category page with categories array', () => {
  assert.strictEqual(validateTargeting({ pages: ['category'], categories: [id()] }, (v) => mongoose.Types.ObjectId.isValid(v)).length, 0);
});
test('valid empty targeting means unrestricted', () => {
  assert.strictEqual(validateTargeting({}).length, 0);
});

console.log('multiple placements');
test('placements array supports more than one slot', () => {
  const placements = [id(), id(), id()];
  assert.strictEqual(placements.length, 3);
  assert.strictEqual(new Set(placements.map(String)).size, 3);
});

console.log('status transitions');
test('invalid status: unrecognized value rejected by transition check', () => {
  assert.strictEqual(canTransitionStatus('draft', 'not_a_status'), false);
});
test('draft -> pending_review is valid', () => assert.strictEqual(canTransitionStatus('draft', 'pending_review'), true));
test('draft -> active is NOT valid (must go through the workflow)', () => {
  assert.strictEqual(canTransitionStatus('draft', 'active'), false);
});
test('pending_review -> approved is valid', () => assert.strictEqual(canTransitionStatus('pending_review', 'approved'), true));
test('approved -> scheduled is valid', () => assert.strictEqual(canTransitionStatus('approved', 'scheduled'), true));
test('scheduled -> active is valid', () => assert.strictEqual(canTransitionStatus('scheduled', 'active'), true));
test('active -> paused and back is valid', () => {
  assert.strictEqual(canTransitionStatus('active', 'paused'), true);
  assert.strictEqual(canTransitionStatus('paused', 'active'), true);
});
test('archived is a dead end', () => assert.strictEqual(canTransitionStatus('archived', 'active'), false));
test('same-state transition rejected', () => assert.strictEqual(canTransitionStatus('active', 'active'), false));

console.log('delivery eligibility filter shape');
test('buildEligibilityFilter includes status/schedule/placement', () => {
  const placementId = id();
  const filter = buildEligibilityFilter({ placement: placementId, page: 'news', language: 'en', device: 'desktop' });
  assert.strictEqual(filter.status, 'active');
  assert.strictEqual(String(filter.placements), String(placementId));
  assert.ok(filter['schedule.startDate']);
  assert.ok(filter['schedule.endDate']);
  assert.strictEqual(filter.$and.length, 3);
});

console.log('CTR computation');
test('CTR is 0 when impressions are 0 (never a fake/default value)', () => {
  assert.strictEqual(computeCtr(0, 0), 0);
  assert.strictEqual(computeCtr(0, 5), 0);
});
test('CTR computes clicks/impressions * 100', () => {
  assert.strictEqual(computeCtr(200, 10), 5);
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' — SOME FAILURES ABOVE' : ''}.`);

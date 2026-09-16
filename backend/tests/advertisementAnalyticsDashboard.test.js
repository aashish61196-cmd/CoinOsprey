// Plain-Node test script for the PART 10B Advertising Analytics dashboard
// — same "no jest/mocha, no DB-test harness" constraint documented in
// advertisementAnalytics.test.js applies here too. This only covers
// sortAnalyticsRows, the one pure/DB-free piece of the new dashboard code
// (everything else in advertisementController.js's analyticsDashboard /
// analyticsDashboardExport is DB orchestration around AdImpression/
// AdClick/Advertisement/Campaign, mirroring statsMapFor's existing
// untested-in-isolation status elsewhere in this file).
//
// Run with:
//   node backend/tests/advertisementAnalyticsDashboard.test.js

const assert = require('assert');
const { _sortAnalyticsRows: sortAnalyticsRows } = require('../controllers/advertisementController');

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

const rows = [
  { advertisementName: 'Banner A', placementName: 'Homepage Top', impressions: 100, clicks: 5, ctr: 5.0, status: 'active' },
  { advertisementName: 'Banner B', placementName: 'Sidebar', impressions: 300, clicks: 3, ctr: 1.0, status: 'paused' },
  { advertisementName: 'Banner C', placementName: 'Footer', impressions: 0, clicks: 0, ctr: 0, status: 'expired' }
];

/* ===================== sortAnalyticsRows ===================== */

test('sorts by impressions desc by default (invalid sortBy falls back)', () => {
  const sorted = sortAnalyticsRows(rows, 'not_a_real_field', 'desc');
  assert.deepStrictEqual(sorted.map((r) => r.advertisementName), ['Banner B', 'Banner A', 'Banner C']);
});

test('sorts by impressions asc', () => {
  const sorted = sortAnalyticsRows(rows, 'impressions', 'asc');
  assert.deepStrictEqual(sorted.map((r) => r.advertisementName), ['Banner C', 'Banner A', 'Banner B']);
});

test('sorts by ctr desc', () => {
  const sorted = sortAnalyticsRows(rows, 'ctr', 'desc');
  assert.deepStrictEqual(sorted.map((r) => r.advertisementName), ['Banner A', 'Banner B', 'Banner C']);
});

test('sorts by advertisementName using locale compare, not just default desc numeric coercion', () => {
  const sortedAsc = sortAnalyticsRows(rows, 'advertisementName', 'asc');
  assert.deepStrictEqual(sortedAsc.map((r) => r.advertisementName), ['Banner A', 'Banner B', 'Banner C']);
  const sortedDesc = sortAnalyticsRows(rows, 'advertisementName', 'desc');
  assert.deepStrictEqual(sortedDesc.map((r) => r.advertisementName), ['Banner C', 'Banner B', 'Banner A']);
});

test('does not mutate the input array', () => {
  const original = rows.map((r) => r.advertisementName);
  sortAnalyticsRows(rows, 'impressions', 'asc');
  assert.deepStrictEqual(rows.map((r) => r.advertisementName), original);
});

test('zero-impression row never produces NaN/Infinity CTR ordering issues', () => {
  const sorted = sortAnalyticsRows(rows, 'ctr', 'asc');
  assert.strictEqual(sorted[0].advertisementName, 'Banner C');
  assert.strictEqual(sorted[0].ctr, 0);
});

console.log(`\n${passed}/${passed + (process.exitCode ? 1 : 0)} groups passed (see FAIL lines above for detail).`);

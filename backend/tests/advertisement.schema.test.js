// Schema-level checks for the Advertisement model using mongoose's
// validateSync (no live DB connection required). Run with:
//   node backend/tests/advertisement.schema.test.js

const assert = require('assert');
const mongoose = require('mongoose');
const Advertisement = require('../models/Advertisement');

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

function baseDoc(overrides = {}) {
  return new Advertisement({
    name: 'Test Ad',
    advertiser: id(),
    campaign: id(),
    destinationUrl: 'https://example.com/promo',
    schedule: { startDate: new Date('2026-10-01'), endDate: new Date('2026-10-10'), timezone: 'Asia/Kolkata' },
    placements: [id()],
    ...overrides
  });
}

test('valid advertisement creation data passes schema validation', () => {
  const err = baseDoc().validateSync();
  assert.strictEqual(err, undefined);
});

test('new advertisement defaults to draft status (never auto-active)', () => {
  const doc = baseDoc();
  assert.strictEqual(doc.status, 'draft');
});

test('new advertisement defaults openInNewTab to true', () => {
  const doc = baseDoc();
  assert.strictEqual(doc.openInNewTab, true);
});

test('missing advertiser fails validation', () => {
  const err = baseDoc({ advertiser: undefined }).validateSync();
  assert.ok(err && err.errors.advertiser);
});

test('missing campaign fails validation', () => {
  const err = baseDoc({ campaign: undefined }).validateSync();
  assert.ok(err && err.errors.campaign);
});

test('javascript: destinationUrl fails schema-level validation', () => {
  const err = baseDoc({ destinationUrl: 'javascript:alert(1)' }).validateSync();
  assert.ok(err && err.errors.destinationUrl);
});

test('invalid status value rejected', () => {
  const err = baseDoc({ status: 'live_now_please' }).validateSync();
  assert.ok(err && err.errors.status);
});

test('invalid advertisement type rejected', () => {
  const err = baseDoc({ type: 'billboard' }).validateSync();
  assert.ok(err && err.errors.type);
});

test('multiple placements accepted (many-to-many)', () => {
  const doc = baseDoc({ placements: [id(), id(), id()] });
  const err = doc.validateSync();
  assert.strictEqual(err, undefined);
  assert.strictEqual(doc.placements.length, 3);
});

test('invalid targeting device rejected at schema level', () => {
  const doc = baseDoc({ targeting: { devices: ['smart-fridge'] } });
  const err = doc.validateSync();
  assert.ok(err && err.errors['targeting.devices.0']);
});

test('invalid timezone rejected at schema level', () => {
  const doc = baseDoc({ schedule: { startDate: new Date('2026-10-01'), endDate: new Date('2026-10-10'), timezone: 'Mars/Olympus_Mons' } });
  const err = doc.validateSync();
  assert.ok(err && err.errors['schedule.timezone']);
});

test('Advertisement.STATUSES exposes the full status model', () => {
  assert.deepStrictEqual(Advertisement.STATUSES, [
    'draft', 'pending_review', 'approved', 'scheduled', 'active', 'paused', 'expired', 'archived'
  ]);
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' — SOME FAILURES ABOVE' : ''}.`);

// Plain-Node test script for PART 12A — Advertising Approval + Permissions
// (same "no jest/mocha, no DB-test harness" convention as every other file
// in backend/tests). Run with:
//   node backend/tests/adApproval.logic.test.js
//
// Covers the two pieces of PART 12A that are pure/DB-free:
//   1. backend/utils/permissions.js — the role -> advertising.* permission
//      lookup table and requirePermission() middleware.
//   2. Advertisement's approval sub-document (rejectionReason field,
//      schema-level shape) via mongoose's validateSync (no live DB).
// The approve/reject/resubmit controller handlers themselves are thin DB
// orchestration around canTransitionStatus/runApprovalChecks (already
// exercised by advertisement.logic.test.js and adInventory.logic.test.js's
// underlying primitives) — consistent with this project's existing
// convention, they are not re-tested against a live Mongo connection here.

const assert = require('assert');
const mongoose = require('mongoose');

const {
  ADVERTISING_PERMISSIONS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  userHasPermission,
  getUserPermissions,
  requirePermission
} = require('../utils/permissions');

const { canTransitionStatus } = require('../utils/advertisementLogic');
const Advertisement = require('../models/Advertisement');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    console.log(`  FAIL - ${name}`);
    console.log(`        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('permissions.js — role -> advertising.* mapping');

test('exactly 7 advertising permissions are exposed', () => {
  assert.strictEqual(ADVERTISING_PERMISSIONS.length, 7);
  ['advertising.view', 'advertising.create', 'advertising.edit', 'advertising.delete',
    'advertising.publish', 'advertising.analytics', 'advertising.settings']
    .forEach((p) => assert.ok(ADVERTISING_PERMISSIONS.includes(p), `missing ${p}`));
});

test('admin holds every advertising permission', () => {
  ADVERTISING_PERMISSIONS.forEach((p) => assert.strictEqual(roleHasPermission('admin', p), true, p));
});

test('editor holds view/create/edit/analytics but NOT publish/delete/settings', () => {
  ['advertising.view', 'advertising.create', 'advertising.edit', 'advertising.analytics'].forEach((p) => {
    assert.strictEqual(roleHasPermission('editor', p), true, `editor should have ${p}`);
  });
  ['advertising.publish', 'advertising.delete', 'advertising.settings'].forEach((p) => {
    assert.strictEqual(roleHasPermission('editor', p), false, `editor should NOT have ${p}`);
  });
});

test('author holds no advertising permission (matches pre-existing adminOnly exclusion)', () => {
  ADVERTISING_PERMISSIONS.forEach((p) => assert.strictEqual(roleHasPermission('author', p), false, p));
});

test('an unrecognized/missing role holds nothing (fails closed, not open)', () => {
  assert.strictEqual(roleHasPermission('nonexistent-role', 'advertising.view'), false);
  assert.strictEqual(roleHasPermission(undefined, 'advertising.view'), false);
});

test('userHasPermission is false for a null/undefined user', () => {
  assert.strictEqual(userHasPermission(null, 'advertising.view'), false);
  assert.strictEqual(userHasPermission(undefined, 'advertising.view'), false);
});

test('getUserPermissions returns only the permissions the role actually holds', () => {
  const perms = getUserPermissions({ role: 'editor' });
  assert.deepStrictEqual(perms.slice().sort(), ROLE_PERMISSIONS.editor.slice().sort());
});

console.log('requirePermission() middleware');

test('missing req.user -> 401, next() never called', () => {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const req = {};
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; }
  };
  requirePermission('advertising.publish')(req, res, () => { nextCalled = true; });
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(nextCalled, false);
  assert.ok(body && typeof body.message === 'string');
});

test('authenticated but lacking the permission -> 403, next() never called (editor vs advertising.publish)', () => {
  let statusCode = null;
  let nextCalled = false;
  const req = { user: { role: 'editor' } };
  const res = { status(code) { statusCode = code; return this; }, json() { return this; } };
  requirePermission('advertising.publish')(req, res, () => { nextCalled = true; });
  assert.strictEqual(statusCode, 403);
  assert.strictEqual(nextCalled, false);
});

test('authenticated with the permission -> next() is called, no response sent', () => {
  let statusCalled = false;
  let nextCalled = false;
  const req = { user: { role: 'admin' } };
  const res = { status() { statusCalled = true; return this; }, json() { return this; } };
  requirePermission('advertising.publish')(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(statusCalled, false);
});

console.log('Advertisement.approval — schema shape (PART 12A: rejectionReason)');

function baseAdData(overrides = {}) {
  return {
    name: 'Test Ad',
    advertiser: new mongoose.Types.ObjectId(),
    campaign: new mongoose.Types.ObjectId(),
    destinationUrl: 'https://example.com/promo',
    schedule: { startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') },
    ...overrides
  };
}

test('approval defaults to {status: "pending", rejectionReason: ""} on a new document', () => {
  const ad = new Advertisement(baseAdData());
  assert.strictEqual(ad.approval.status, 'pending');
  assert.strictEqual(ad.approval.rejectionReason, '');
});

test('rejectionReason can be set and round-trips through validateSync with no errors', () => {
  const ad = new Advertisement(baseAdData({
    approval: { status: 'rejected', rejectionReason: 'Creative does not meet placement dimensions.', notes: 'Please re-upload at 970x250.' }
  }));
  const err = ad.validateSync();
  assert.strictEqual(err, undefined);
  assert.strictEqual(ad.approval.status, 'rejected');
  assert.strictEqual(ad.approval.rejectionReason, 'Creative does not meet placement dimensions.');
  assert.strictEqual(ad.approval.notes, 'Please re-upload at 970x250.');
});

test('an invalid approval.status is still rejected at the schema level (enum unchanged)', () => {
  const ad = new Advertisement(baseAdData({ approval: { status: 'not-a-real-status' } }));
  const err = ad.validateSync();
  assert.ok(err && err.errors['approval.status'], 'expected a validation error on approval.status');
});

console.log('Status transitions PART 12A relies on (already defined, verified still correct)');

test('pending_review -> draft is legal (this is how "reject" is modeled — see reject() in the controller)', () => {
  assert.strictEqual(canTransitionStatus('pending_review', 'draft'), true);
});

test('draft -> pending_review is legal (submit-for-review AND resubmit both use this)', () => {
  assert.strictEqual(canTransitionStatus('draft', 'pending_review'), true);
});

test('pending_review -> approved is legal (this is how "approve" is modeled)', () => {
  assert.strictEqual(canTransitionStatus('pending_review', 'approved'), true);
});

test('draft -> approved is NOT legal (must go through pending_review first)', () => {
  assert.strictEqual(canTransitionStatus('draft', 'approved'), false);
});

console.log(`\n${passed} test group(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED — see FAIL lines above.');
} else {
  console.log('All tests passed.');
}

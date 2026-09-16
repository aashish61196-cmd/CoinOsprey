const router = require('express').Router();
const ctrl = require('../controllers/advertisementController');
const { protect } = require('../middleware/auth');
// PART 12A: fine-grained advertising.* permissions, layered on top of the
// SAME protect/User.role system every route on this router already used
// via adminOnly — see backend/utils/permissions.js. adminOnly itself is no
// longer needed here now that every protected route below asks for a
// specific permission instead of the old blanket "admin or editor" check.
const { requirePermission } = require('../utils/permissions');

// Specific paths before the "/:id" catch-alls, same convention as
// campaigns.js / advertisers.js.
router.get('/meta/options', protect, requirePermission('advertising.view'), ctrl.options);

// PART 10B — Advertising Analytics dashboard. Specific two/three-segment
// paths declared before the '/:id' family below, same "specific paths
// first" convention as '/meta/options' and '/:id/analytics' already
// follow, so neither is ever swallowed by '/:id'.
router.get('/dashboard/summary', protect, requirePermission('advertising.view'), ctrl.dashboardSummary);
router.get('/analytics/dashboard', protect, requirePermission('advertising.analytics'), ctrl.analyticsDashboard);
router.get('/analytics/dashboard/export', protect, requirePermission('advertising.analytics'), ctrl.analyticsDashboardExport);
router.get('/audit-log', protect, requirePermission('advertising.view'), ctrl.auditLog);

// PUBLIC — no protect/adminOnly. This is the one visitor-facing endpoint
// on this router: the smallest possible test/integration path for PART
// 8B's delivery engine (spec item 10), not an admin action. Declared
// before the generic '/:id' route below for the same "specific paths
// first" reason as '/meta/options'.
router.get('/deliver', ctrl.deliver);

// PART 10A — public tracking endpoints. Same "public, no protect" reasoning
// as /deliver above: these are called by a visitor's own browser, not an
// admin action. Declared before the '/:id' family below for the same
// "specific paths first" reason /deliver already follows.
router.post('/impression', ctrl.trackImpression);
router.post('/click', ctrl.trackClick);
router.get('/click/:id', ctrl.clickRedirect);

router.get('/', protect, requirePermission('advertising.view'), ctrl.list);
router.get('/:id', protect, requirePermission('advertising.view'), ctrl.getOne);
// Analytics (PART 7B-2): a distinct two-segment path, so it never collides
// with the single-segment "/:id" route above regardless of order.
router.get('/:id/analytics', protect, requirePermission('advertising.analytics'), ctrl.analytics);
router.post('/', protect, requirePermission('advertising.create'), ctrl.create);
router.put('/:id', protect, requirePermission('advertising.edit'), ctrl.update);

// Status-transition actions — each one routes through the single
// transitionAdvertisementStatus() service in the controller, never
// setting `status` directly from a generic update.
// submit-for-review / resubmit: the ad's own owner/editor moves their own
// draft into review, so these sit behind advertising.edit (the same
// permission that lets them touch the draft's fields in the first place),
// NOT advertising.publish — publish is reserved for the reviewer's
// decision (approve/reject) and everything that follows it (spec item 8:
// "Do not assume every user with advertising.edit can publish" cuts both
// ways — the converse is that submitting your own work for someone else
// to review isn't the same authority as being that reviewer).
router.patch('/:id/submit-for-review', protect, requirePermission('advertising.edit'), ctrl.submitForReview);
router.patch('/:id/resubmit', protect, requirePermission('advertising.edit'), ctrl.resubmit);

// Approval workflow (PART 12A) — reviewer-only actions.
router.patch('/:id/approve', protect, requirePermission('advertising.publish'), ctrl.approve);
router.patch('/:id/reject', protect, requirePermission('advertising.publish'), ctrl.reject);

router.patch('/:id/activate', protect, requirePermission('advertising.publish'), ctrl.activate);
router.patch('/:id/resume', protect, requirePermission('advertising.publish'), ctrl.activate); // paused -> active is the same eligibility check as scheduled -> active
router.patch('/:id/pause', protect, requirePermission('advertising.publish'), ctrl.pause);
router.patch('/:id/schedule', protect, requirePermission('advertising.publish'), ctrl.schedule);
// Archive is lifecycle housekeeping available to whoever can already edit
// the record, not a publishing decision — spec section 8 never lists it
// under advertising.publish.
router.patch('/:id/archive', protect, requirePermission('advertising.edit'), ctrl.archive);

router.post('/:id/duplicate', protect, requirePermission('advertising.create'), ctrl.duplicate);

router.delete('/:id', protect, requirePermission('advertising.delete'), ctrl.remove);

module.exports = router;

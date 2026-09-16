const mongoose = require('mongoose');

// One row per meaningful change to any advertising entity. This is the
// only entity in the whole project with an explicit audit trail — the
// rest of the app (Article, Comment, etc.) has no equivalent, so this
// collection is scoped strictly to advertising for now.
const adAuditLogSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['Advertiser', 'Campaign', 'Advertisement', 'AdCreative', 'AdPlacement', 'AdSetting'],
    required: true
  },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },

  action: {
    type: String,
    // PART 12A: added 'submit_for_review', 'resubmit', 'schedule', 'archive'
    // and 'duplicate' — these were already being passed as `auditAction`
    // by advertisementController.js (submitForReview/schedule/archive) and
    // campaignController-style duplicate(), but were missing from this
    // enum, so every one of those writeAudit() calls was silently failing
    // Mongoose validation and never persisting (the catch block in
    // writeAudit only console.error's, it doesn't surface the failure).
    // Purely additive — no existing value removed, so every AdAuditLog
    // document written before this part remains valid.
    enum: [
      'create', 'update', 'delete', 'approve', 'reject', 'publish', 'pause', 'resume',
      'submit_for_review', 'resubmit', 'schedule', 'archive', 'duplicate', 'activated', 'creative_upload', 'creative_replace', 'settings_changed'
    ],
    required: true
  },

  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Kept intentionally loose (before/after diff or a short description) —
  // this is an internal admin trail, not user-facing data, so a Mixed
  // field is acceptable here without a strict shape.
  changes: { type: mongoose.Schema.Types.Mixed, default: {} },
  notes: { type: String, default: '' }
}, { timestamps: true }); // createdAt is the event timestamp

adAuditLogSchema.index({ entityType: 1, entityId: 1 });
adAuditLogSchema.index({ performedBy: 1 });
adAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdAuditLog', adAuditLogSchema);

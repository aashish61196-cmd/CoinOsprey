const mongoose = require('mongoose');
const crypto = require('crypto');

const NewsletterSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },

    // ---- Subscription status ----
    status: {
      type: String,
      enum: ['pending', 'subscribed', 'unsubscribed'],
      default: 'pending',
    },

    // ---- Preferences ----
    interests: [
      {
        type: String,
        enum: ['crypto', 'indian_stock', 'general_finance', 'price_alerts'],
      },
    ],
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'instant'],
      default: 'daily',
    },
    language: {
      type: String,
      enum: ['en', 'hi'],
      default: 'en',
    },

    // ---- Confirmation (double opt-in) ----
    confirmationToken: {
      type: String,
      select: false,
    },
    confirmationTokenExpires: {
      type: Date,
      select: false,
    },
    confirmedAt: {
      type: Date,
    },

    // ---- Unsubscribe ----
    unsubscribeToken: {
      type: String,
      select: false,
    },
    unsubscribedAt: {
      type: Date,
    },
    unsubscribeReason: {
      type: String,
      trim: true,
    },

    // ---- Delivery tracking ----
    lastEmailSentAt: {
      type: Date,
    },
    emailsSentCount: {
      type: Number,
      default: 0,
    },
    bounceCount: {
      type: Number,
      default: 0,
    },

    // ---- Source tracking ----
    source: {
      type: String,
      default: 'website', // e.g. website, blog, article-popup
    },
    ipAddress: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// ---- Indexes ----
NewsletterSchema.index({ status: 1 });
NewsletterSchema.index({ interests: 1 });

// ---- Instance method: generate double opt-in confirmation token ----
NewsletterSchema.methods.generateConfirmationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.confirmationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.confirmationTokenExpires = Date.now() + 48 * 60 * 60 * 1000; // 48 hours
  return token;
};

// ---- Instance method: generate one-click unsubscribe token ----
NewsletterSchema.methods.generateUnsubscribeToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.unsubscribeToken = crypto.createHash('sha256').update(token).digest('hex');
  return token;
};

// ---- Instance method: confirm subscription ----
NewsletterSchema.methods.confirmSubscription = function () {
  this.status = 'subscribed';
  this.confirmedAt = new Date();
  this.confirmationToken = undefined;
  this.confirmationTokenExpires = undefined;
  return this.save();
};

// ---- Instance method: unsubscribe ----
NewsletterSchema.methods.unsubscribe = function (reason = '') {
  this.status = 'unsubscribed';
  this.unsubscribedAt = new Date();
  this.unsubscribeReason = reason;
  return this.save();
};

// ---- Static method: get active subscribers for a campaign ----
NewsletterSchema.statics.getActiveSubscribers = function (filters = {}) {
  return this.find({ status: 'subscribed', ...filters });
};

module.exports = mongoose.model('Newsletter', NewsletterSchema);

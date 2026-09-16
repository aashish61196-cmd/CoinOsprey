const mongoose = require('mongoose');

// An Advertiser is the paying client/agency. One Advertiser can run many
// Campaigns over time. Kept separate from Campaign so contact/billing
// details aren't duplicated on every campaign the same client runs.
//
// NOTE: this supersedes the Part 2 draft of this file — `name` was folded
// into `companyName` (the two were redundant) and `country`, `industry`,
// `companyDescription` were added, and `status` gained `pending`/`blocked`/
// `archived` to support the Advertiser Management workflow.

const INDUSTRIES = [
  'Cryptocurrency Exchange',
  'Crypto Wallet',
  'Blockchain',
  'DeFi',
  'Web3',
  'NFT',
  'Trading Platform',
  'Crypto Analytics',
  'Blockchain Infrastructure',
  'Fintech',
  'Payments',
  'Security',
  'Education',
  'Research',
  'Conferences / Events',
  'Investment Technology',
  'Software',
  'Other'
];

const advertiserSchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true }, // internal use only, derived from companyName

  website: { type: String, required: true, trim: true },

  contactName: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },

  country: { type: String, required: true, trim: true },
  industry: { type: String, enum: INDUSTRIES, required: true },

  companyDescription: { type: String, default: '' },
  billingAddress: { type: String, default: '' },

  // pending = newly submitted, awaiting review (default for new inbound advertisers)
  // active/inactive = normal operating states
  // blocked = disallowed from running ads (compliance/abuse)
  // archived = soft-deleted, hidden from default views, kept for history
  status: {
    type: String,
    enum: ['pending', 'active', 'inactive', 'blocked', 'archived'],
    default: 'pending',
    index: true
  },

  internalNotes: { type: String, default: '' }
}, { timestamps: true });

// Supports the console's search box (company / website / contact / email)
// without requiring a dedicated text index for a low-volume collection.
advertiserSchema.index({ companyName: 1 });
advertiserSchema.index({ website: 1 });
advertiserSchema.index({ email: 1 });

advertiserSchema.statics.INDUSTRIES = INDUSTRIES;

module.exports = mongoose.model('Advertiser', advertiserSchema);

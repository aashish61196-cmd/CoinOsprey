const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  content: { type: String, default: '' },
  author: { type: String, default: 'CoinOsprey Team' },
  category: { type: String, default: '' },
  type: { type: String, default: 'Market Update' },
  image: { type: String, default: '' },
  imageAlt: { type: String, default: '' },
  project: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  seoTitle: { type: String, default: '' },
  metaKeywords: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  faqs: { type: String, default: '' },
  focusKeyword: { type: String, default: '' },
  project: { type: String, default: '' },
  imageAlt: { type: String, default: '' },
  views: { type: Number, default: 0 },
  publishedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Article', articleSchema);

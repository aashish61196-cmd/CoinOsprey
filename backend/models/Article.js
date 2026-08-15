const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true },

  language: {
    type: String,
    enum: ['en', 'hi'],
    default: 'en',
    index: true
  },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  content: { type: String, default: '' },
  author: { type: String, default: 'CoinOsprey Team' },
  category: { type: String, default: '' },
  tag: { type: String, default: '' },
  section: {
  type: String,
  enum: ['news', 'price-prediction', 'blog', 'research', 'academy', 'tools'],
  required: true,
  default: 'news'
},
  type: { type: String, default: 'Market Update' },
  image: { type: String, default: '' },
  imageAlt: { type: String, default: '' },
  project: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  seoTitle: { type: String, default: '' },
  metaKeywords: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  canonicalUrl: { type: String, default: '' },
  ogTitle: { type: String, default: '' },
  ogDescription: { type: String, default: '' },
  faqs: { type: String, default: '' },
  focusKeyword: { type: String, default: '' },
  views: { type: Number, default: 0 },
  publishedAt: { type: Date }
}, { timestamps: true });

articleSchema.index(
  { title: 'text', content: 'text' },
  { language_override: 'textIndexLanguage', default_language: 'none' }
);

module.exports = mongoose.model('Article', articleSchema);

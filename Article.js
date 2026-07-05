const mongoose = require('mongoose');

const ArticleSchema = new mongoose.Schema(
  {
    // ---- Core content ----
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [180, 'Title cannot exceed 180 characters'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    excerpt: {
      type: String,
      trim: true,
      maxlength: [300, 'Excerpt cannot exceed 300 characters'],
    },
    content: {
      type: String,
      required: [true, 'Article content (HTML) is required'],
    },
    thumbnail: {
      type: String,
      default: '',
    },
    gallery: [String],

    // ---- Author / ownership ----
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ---- Taxonomy ----
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    tags: [{ type: String, trim: true, lowercase: true }],

    // ---- Market / crypto specific fields ----
    marketType: {
      type: String,
      enum: ['crypto', 'indian_stock', 'general_finance'],
      required: true,
      default: 'crypto',
    },
    assetSymbol: {
      type: String,
      trim: true,
      uppercase: true, // e.g. BTC, XRP, RELIANCE, TCS
    },
    assetName: {
      type: String,
      trim: true, // e.g. Bitcoin, XRP, Reliance Industries
    },
    articleFormat: {
      type: String,
      enum: [
        'analyst_verdict',
        'story_led_narrative',
        'breakout_alert',
        'price_prediction',
        'news_analysis',
        'technical_deep_dive',
        'market_roundup',
        'opinion_editorial',
      ],
      default: 'price_prediction',
    },
    priceData: {
      currentPrice: Number,
      predictedLow: Number,
      predictedHigh: Number,
      predictionTimeframe: String, // e.g. "24 hours", "7 days", "end of month"
      sentiment: {
        type: String,
        enum: ['bullish', 'bearish', 'neutral'],
      },
    },

    // ---- Language / locale ----
    language: {
      type: String,
      enum: ['en', 'hi'],
      default: 'en',
    },

    // ---- SEO fields ----
    seo: {
      metaTitle: { type: String, maxlength: 70 },
      metaDescription: { type: String, maxlength: 160 },
      focusKeyword: { type: String, trim: true },
      canonicalUrl: { type: String, trim: true },
      ogImage: { type: String, trim: true },
      noIndex: { type: Boolean, default: false },
    },

    // ---- Publishing workflow ----
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published', 'archived'],
      default: 'draft',
    },
    publishedAt: {
      type: Date,
    },
    scheduledFor: {
      type: Date,
    },

    // ---- Engagement metrics ----
    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
    commentsCount: {
      type: Number,
      default: 0,
    },

    // ---- Cross-posting ----
    blogPlatforms: [
      {
        platform: { type: String, enum: ['blogger', 'wordpress', 'medium'] },
        externalUrl: String,
        publishedAt: Date,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ---- Indexes for common query patterns ----
ArticleSchema.index({ status: 1, publishedAt: -1 });
ArticleSchema.index({ marketType: 1, assetSymbol: 1 });
ArticleSchema.index({ category: 1 });
ArticleSchema.index({ tags: 1 });
ArticleSchema.index({ title: 'text', excerpt: 'text', content: 'text' });

// ---- Helper: slugify a string ----
function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ---- Auto-generate a unique slug from title if not provided ----
// Runs whenever title changes or slug isn't set, and guarantees uniqueness
// by appending -2, -3, etc. on collision. Important for high daily volume
// where similar/duplicate titles are common (e.g. multiple "BTC Price
// Prediction" articles across different days).
ArticleSchema.pre('validate', async function (next) {
  try {
    const titleChanged = this.isModified('title');
    const slugManuallySet = this.isModified('slug') && this.slug;

    if (slugManuallySet) {
      this.slug = slugify(this.slug);
    } else if (!this.slug || titleChanged) {
      this.slug = slugify(this.title);
    } else {
      return next(); // slug already set, title unchanged, nothing to do
    }

    const baseSlug = this.slug;
    let candidate = baseSlug;
    let counter = 2;

    const Article = this.constructor;
    while (await Article.exists({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${baseSlug}-${counter}`;
      counter += 1;
    }

    this.slug = candidate;
    next();
  } catch (err) {
    next(err);
  }
});

// ---- Set publishedAt automatically when status changes to published ----
ArticleSchema.pre('save', function (next) {
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

// ---- Instance method: increment view count ----
ArticleSchema.methods.incrementViews = async function () {
  this.views += 1;
  return this.save({ validateBeforeSave: false });
};

// ---- Static method: fetch published articles feed ----
ArticleSchema.statics.getPublishedFeed = function (filters = {}, limit = 20, skip = 0) {
  return this.find({ status: 'published', ...filters })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate('author', 'name avatar')
    .populate('category', 'name slug');
};

module.exports = mongoose.model('Article', ArticleSchema);

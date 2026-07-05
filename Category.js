const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      unique: true,
      maxlength: [60, 'Category name cannot exceed 60 characters'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
    },

    // ---- Classification ----
    marketType: {
      type: String,
      enum: ['crypto', 'indian_stock', 'general_finance', 'mixed'],
      default: 'mixed',
    },

    // ---- Nested categories (e.g. "Crypto" -> "Altcoins" -> "DeFi Tokens") ----
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },

    // ---- Display ----
    icon: {
      type: String,
      default: '', // icon class name or image URL
    },
    color: {
      type: String,
      default: '#14b8a6', // matches teal accent theme
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },

    // ---- SEO fields ----
    seo: {
      metaTitle: { type: String, maxlength: 70 },
      metaDescription: { type: String, maxlength: 160 },
    },

    // ---- Cached count (updated via hooks/cron, avoids expensive counts on every request) ----
    articleCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// ---- Indexes ----
CategorySchema.index({ marketType: 1, isActive: 1 });
CategorySchema.index({ parentCategory: 1 });
CategorySchema.index({ displayOrder: 1 });

// ---- Auto-generate unique slug from name ----
CategorySchema.pre('validate', async function (next) {
  try {
    const nameChanged = this.isModified('name');
    const slugManuallySet = this.isModified('slug') && this.slug;

    if (slugManuallySet) {
      this.slug = this._slugify(this.slug);
    } else if (!this.slug || nameChanged) {
      this.slug = this._slugify(this.name);
    } else {
      return next();
    }

    const baseSlug = this.slug;
    let candidate = baseSlug;
    let counter = 2;

    const Category = this.constructor;
    while (await Category.exists({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${baseSlug}-${counter}`;
      counter += 1;
    }

    this.slug = candidate;
    next();
  } catch (err) {
    next(err);
  }
});

// ---- Helper: slugify (attached as schema method so pre-hook can use `this`) ----
CategorySchema.methods._slugify = function (str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

// ---- Prevent a category from being its own parent ----
CategorySchema.pre('save', function (next) {
  if (this.parentCategory && this.parentCategory.toString() === this._id.toString()) {
    return next(new Error('A category cannot be its own parent'));
  }
  next();
});

// ---- Instance method: refresh cached article count ----
CategorySchema.methods.refreshArticleCount = async function () {
  const Article = mongoose.model('Article');
  this.articleCount = await Article.countDocuments({
    category: this._id,
    status: 'published',
  });
  return this.save();
};

// ---- Static method: get category tree (parents with nested children) ----
CategorySchema.statics.getCategoryTree = async function (filters = {}) {
  const categories = await this.find({ isActive: true, ...filters })
    .sort({ displayOrder: 1 })
    .lean();

  const map = {};
  const tree = [];

  categories.forEach((cat) => {
    cat.children = [];
    map[cat._id] = cat;
  });

  categories.forEach((cat) => {
    if (cat.parentCategory) {
      const parent = map[cat.parentCategory];
      if (parent) {
        parent.children.push(cat);
      }
    } else {
      tree.push(cat);
    }
  });

  return tree;
};

module.exports = mongoose.model('Category', CategorySchema);

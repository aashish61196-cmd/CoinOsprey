const Article = require('../models/Article');
const Category = require('../models/Category');
const logger = require('../utils/logger');

// @desc    Create a new article
// @route   POST /api/articles
// @access  Private (editor/admin)
exports.createArticle = async (req, res, next) => {
  try {
    const {
      title,
      slug,
      excerpt,
      content,
      thumbnail,
      gallery,
      category,
      tags,
      marketType,
      assetSymbol,
      assetName,
      articleFormat,
      priceData,
      language,
      seo,
      status,
      scheduledFor,
    } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, content, and category are required',
      });
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const article = await Article.create({
      title,
      slug,
      excerpt,
      content,
      thumbnail,
      gallery,
      author: req.user.id,
      category,
      tags,
      marketType,
      assetSymbol,
      assetName,
      articleFormat,
      priceData,
      language,
      seo,
      status: status || 'draft',
      scheduledFor,
    });

    if (article.status === 'published') {
      await categoryExists.refreshArticleCount();
    }

    logger.info(`Article created: ${article.slug} by user ${req.user.id}`);

    res.status(201).json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// @desc    Get a paginated, filterable list of articles
// @route   GET /api/articles
// @access  Public
exports.getArticles = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      marketType,
      assetSymbol,
      category,
      tag,
      language,
      status,
      search,
      sort = '-publishedAt',
    } = req.query;

    const query = {};

    // Public users only see published articles; editors/admins can filter by status
    if (req.user && ['editor', 'admin'].includes(req.user.role) && status) {
      query.status = status;
    } else {
      query.status = 'published';
    }

    if (marketType) query.marketType = marketType;
    if (assetSymbol) query.assetSymbol = assetSymbol.toUpperCase();
    if (category) query.category = category;
    if (tag) query.tags = tag.toLowerCase();
    if (language) query.language = language;
    if (search) query.$text = { $search: search };

    const skip = (Number(page) - 1) * Number(limit);

    const [articles, total] = await Promise.all([
      Article.find(query)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate('author', 'name avatar')
        .populate('category', 'name slug color'),
      Article.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: articles,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get a single article by slug (and increment view count)
// @route   GET /api/articles/:slug
// @access  Public
exports.getArticleBySlug = async (req, res, next) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug })
      .populate('author', 'name avatar')
      .populate('category', 'name slug color');

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    // Only public users trigger a view increment; editors previewing drafts shouldn't
    if (article.status === 'published') {
      article.incrementViews().catch((err) => logger.logError(err, 'incrementViews'));
    } else if (!req.user || !['editor', 'admin'].includes(req.user.role)) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    res.status(200).json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// @desc    Update an existing article
// @route   PUT /api/articles/:id
// @access  Private (author, editor, admin)
exports.updateArticle = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const isOwner = article.author.toString() === req.user.id;
    const isElevated = ['editor', 'admin'].includes(req.user.role);
    if (!isOwner && !isElevated) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this article',
      });
    }

    const previousStatus = article.status;
    const previousCategory = article.category.toString();

    const updatableFields = [
      'title', 'slug', 'excerpt', 'content', 'thumbnail', 'gallery',
      'category', 'tags', 'marketType', 'assetSymbol', 'assetName',
      'articleFormat', 'priceData', 'language', 'seo', 'status', 'scheduledFor',
    ];

    updatableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        article[field] = req.body[field];
      }
    });

    await article.save();

    // Refresh article counts on both old and new category if it changed, or on publish
    const categoriesToRefresh = new Set([previousCategory, article.category.toString()]);
    if (previousStatus !== article.status || previousCategory !== article.category.toString()) {
      for (const catId of categoriesToRefresh) {
        const cat = await Category.findById(catId);
        if (cat) await cat.refreshArticleCount();
      }
    }

    res.status(200).json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete an article
// @route   DELETE /api/articles/:id
// @access  Private (author, editor, admin)
exports.deleteArticle = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const isOwner = article.author.toString() === req.user.id;
    const isElevated = ['editor', 'admin'].includes(req.user.role);
    if (!isOwner && !isElevated) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this article',
      });
    }

    const categoryId = article.category;
    await article.deleteOne();

    const category = await Category.findById(categoryId);
    if (category) await category.refreshArticleCount();

    logger.info(`Article deleted: ${article.slug} by user ${req.user.id}`);

    res.status(200).json({ success: true, message: 'Article deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// @desc    Publish a draft/scheduled article immediately
// @route   PATCH /api/articles/:id/publish
// @access  Private (editor/admin)
exports.publishArticle = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    article.status = 'published';
    article.publishedAt = new Date();
    await article.save();

    const category = await Category.findById(article.category);
    if (category) await category.refreshArticleCount();

    res.status(200).json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// @desc    Get trending/most-viewed articles
// @route   GET /api/articles/trending
// @access  Public
exports.getTrendingArticles = async (req, res, next) => {
  try {
    const { marketType, limit = 10 } = req.query;
    const query = { status: 'published' };
    if (marketType) query.marketType = marketType;

    const articles = await Article.find(query)
      .sort({ views: -1, publishedAt: -1 })
      .limit(Number(limit))
      .populate('category', 'name slug color');

    res.status(200).json({ success: true, data: articles });
  } catch (err) {
    next(err);
  }
};

// @desc    Get related articles (same asset or category, excluding current)
// @route   GET /api/articles/:id/related
// @access  Public
exports.getRelatedArticles = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const related = await Article.find({
      _id: { $ne: article._id },
      status: 'published',
      $or: [
        { assetSymbol: article.assetSymbol },
        { category: article.category },
      ],
    })
      .sort({ publishedAt: -1 })
      .limit(6)
      .populate('category', 'name slug color');

    res.status(200).json({ success: true, data: related });
  } catch (err) {
    next(err);
  }
};

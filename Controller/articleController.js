const Article = require("../models/Article");
const { basicSanitize, required } = require("../Utils/validator");

// GET /api/articles  (public — published only, unless ?status= is used by an authed editor/admin)
exports.listArticles = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 12);
    const skip = (page - 1) * limit;

    const filter = { status: "published" };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.tag) filter.tags = req.query.tag.toLowerCase();
    if (req.query.q) filter.$text = { $search: req.query.q };

    const [articles, total] = await Promise.all([
      Article.find(filter)
        .populate("author", "name avatarUrl")
        .populate("category", "name slug")
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit),
      Article.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: articles,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/articles/:slug  (public, increments view count)
exports.getArticleBySlug = async (req, res, next) => {
  try {
    const article = await Article.findOneAndUpdate(
      { slug: req.params.slug, status: "published" },
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate("author", "name avatarUrl")
      .populate("category", "name slug");

    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found." });
    }
    res.json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// GET /api/articles/admin/all  (protected — editors/admins see all statuses)
exports.listAllArticlesForAdmin = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const articles = await Article.find(filter)
      .populate("author", "name")
      .populate("category", "name")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: articles });
  } catch (err) {
    next(err);
  }
};

// POST /api/articles  (protected — author/editor/admin)
exports.createArticle = async (req, res, next) => {
  try {
    const missing = required(["title", "content"], req.body);
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Missing fields: ${missing.join(", ")}` });
    }

    const article = await Article.create({
      ...req.body,
      content: basicSanitize(req.body.content),
      author: req.user._id,
      coverImage: req.file ? `/uploads/${req.file.filename}` : req.body.coverImage || "",
    });

    res.status(201).json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// PUT /api/articles/:id  (protected — author of the article, or editor/admin)
exports.updateArticle = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: "Article not found." });

    const isOwner = String(article.author) === String(req.user._id);
    const canEditAny = ["admin", "editor"].includes(req.user.role);
    if (!isOwner && !canEditAny) {
      return res.status(403).json({ success: false, message: "You can only edit your own articles." });
    }

    const updates = { ...req.body };
    if (updates.content) updates.content = basicSanitize(updates.content);
    if (req.file) updates.coverImage = `/uploads/${req.file.filename}`;

    Object.assign(article, updates);
    await article.save();

    res.json({ success: true, data: article });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/articles/:id  (protected — owner or editor/admin)
exports.deleteArticle = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: "Article not found." });

    const isOwner = String(article.author) === String(req.user._id);
    const canDeleteAny = ["admin", "editor"].includes(req.user.role);
    if (!isOwner && !canDeleteAny) {
      return res.status(403).json({ success: false, message: "You can only delete your own articles." });
    }

    await article.deleteOne();
    res.json({ success: true, message: "Article deleted." });
  } catch (err) {
    next(err);
  }
};

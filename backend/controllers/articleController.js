const Article = require('../models/Article');

// Public: get all published articles (optionally filter by language/section/category)
exports.getPublished = async (req, res) => {
  try {
    const { language, section, category, limit } = req.query;
    const filter = { status: 'published' };
    if (language) filter.language = language;
    if (section) filter.section = section;
    if (category) filter.category = category;

    const query = Article.find(filter).sort({ publishedAt: -1, createdAt: -1 });
    if (limit) query.limit(parseInt(limit, 10));

    const articles = await query;
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Public: get single article by slug
exports.getBySlug = async (req, res) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug, status: 'published' });
    if (!article) return res.status(404).json({ message: 'Article not found' });

    article.views = (article.views || 0) + 1;
    await article.save();

    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: get all articles (draft + published)
exports.getAllForAdmin = async (req, res) => {
  try {
    const articles = await Article.find().sort({ createdAt: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: create article
exports.create = async (req, res) => {
  try {
    if (req.body.status === 'published' && !req.body.publishedAt) {
      req.body.publishedAt = new Date();
    }
    const article = await Article.create(req.body);
    res.status(201).json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: update article
exports.update = async (req, res) => {
  try {
    if (req.body.status === 'published' && !req.body.publishedAt) {
      req.body.publishedAt = new Date();
    }
    const article = await Article.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: delete article
exports.remove = async (req, res) => {
  try {
    await Article.findByIdAndDelete(req.params.id);
    res.json({ message: 'Article deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

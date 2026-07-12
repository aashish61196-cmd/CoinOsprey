const Article = require('../models/Article');
const slugify = require('slugify');

exports.getPublished = async (req, res) => {
  try {
    const articles = await Article.find({ status: 'published' }).sort({ publishedAt: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAllForAdmin = async (req, res) => {
  try {
    const articles = await Article.find().sort({ createdAt: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getBySlug = async (req, res) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug, status: 'published' });
    if (!article) return res.status(404).json({ message: 'Article not found' });
    article.views += 1;
    await article.save();
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const body = req.body;
    if (!body.title) return res.status(400).json({ message: 'Title is required' });

    let slug = body.slug
      ? slugify(body.slug, { lower: true, strict: true })
      : slugify(body.title, { lower: true, strict: true });

    const exists = await Article.findOne({ slug });
    if (exists) slug = `${slug}-${Date.now().toString().slice(-5)}`;

    const article = await Article.create({
      ...body,
      slug,
      status: body.publish ? 'published' : 'draft',
      publishedAt: body.publish ? new Date() : undefined
    });
    res.status(201).json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ message: 'Article not found' });
    Object.assign(article, req.body);
    if (req.body.publish && article.status !== 'published') {
      article.status = 'published';
      article.publishedAt = new Date();
    }
    await article.save();
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await Article.findByIdAndDelete(req.params.id);
    res.json({ message: 'Article deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

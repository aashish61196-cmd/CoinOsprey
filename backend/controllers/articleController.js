const Article = require('../models/Article');
const slugify = require('slugify');


/* =========================================================
   PUBLIC: GET PUBLISHED ARTICLES
   English includes old articles that do not yet have
   a language field.
   ========================================================= */
exports.getPublished = async (req, res) => {
  try {

    const requestedLanguage =
      String(req.query.language || 'en').toLowerCase();

    const language =
      requestedLanguage === 'hi' ? 'hi' : 'en';

    let filter = {
      status: 'published'
    };

    if (language === 'hi') {

      // Hindi edition = only explicitly Hindi articles
      filter.language = 'hi';

    } else {

      // English edition =
      // 1. language = en
      // 2. old articles where language does not exist
      // 3. old articles where language is null
      filter.$or = [
        { language: 'en' },
        { language: { $exists: false } },
        { language: null }
      ];

    }

    const articles = await Article
      .find(filter)
      .sort({
        publishedAt: -1,
        createdAt: -1
      });

    res.json(articles);

  } catch (err) {

    console.error(
      '[ArticleController] getPublished error:',
      err
    );

    res.status(500).json({
      message: err.message
    });

  }
};


/* =========================================================
   ADMIN: GET ALL ARTICLES
   ========================================================= */
exports.getAllForAdmin = async (req, res) => {
  try {

    const articles = await Article
      .find()
      .sort({ createdAt: -1 });

    res.json(articles);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
};


/* =========================================================
   PUBLIC: GET SINGLE ARTICLE
   ========================================================= */
exports.getBySlug = async (req, res) => {
  try {

    const requestedLanguage =
      String(req.query.language || 'en').toLowerCase();

    const language =
      requestedLanguage === 'hi' ? 'hi' : 'en';

    let filter = {
      slug: req.params.slug,
      status: 'published'
    };

    if (language === 'hi') {

      filter.language = 'hi';

    } else {

      filter.$or = [
        { language: 'en' },
        { language: { $exists: false } },
        { language: null }
      ];

    }

    const article = await Article.findOne(filter);

    if (!article) {

      return res.status(404).json({
        message: 'Article not found'
      });

    }

    article.views = (Number(article.views) || 0) + 1;

    await article.save();

    res.json(article);

  } catch (err) {

    console.error(
      '[ArticleController] getBySlug error:',
      err
    );

    res.status(500).json({
      message: err.message
    });

  }
};


/* =========================================================
   ADMIN: CREATE ARTICLE
   ========================================================= */
exports.create = async (req, res) => {
  try {

    const body = req.body;

    if (!body.title) {

      return res.status(400).json({
        message: 'Title is required'
      });

    }

    let slug = body.slug
      ? slugify(body.slug, {
          lower: true,
          strict: true
        })
      : slugify(body.title, {
          lower: true,
          strict: true
        });

    const exists = await Article.findOne({ slug });

    if (exists) {

      slug =
        `${slug}-${Date.now().toString().slice(-5)}`;

    }

    const article = await Article.create({

      ...body,

      // English is the safe default for old/admin forms
      language:
        body.language === 'hi'
          ? 'hi'
          : 'en',

      slug,

      status:
        body.publish
          ? 'published'
          : 'draft',

      publishedAt:
        body.publish
          ? new Date()
          : undefined

    });

    res.status(201).json(article);

  } catch (err) {

    console.error(
      '[ArticleController] create error:',
      err
    );

    res.status(500).json({
      message: err.message
    });

  }
};


/* =========================================================
   ADMIN: UPDATE ARTICLE
   ========================================================= */
exports.update = async (req, res) => {
  try {

    const article =
      await Article.findById(req.params.id);

    if (!article) {

      return res.status(404).json({
        message: 'Article not found'
      });

    }

    Object.assign(article, req.body);

    if (
      req.body.publish &&
      article.status !== 'published'
    ) {

      article.status = 'published';
      article.publishedAt = new Date();

    }

    // Keep existing old articles as English
    if (!article.language) {
      article.language = 'en';
    }

    await article.save();

    res.json(article);

  } catch (err) {

    console.error(
      '[ArticleController] update error:',
      err
    );

    res.status(500).json({
      message: err.message
    });

  }
};


/* =========================================================
   ADMIN: DELETE ARTICLE
   ========================================================= */
exports.remove = async (req, res) => {
  try {

    await Article.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Article deleted'
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
};

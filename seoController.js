const { generateSitemapXml, generateRobotsTxt, buildArticleMeta } = require("../services/seoService");
const Article = require("../models/Article");

// GET /sitemap.xml
exports.sitemap = async (req, res, next) => {
  try {
    const xml = await generateSitemapXml();
    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    next(err);
  }
};

// GET /robots.txt
exports.robots = (req, res) => {
  res.header("Content-Type", "text/plain");
  res.send(generateRobotsTxt());
};

// GET /api/seo/article/:slug  (meta tags for a given article, for client-side <head> injection)
exports.articleMeta = async (req, res, next) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug, status: "published" });
    if (!article) return res.status(404).json({ success: false, message: "Article not found." });
    res.json({ success: true, data: buildArticleMeta(article) });
  } catch (err) {
    next(err);
  }
};

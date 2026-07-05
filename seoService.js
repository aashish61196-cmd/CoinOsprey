const Article = require("../models/Article");

function siteUrl() {
  return process.env.CLIENT_URL || "https://www.coinosprey.com";
}

async function generateSitemapXml() {
  const base = siteUrl();
  const articles = await Article.find({ status: "published" })
    .select("slug updatedAt")
    .sort({ publishedAt: -1 })
    .limit(5000);

  const staticUrls = [
    { loc: `${base}/`, priority: "1.0" },
    { loc: `${base}/news`, priority: "0.8" },
    { loc: `${base}/prices`, priority: "0.8" },
  ];

  const urlEntries = [
    ...staticUrls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`),
    ...articles.map(
      (a) =>
        `  <url>\n    <loc>${base}/article/${a.slug}</loc>\n    <lastmod>${a.updatedAt.toISOString()}</lastmod>\n  </url>`
    ),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`;
}

function generateRobotsTxt() {
  const base = siteUrl();
  return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
}

/** Builds the meta-tag object a frontend can drop into <head> for a given article. */
function buildArticleMeta(article) {
  const base = siteUrl();
  return {
    title: article.metaTitle || article.title,
    description: article.metaDescription || article.excerpt,
    canonical: article.canonicalUrl || `${base}/article/${article.slug}`,
    ogImage: article.coverImage || "",
  };
}

module.exports = { generateSitemapXml, generateRobotsTxt, buildArticleMeta };

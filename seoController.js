const Article = require('../models/Article');
const Category = require('../models/Category');

const SITE_URL = process.env.SITE_URL || 'https://avfinancehub.com';

// @desc    Generate dynamic XML sitemap of all published articles + categories
// @route   GET /api/seo/sitemap.xml
// @access  Public
exports.getSitemap = async (req, res, next) => {
  try {
    const [articles, categories] = await Promise.all([
      Article.find({ status: 'published' })
        .select('slug updatedAt')
        .sort({ publishedAt: -1 }),
      Category.find({ isActive: true }).select('slug updatedAt'),
    ]);

    const staticUrls = ['', '/about', '/contact', '/privacy-policy', '/terms'];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    staticUrls.forEach((path) => {
      xml += `  <url><loc>${SITE_URL}${path}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
    });

    categories.forEach((cat) => {
      xml += `  <url><loc>${SITE_URL}/category/${cat.slug}</loc><lastmod>${cat.updatedAt.toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>\n`;
    });

    articles.forEach((article) => {
      xml += `  <url><loc>${SITE_URL}/article/${article.slug}</loc><lastmod>${article.updatedAt.toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>\n`;
    });

    xml += '</urlset>';

    res.header('Content-Type', 'application/xml');
    res.status(200).send(xml);
  } catch (err) {
    next(err);
  }
};

// @desc    Generate robots.txt dynamically
// @route   GET /api/seo/robots.txt
// @access  Public
exports.getRobotsTxt = (req, res) => {
  const content = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin/',
    'Disallow: /login',
    'Disallow: /register',
    '',
    `Sitemap: ${SITE_URL}/api/seo/sitemap.xml`,
  ].join('\n');

  res.header('Content-Type', 'text/plain');
  res.status(200).send(content);
};

// @desc    Generate JSON-LD structured data for a single article (NewsArticle schema)
// @route   GET /api/seo/structured-data/article/:slug
// @access  Public
exports.getArticleStructuredData = async (req, res, next) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug, status: 'published' })
      .populate('author', 'name')
      .populate('category', 'name');

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.seo?.metaTitle || article.title,
      description: article.seo?.metaDescription || article.excerpt,
      image: article.seo?.ogImage || article.thumbnail,
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      author: {
        '@type': 'Person',
        name: article.author?.name || 'AVFINANCEHUB Team',
      },
      publisher: {
        '@type': 'Organization',
        name: 'AVFINANCEHUB',
        logo: {
          '@type': 'ImageObject',
          url: `${SITE_URL}/logo.png`,
        },
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `${SITE_URL}/article/${article.slug}`,
      },
      articleSection: article.category?.name,
      keywords: article.tags?.join(', '),
    };

    res.status(200).json({ success: true, data: structuredData });
  } catch (err) {
    next(err);
  }
};

// @desc    Analyze an article's SEO quality (basic on-page checks)
// @route   GET /api/seo/analyze/:id
// @access  Private (editor/admin)
exports.analyzeArticleSeo = async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const issues = [];
    const warnings = [];
    const plainTextContent = article.content.replace(/<[^>]*>/g, ' ');
    const wordCount = plainTextContent.trim().split(/\s+/).filter(Boolean).length;

    // ---- Meta title checks ----
    const metaTitle = article.seo?.metaTitle || article.title;
    if (!metaTitle) {
      issues.push('Missing meta title');
    } else if (metaTitle.length > 60) {
      warnings.push(`Meta title is ${metaTitle.length} characters (recommended: under 60)`);
    }

    // ---- Meta description checks ----
    if (!article.seo?.metaDescription) {
      issues.push('Missing meta description');
    } else if (article.seo.metaDescription.length > 160) {
      warnings.push(
        `Meta description is ${article.seo.metaDescription.length} characters (recommended: under 160)`
      );
    }

    // ---- Focus keyword checks ----
    const focusKeyword = article.seo?.focusKeyword;
    if (!focusKeyword) {
      warnings.push('No focus keyword set');
    } else {
      const keywordInTitle = article.title.toLowerCase().includes(focusKeyword.toLowerCase());
      const keywordInContent = plainTextContent.toLowerCase().includes(focusKeyword.toLowerCase());
      if (!keywordInTitle) warnings.push('Focus keyword not found in title');
      if (!keywordInContent) warnings.push('Focus keyword not found in content');
    }

    // ---- Content length ----
    if (wordCount < 300) {
      issues.push(`Content is short (${wordCount} words). Recommended: 300+ words`);
    }

    // ---- Image checks ----
    if (!article.thumbnail) {
      warnings.push('No thumbnail image set');
    }

    // ---- Slug checks ----
    if (article.slug.length > 75) {
      warnings.push('Slug is long; shorter slugs tend to perform better');
    }

    const score = Math.max(0, 100 - issues.length * 20 - warnings.length * 5);

    res.status(200).json({
      success: true,
      data: {
        score,
        wordCount,
        issues,
        warnings,
      },
    });
  } catch (err) {
    next(err);
  }
};

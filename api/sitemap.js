const mongoose = require('mongoose');
const Article = require('../backend/models/Article');

let cached = global._mongooseConn;

if (!cached) {
  cached = global._mongooseConn = {
    conn: null,
    promise: null
  };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not configured');
    }

    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      bufferCommands: false
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = async function handler(req, res) {
  try {
    await connectDB();

    const articles = await Article.find({
      status: 'published',
      slug: { $exists: true, $ne: '' }
    })
      .select('slug section language updatedAt')
      .lean();

    const urls = [
      'https://coinosprey.com/',
      'https://coinosprey.com/hi/',
      'https://coinosprey.com/about.html',
      'https://coinosprey.com/mission.html',
      'https://coinosprey.com/authors.html',
      'https://coinosprey.com/careers.html',
      'https://coinosprey.com/press.html',
      'https://coinosprey.com/contact.html',
      'https://coinosprey.com/support.html',
      'https://coinosprey.com/tools.html',
      'https://coinosprey.com/privacy-policy.html',
      'https://coinosprey.com/cookie-policy.html',
      'https://coinosprey.com/disclaimer.html',
      'https://coinosprey.com/editorial-policy.html',
      'https://coinosprey.com/terms-and-conditions.html'
    ].map(loc => ({ loc }));

    for (const article of articles) {
      const language = article.language === 'hi' ? 'hi' : 'en';
      const section = article.section || 'news';

      const loc = `https://coinosprey.com/${language}/${section}/${encodeURIComponent(article.slug)}`;

      urls.push({
        loc,
        lastmod: article.updatedAt
          ? new Date(article.updatedAt).toISOString()
          : undefined
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `
  <url>
    <loc>${escapeXml(url.loc)}</loc>
    ${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}
  </url>`).join('')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );

    return res.status(200).send(xml);

  } catch (error) {
    console.error('Sitemap error:', error);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send(
      'Sitemap generation failed: ' + error.message
    );
  }
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

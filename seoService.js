const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'this', 'that', 'it', 'its', 'their', 'they',
  'has', 'have', 'had', 'will', 'would', 'could', 'should', 'can', 'may',
]);

/**
 * Strip HTML tags down to plain text for analysis purposes.
 */
function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Auto-generate a meta title from an article title, truncated to a safe length.
 * Appends the brand name if there's room.
 */
function generateMetaTitle(title, brand = 'AVFINANCEHUB') {
  const maxLength = 60;
  const withBrand = `${title} | ${brand}`;

  if (withBrand.length <= maxLength) return withBrand;
  if (title.length <= maxLength) return title;

  return `${title.slice(0, maxLength - 3).trim()}...`;
}

/**
 * Auto-generate a meta description from article content or excerpt,
 * truncated at a word boundary near 155-160 characters.
 */
function generateMetaDescription(source) {
  const text = stripHtml(source);
  const maxLength = 157;

  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${truncated.slice(0, lastSpace)}...`;
}

/**
 * Extract the most frequent meaningful words from content, as a lightweight
 * substitute for a full keyword-extraction library. Useful for suggesting
 * a focus keyword or auto-generating tags.
 */
function extractKeywords(content, limit = 8) {
  const text = stripHtml(content).toLowerCase();
  const words = text.match(/\b[a-z]{3,}\b/g) || [];

  const freq = {};
  words.forEach((word) => {
    if (!STOP_WORDS.has(word)) {
      freq[word] = (freq[word] || 0) + 1;
    }
  });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/**
 * Calculate keyword density (%) for a given keyword within the content.
 */
function calculateKeywordDensity(content, keyword) {
  if (!keyword) return 0;

  const text = stripHtml(content).toLowerCase();
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  if (totalWords === 0) return 0;

  const keywordRegex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'g');
  const matches = text.match(keywordRegex) || [];

  return Number(((matches.length / totalWords) * 100).toFixed(2));
}

/**
 * Rough readability estimate using a simplified Flesch Reading Ease formula.
 * Higher score = easier to read. Good for flagging overly dense articles.
 */
function calculateReadabilityScore(content) {
  const text = stripHtml(content);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter(Boolean);

  if (sentences.length === 0 || words.length === 0) return 0;

  const syllableCount = words.reduce((total, word) => total + countSyllables(word), 0);

  const avgWordsPerSentence = words.length / sentences.length;
  const avgSyllablesPerWord = syllableCount / words.length;

  const score = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function countSyllables(word) {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length <= 3) return 1;

  const vowelGroups = cleaned.match(/[aeiouy]+/g) || [];
  let count = vowelGroups.length;

  if (cleaned.endsWith('e')) count -= 1;
  return Math.max(1, count);
}

/**
 * Generate Open Graph + Twitter Card meta tag data for an article,
 * ready to be injected into server-rendered <head> tags.
 */
function generateSocialMetaTags(article, siteUrl) {
  const title = article.seo?.metaTitle || article.title;
  const description = article.seo?.metaDescription || generateMetaDescription(article.excerpt || article.content);
  const image = article.seo?.ogImage || article.thumbnail;
  const url = `${siteUrl}/article/${article.slug}`;

  return {
    ogTitle: title,
    ogDescription: description,
    ogImage: image,
    ogUrl: url,
    ogType: 'article',
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
  };
}

module.exports = {
  stripHtml,
  generateMetaTitle,
  generateMetaDescription,
  extractKeywords,
  calculateKeywordDensity,
  calculateReadabilityScore,
  generateSocialMetaTags,
};

// middleware.js
//
// Vercel Edge Middleware.
// Purpose: search engines and AI crawlers (Googlebot, GPTBot, ChatGPT-User,
// PerplexityBot, ClaudeBot, etc.) do not execute JavaScript, so they only
// ever see the static fallback <title>/<meta> tags baked into article.html
// ("Loading Article… — CoinOsprey"). Real browsers are fine because our
// client-side JS (loadArticle -> populateArticle) fills these in after the
// page loads.
//
// This middleware detects known bot User-Agents ONLY. For those requests to
// an article URL, it fetches the real article JSON from our own API and the
// static article.html template, injects the real title/description/OG/
// Twitter tags into the HTML, and returns that instead — before the request
// ever reaches the normal static file / rewrite handling.
//
// Regular human visitors are completely unaffected: for them this
// middleware does nothing and the request falls through to the existing
// vercel.json rewrites exactly as before.

export const config = {
  matcher: ['/en/:section/:slug', '/hi/:section/:slug'],
};

const BOT_UA_REGEX =
  /bot|crawl|spider|slurp|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|WhatsApp|Discordbot|TelegramBot|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Google-Extended|Bingbot|DuckDuckBot|Applebot|YandexBot|Baiduspider|ia_archiver|SemrushBot|AhrefsBot|MJ12bot/i;

const RESERVED_SLUGS = new Set([
  'about', 'mission', 'authors', 'careers', 'advertise',
  'press', 'contact', 'support', 'sitemap'
]);

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function escapeAttr(str) {
  return String(str).replace(/[&"<>]/g, function (c) {
    return { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function setMetaContent(html, id, value) {
  var re = new RegExp('(id="' + id + '"[^>]*content=")[^"]*(")');
  if (re.test(html)) return html.replace(re, '$1' + escapeAttr(value) + '$2');
  return html;
}

function setLinkHref(html, id, value) {
  var re = new RegExp('(id="' + id + '"[^>]*href=")[^"]*(")');
  return html.replace(re, '$1' + escapeAttr(value) + '$2');
}

function stripEmbeddedDocumentBot(raw) {
  if (!raw) return raw;
  var cleaned = String(raw);
  cleaned = cleaned.replace(/<meta[^>]*>/gi, '');
  cleaned = cleaned.replace(/<title[\s\S]*?<\/title>/gi, '');
  cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/?html[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/?head[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/?body[^>]*>/gi, '');
  return cleaned.trim();
}

function bodyToHtmlBot(content) {
  if (!content) return '';
  var cleaned = stripEmbeddedDocumentBot(content);
  // Our articles are authored as ready-to-publish HTML (Master Prompt),
  // so if block tags are already present, use as-is.
  if (/<\/?(div|p|br|table|h[1-6]|strong|em|b|i)[\s>]/i.test(cleaned)) {
    return cleaned;
  }
  var lines = cleaned.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
  return lines.map(function (l) { return '<p>' + escapeHtml(l) + '</p>'; }).join('');
}

function renderFaqsHtmlBot(faqs) {
  var items = faqs;
  if (typeof faqs === 'string') {
    try { items = JSON.parse(faqs); } catch (e) { return ''; }
  }
  if (!Array.isArray(items) || !items.length) return '';
  var rows = '';
  items.forEach(function (item) {
    var q = item.question || item.q || item.Question || item.ques || item.title;
    var a = item.answer || item.a || item.Answer || item.ans || item.description;
    if (!q || !a) return;
    rows += '<div class="faq-item">' +
              '<div class="faq-question">' + escapeHtml(q) + '</div>' +
              '<div class="faq-answer">' + escapeHtml(a) + '</div>' +
            '</div>';
  });
  if (!rows) return '';
  return '<div class="article-faq" id="articleFaqBlock"><h2>Frequently Asked Questions</h2>' + rows + '</div>';
}

function formatDateBot(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

function setInnerText(html, id, value) {
  var re = new RegExp('(id="' + id + '"[^>]*>)([\\s\\S]*?)(</)');
  return html.replace(re, '$1' + value + '$3');
}

function injectArticleBody(html, article) {
  var title = escapeHtml(String(article.title || article.seoTitle || 'CoinOsprey').trim());
  var category = escapeHtml(String(article.category || article.type || 'Crypto'));
  var author = escapeHtml(String(article.author || 'CoinOsprey Team'));
  var date = escapeHtml(formatDateBot(article.publishedAt || article.createdAt));
  var viewsNumber = Number(article.views);
  if (!Number.isFinite(viewsNumber)) viewsNumber = 0;
  var views = viewsNumber.toLocaleString() + ' views';

  html = setInnerText(html, 'articleTitle', title);
  html = setInnerText(html, 'articleCategory', category);
  html = setInnerText(html, 'articleAuthor', author);
  html = setInnerText(html, 'articleDate', date);
  html = setInnerText(html, 'articleViews', views);

  if (article.image) {
    var imgAlt = escapeAttr(String(article.imageAlt || title));
    var imgSrc = escapeAttr(String(article.image));
    html = html.replace(
      /<img class="article-hero-image" id="articleImage"[^>]*>/,
      '<img class="article-hero-image" id="articleImage" src="' + imgSrc + '" alt="' + imgAlt + '">'
    );
  }

  var content = article.content != null
    ? String(article.content)
    : (article.description != null ? String(article.description) : '');
  var bodyHtml = bodyToHtmlBot(content);

  var faqsData = article.faqs || article.faq || article.FAQs || article.faqList || null;
  if (faqsData) {
    var faqHtml = renderFaqsHtmlBot(faqsData);
    if (faqHtml) bodyHtml += faqHtml;
  }

  html = html.replace(
    /<div class="article-body" id="articleBody"><\/div>/,
    '<div class="article-body" id="articleBody">' + bodyHtml + '</div>'
  );

  html = html.replace(
    /<div class="article-skeleton" id="articleSkeleton">/,
    '<div class="article-skeleton" id="articleSkeleton" style="display:none;">'
  );
  html = html.replace(
    /<article class="article-content" id="articleContent">/,
    '<article class="article-content" id="articleContent" style="display:block;">'
  );

  return html;
}

export default async function middleware(request) {
export default async function middleware(request) {
  // Server-render for EVERYONE (bots and real users alike) — this way
  // we're not dependent on maintaining a User-Agent allowlist that will
  // always be one step behind new AI crawlers/tools. Real users' own JS
  // still runs after page load and simply re-populates the same data,
  // so nothing changes for them except a faster first paint.
  var url = new URL(request.url);
  var parts = url.pathname.split('/').filter(Boolean); // [lang, section, slug]
  var lang = parts[0] === 'hi' ? 'hi' : 'en';
  var slug = parts[2];

  if (!slug || RESERVED_SLUGS.has(slug.toLowerCase())) {
    return;
  }

  try {
    var apiUrl =
      url.origin + '/api/articles/' + encodeURIComponent(slug) +
      '?language=' + lang;

    var apiRes = await fetch(apiUrl, {
      headers: { Accept: 'application/json' }
    });

    if (!apiRes.ok) return; // no article -> fall through to normal 404 flow

    var article = await apiRes.json();
    if (!article || !article.title) return;

    var templatePath = lang === 'hi' ? '/hi/article.html' : '/article.html';
    var templateRes = await fetch(url.origin + templatePath);
    if (!templateRes.ok) return;

    var html = await templateRes.text();

    var seoTitle = article.seoTitle || article.title;
    var fullTitle = seoTitle + ' — CoinOsprey';
    var description = article.metaDescription || article.description || '';
    var canonical = article.canonicalUrl || ('https://coinosprey.com' + url.pathname);
    var ogTitle = article.ogTitle || seoTitle;
    var ogDescription = article.ogDescription || description;
    var image = article.image || '';

    html = html.replace(
      /<title id="pageTitle">[\s\S]*?<\/title>/,
      '<title id="pageTitle">' + escapeHtml(fullTitle) + '</title>'
    );

    html = setMetaContent(html, 'pageDescription', description);
    html = setMetaContent(html, 'pageKeywords', article.metaKeywords || '');
    html = setLinkHref(html, 'pageCanonical', canonical);
    html = setMetaContent(html, 'ogTitle', ogTitle);
    html = setMetaContent(html, 'ogDescription', ogDescription);
    if (image) html = setMetaContent(html, 'ogImage', image);
    html = setMetaContent(html, 'ogUrl', canonical);
    html = setMetaContent(html, 'twitterTitle', ogTitle);
    html = setMetaContent(html, 'twitterDescription', ogDescription);
    if (image) html = setMetaContent(html, 'twitterImage', image);

    html = injectArticleBody(html, article);

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // IMPORTANT: never let a bot-served article page (or a
        // once-404'd lookup) get stuck in Vercel's CDN/edge cache.
        // Without this, a single early 404 (e.g. published a few
        // seconds before the DB write settled) gets cached and keeps
        // serving "Article Not Found" forever, even after the article
        // is confirmed live in the database and the API is returning
        // it correctly.
       'cache-control': 'public, s-maxage=60, stale-while-revalidate=600'
      }
    });
  } catch (err) {
    // Any failure: don't break the request, just fall through to normal
    // (JS-rendered) behavior.
    return;
  }
}

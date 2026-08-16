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

export default async function middleware(request) {
  var ua = request.headers.get('user-agent') || '';

  // Real users: do nothing, let the normal vercel.json rewrite handle it.
  if (!BOT_UA_REGEX.test(ua)) {
    return;
  }

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

    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  } catch (err) {
    // Any failure: don't break the request, just fall through to normal
    // (JS-rendered) behavior.
    return;
  }
}
